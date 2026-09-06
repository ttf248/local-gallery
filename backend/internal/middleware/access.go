package middleware

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"io"
	"net"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/httputil"
)

const (
	accessSessionCookie = "local_gallery_session"
	accessAuthenticated = "local_gallery_access_authenticated"
	accessSessionTTL    = 8 * time.Hour
	maxAccessSessions   = 256
	maxAuthRequestBytes = 1024
	loginFailureWindow  = 5 * time.Minute
	maxLoginFailures    = 8
	maxLoginSources     = 1024
)

// AccessGate 实现 API 的网络边界与局域网认证。
//
// 推荐把 Middleware 挂在 /api 分组上，并在同一分组注册：
//
//	gate := middleware.NewAccessGate(mgr.Get)
//	api.Use(gate.Middleware())
//	api.Post("/auth/session", gate.SessionCreateHandler())
//	api.Delete("/auth/session", gate.SessionDeleteHandler())
//
// local 模式只允许回环地址；lan 模式仅公开健康检查和会话创建/删除入口，
// 其余接口需要 Bearer 令牌或短期会话 Cookie。配置由 provider 每次请求读取，
// 因此 accessMode 与 accessToken 可以热更新，令牌轮换也会立即使旧会话失效。
type AccessGate struct {
	provider func() *config.Config

	mu       sync.Mutex
	sessions map[string]accessSession
	failures map[string]loginFailures
	now      func() time.Time
	random   io.Reader
}

type accessSession struct {
	expiresAt   time.Time
	tokenDigest [sha256.Size]byte
}

type loginFailures struct {
	count       int
	windowStart time.Time
}

// NewAccessGate 创建一个访问控制器。provider 通常传 config.Manager.Get。
func NewAccessGate(provider func() *config.Config) *AccessGate {
	return &AccessGate{
		provider: provider,
		sessions: make(map[string]accessSession),
		failures: make(map[string]loginFailures),
		now:      time.Now,
		random:   rand.Reader,
	}
}

// Middleware 返回可挂载到 /api 的 Fiber 中间件。
func (g *AccessGate) Middleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := g.currentConfig()
		if cfg == nil {
			return accessError(c, fiber.StatusServiceUnavailable, "access_config_unavailable", "access configuration is unavailable")
		}
		if !requestHostAllowed(string(c.Context().Host()), cfg) {
			return accessError(c, fiber.StatusForbidden, "request_host_rejected", "request host is not allowed")
		}
		if !sameOriginBrowserRequest(c) {
			return accessError(c, fiber.StatusForbidden, "cross_origin_request_rejected", "cross-origin browser requests are not allowed")
		}

		switch cfg.AccessMode {
		case config.AccessModeLocal:
			ip := net.ParseIP(c.Context().RemoteIP().String())
			if !isLocalIP(ip) {
				return accessError(c, fiber.StatusForbidden, "local_access_required", "this service is available from the local machine only")
			}
			c.Locals(accessAuthenticated, true)
			return c.Next()
		case config.AccessModeLAN:
			authorized := g.authorized(c, cfg.AccessToken)
			if authorized {
				c.Locals(accessAuthenticated, true)
			}
			if isPublicAccessRoute(c) {
				return c.Next()
			}
			if authorized {
				return c.Next()
			}
			return accessError(c, fiber.StatusUnauthorized, "authentication_required", "a valid access credential is required")
		default:
			// 配置应在启动/更新时被 Validate 拦截。这里保持 fail-closed，
			// 避免未来调用方漏掉校验后意外开放 API。
			return accessError(c, fiber.StatusServiceUnavailable, "invalid_access_config", "access configuration is invalid")
		}
	}
}

// AccessAuthenticated 报告当前请求是否已通过 AccessGate 的本机或 LAN 凭据校验。
// 公开端点可据此只向已认证请求返回诊断详情。
func AccessAuthenticated(c *fiber.Ctx) bool {
	authenticated, _ := c.Locals(accessAuthenticated).(bool)
	return authenticated
}

// SessionCreateHandler 用访问令牌换取短期、HttpOnly 的同源会话 Cookie。
// 令牌只能放在 Authorization: Bearer 或 JSON body 的 token 字段中；有意
// 不支持 query 参数，避免凭据进入 URL、访问日志、浏览器历史和 Referer。
func (g *AccessGate) SessionCreateHandler() fiber.Handler {
	type sessionRequest struct {
		Token string `json:"token"`
	}
	return func(c *fiber.Ctx) error {
		cfg := g.currentConfig()
		if cfg == nil {
			return accessError(c, fiber.StatusServiceUnavailable, "access_config_unavailable", "access configuration is unavailable")
		}
		if cfg.AccessMode == config.AccessModeLocal {
			return c.JSON(fiber.Map{"authenticated": true, "mode": config.AccessModeLocal})
		}
		if cfg.AccessMode != config.AccessModeLAN {
			return accessError(c, fiber.StatusServiceUnavailable, "invalid_access_config", "access configuration is invalid")
		}
		if len(c.Body()) > maxAuthRequestBytes {
			return accessError(c, fiber.StatusRequestEntityTooLarge, "auth_request_too_large", "authentication request is too large")
		}

		provided := bearerCredential(c.Get(fiber.HeaderAuthorization))
		if provided == "" && len(c.Body()) > 0 {
			var request sessionRequest
			if err := c.BodyParser(&request); err != nil {
				return accessError(c, fiber.StatusBadRequest, "invalid_auth_request", "authentication request is invalid")
			}
			provided = request.Token
		}
		if len(provided) > config.MaxAccessTokenLength {
			return accessError(c, fiber.StatusBadRequest, "access_token_too_long", "access token is too long")
		}
		if !sameCredential(provided, cfg.AccessToken) {
			if g.recordLoginFailure(c.Context().RemoteIP().String()) {
				c.Set(fiber.HeaderRetryAfter, "300")
				return accessError(c, fiber.StatusTooManyRequests, "too_many_auth_attempts", "too many failed authentication attempts")
			}
			return accessError(c, fiber.StatusUnauthorized, "invalid_access_token", "access token is invalid")
		}
		g.clearLoginFailures(c.Context().RemoteIP().String())

		sessionID, expiresAt, err := g.createSession(cfg.AccessToken)
		if err != nil {
			return accessError(c, fiber.StatusInternalServerError, "session_creation_failed", "could not create access session")
		}
		c.Cookie(&fiber.Cookie{
			Name:     accessSessionCookie,
			Value:    sessionID,
			Path:     "/api",
			Expires:  expiresAt,
			MaxAge:   int(accessSessionTTL.Seconds()),
			Secure:   c.Context().IsTLS(),
			HTTPOnly: true,
			SameSite: fiber.CookieSameSiteStrictMode,
		})
		return c.JSON(fiber.Map{
			"authenticated": true,
			"mode":          config.AccessModeLAN,
			"expiresAt":     expiresAt.UTC(),
		})
	}
}

// SessionDeleteHandler 删除当前短期会话并清除 Cookie。该入口本身不要求
// 会话仍然有效，保证令牌轮换或会话过期后浏览器也能完成本地登出清理。
func (g *AccessGate) SessionDeleteHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		if sessionID := c.Cookies(accessSessionCookie); sessionID != "" {
			g.mu.Lock()
			delete(g.sessions, sessionID)
			g.mu.Unlock()
		}
		c.Cookie(&fiber.Cookie{
			Name:     accessSessionCookie,
			Value:    "",
			Path:     "/api",
			Expires:  time.Unix(1, 0),
			MaxAge:   -1,
			Secure:   c.Context().IsTLS(),
			HTTPOnly: true,
			SameSite: fiber.CookieSameSiteStrictMode,
		})
		return c.SendStatus(fiber.StatusNoContent)
	}
}

// SessionStatusHandler 让前端在渲染业务页前确认当前会话，
// 不返回或刷新任何凭据。
func (g *AccessGate) SessionStatusHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := g.currentConfig()
		if cfg == nil {
			return accessError(c, fiber.StatusServiceUnavailable, "access_config_unavailable", "access configuration is unavailable")
		}
		switch cfg.AccessMode {
		case config.AccessModeLocal:
			return c.JSON(fiber.Map{"authenticated": true, "mode": config.AccessModeLocal})
		case config.AccessModeLAN:
			return c.JSON(fiber.Map{
				"authenticated": g.authorized(c, cfg.AccessToken),
				"mode":          config.AccessModeLAN,
			})
		default:
			return accessError(c, fiber.StatusServiceUnavailable, "invalid_access_config", "access configuration is invalid")
		}
	}
}

func (g *AccessGate) currentConfig() *config.Config {
	if g == nil || g.provider == nil {
		return nil
	}
	return g.provider()
}

func (g *AccessGate) authorized(c *fiber.Ctx, expectedToken string) bool {
	if sameCredential(bearerCredential(c.Get(fiber.HeaderAuthorization)), expectedToken) {
		return true
	}
	if !sameOriginCookieRequest(c) {
		return false
	}
	sessionID := c.Cookies(accessSessionCookie)
	if sessionID == "" {
		return false
	}
	return g.validSession(sessionID, expectedToken)
}

func (g *AccessGate) createSession(accessToken string) (string, time.Time, error) {
	raw := make([]byte, 32)
	if _, err := io.ReadFull(g.random, raw); err != nil {
		return "", time.Time{}, err
	}
	sessionID := base64.RawURLEncoding.EncodeToString(raw)
	expiresAt := g.now().Add(accessSessionTTL)
	record := accessSession{
		expiresAt:   expiresAt,
		tokenDigest: sha256.Sum256([]byte(accessToken)),
	}

	g.mu.Lock()
	defer g.mu.Unlock()
	g.pruneSessionsLocked(g.now())
	if len(g.sessions) >= maxAccessSessions {
		g.removeEarliestSessionLocked()
	}
	g.sessions[sessionID] = record
	return sessionID, expiresAt, nil
}

func (g *AccessGate) validSession(sessionID, accessToken string) bool {
	now := g.now()
	wantDigest := sha256.Sum256([]byte(accessToken))

	g.mu.Lock()
	defer g.mu.Unlock()
	record, ok := g.sessions[sessionID]
	if !ok {
		return false
	}
	if !now.Before(record.expiresAt) || subtle.ConstantTimeCompare(record.tokenDigest[:], wantDigest[:]) != 1 {
		delete(g.sessions, sessionID)
		return false
	}
	return true
}

func (g *AccessGate) pruneSessionsLocked(now time.Time) {
	for id, session := range g.sessions {
		if !now.Before(session.expiresAt) {
			delete(g.sessions, id)
		}
	}
}

func (g *AccessGate) removeEarliestSessionLocked() {
	var earliestID string
	var earliestExpiry time.Time
	for id, session := range g.sessions {
		if earliestID == "" || session.expiresAt.Before(earliestExpiry) {
			earliestID = id
			earliestExpiry = session.expiresAt
		}
	}
	if earliestID != "" {
		delete(g.sessions, earliestID)
	}
}

func (g *AccessGate) recordLoginFailure(source string) bool {
	now := g.now()
	g.mu.Lock()
	defer g.mu.Unlock()
	for key, failure := range g.failures {
		if !now.Before(failure.windowStart.Add(loginFailureWindow)) {
			delete(g.failures, key)
		}
	}
	if len(g.failures) >= maxLoginSources {
		var oldestKey string
		var oldest time.Time
		for key, failure := range g.failures {
			if oldestKey == "" || failure.windowStart.Before(oldest) {
				oldestKey = key
				oldest = failure.windowStart
			}
		}
		delete(g.failures, oldestKey)
	}

	failure := g.failures[source]
	if failure.windowStart.IsZero() || !now.Before(failure.windowStart.Add(loginFailureWindow)) {
		failure = loginFailures{windowStart: now}
	}
	failure.count++
	g.failures[source] = failure
	return failure.count > maxLoginFailures
}

func (g *AccessGate) clearLoginFailures(source string) {
	g.mu.Lock()
	delete(g.failures, source)
	g.mu.Unlock()
}

func isPublicAccessRoute(c *fiber.Ctx) bool {
	path := strings.TrimSuffix(c.Path(), "/")
	if path == "/api/health" && (c.Method() == fiber.MethodGet || c.Method() == fiber.MethodHead) {
		return true
	}
	if path == "/api/auth/session" && (c.Method() == fiber.MethodGet || c.Method() == fiber.MethodPost || c.Method() == fiber.MethodDelete) {
		return true
	}
	return false
}

func bearerCredential(header string) string {
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
		return ""
	}
	return parts[1]
}

func sameCredential(provided, expected string) bool {
	if len(provided) > config.MaxAccessTokenLength || len(expected) > config.MaxAccessTokenLength {
		return false
	}
	// 比较定长摘要，避免字符串长度差异造成明显的比较时序泄漏。
	providedDigest := sha256.Sum256([]byte(provided))
	expectedDigest := sha256.Sum256([]byte(expected))
	return provided != "" && expected != "" && subtle.ConstantTimeCompare(providedDigest[:], expectedDigest[:]) == 1
}

func sameOriginCookieRequest(c *fiber.Ctx) bool {
	return sameOriginBrowserRequest(c)
}

// requestHostAllowed 拒绝任意域名 Host，避免攻击者把自己的域名通过 DNS
// rebinding 指向本机或局域网地址后，借浏览器同源权限调用 API。IP 字面量、
// localhost 和配置中明确指定的监听主机可以访问；通配监听地址不会扩大域名白名单。
func requestHostAllowed(requestHost string, cfg *config.Config) bool {
	host := normalizeRequestHost(requestHost)
	if host == "" || cfg == nil {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	if ip := net.ParseIP(host); ip != nil {
		return cfg.AccessMode == config.AccessModeLAN || ip.IsLoopback()
	}
	if cfg.AccessMode != config.AccessModeLAN {
		return false
	}

	configured := normalizeRequestHost(cfg.Host)
	if configured == "" || net.ParseIP(configured) != nil {
		return false
	}
	return strings.EqualFold(host, configured)
}

func normalizeRequestHost(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if host, _, err := net.SplitHostPort(value); err == nil {
		return strings.Trim(host, "[]")
	}
	return strings.Trim(value, "[]")
}

// sameOriginBrowserRequest 拦截浏览器跨源与同站跨源请求。非浏览器客户端和
// EventSource 可能不发送 Origin / Sec-Fetch-Site，因此无这些头时仍可访问。
func sameOriginBrowserRequest(c *fiber.Ctx) bool {
	switch strings.ToLower(c.Get("Sec-Fetch-Site")) {
	case "cross-site", "same-site":
		return false
	}
	origin := c.Get(fiber.HeaderOrigin)
	if origin == "" {
		// EventSource、直接地址栏导航和非浏览器客户端不一定发送 Origin。
		// Host-only + SameSite=Strict Cookie 仍然约束浏览器跨站发送。
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || u.Scheme == "" {
		return false
	}
	requestScheme := "http"
	if c.Context().IsTLS() {
		requestScheme = "https"
	}
	return strings.EqualFold(u.Host, string(c.Context().Host())) && strings.EqualFold(u.Scheme, requestScheme)
}

func accessError(c *fiber.Ctx, status int, code, message string) error {
	return httputil.Error(c, status, code, message)
}
