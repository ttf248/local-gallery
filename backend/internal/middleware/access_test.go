package middleware

import (
	"errors"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/valyala/fasthttp"

	"github.com/tianlongxiang/local-gallery/internal/config"
)

const testAccessToken = "0123456789abcdef0123456789abcdef"

func newAccessTestApp(cfg **config.Config) (*fiber.App, *AccessGate) {
	gate := NewAccessGate(func() *config.Config { return *cfg })
	app := fiber.New()
	api := app.Group("/api")
	api.Use(gate.Middleware())
	api.Get("/health", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })
	api.Get("/auth/session", gate.SessionStatusHandler())
	api.Post("/auth/session", gate.SessionCreateHandler())
	api.Delete("/auth/session", gate.SessionDeleteHandler())
	api.Get("/private", func(c *fiber.Ctx) error { return c.SendStatus(fiber.StatusNoContent) })
	return app, gate
}

func TestAccessGateLocalAllowsProcessLocalRequest(t *testing.T) {
	cfg := config.Default()
	app, _ := newAccessTestApp(&cfg)

	res := performAccessRequest(t, app, http.MethodGet, "/api/private", "", nil)
	if res.StatusCode != fiber.StatusNoContent {
		t.Fatalf("status=%d, want %d", res.StatusCode, fiber.StatusNoContent)
	}
	if isLocalIP([]byte{203, 0, 113, 8}) {
		t.Fatal("remote IP must not be considered local")
	}

	var request fasthttp.Request
	request.Header.SetMethod(http.MethodGet)
	request.Header.SetHost("example.com")
	request.SetRequestURI("/api/private")
	var requestContext fasthttp.RequestCtx
	requestContext.Init(&request, &net.TCPAddr{IP: net.ParseIP("203.0.113.8"), Port: 41234}, nil)
	app.Handler()(&requestContext)
	if status := requestContext.Response.StatusCode(); status != fiber.StatusForbidden {
		t.Fatalf("remote status=%d, want 403", status)
	}
}

func TestAccessGateRejectsDNSRebindingAndCrossOriginBrowserRequests(t *testing.T) {
	cfg := config.Default()
	app, _ := newAccessTestApp(&cfg)

	rebinding := httptest.NewRequest(http.MethodGet, "http://attacker.example/api/private", nil)
	rebindingResponse, err := app.Test(rebinding)
	if err != nil {
		t.Fatal(err)
	}
	if rebindingResponse.StatusCode != fiber.StatusForbidden {
		t.Fatalf("rebinding status=%d, want 403", rebindingResponse.StatusCode)
	}

	crossOrigin := httptest.NewRequest(http.MethodPost, "http://127.0.0.1/api/auth/session", strings.NewReader(`{"token":"ignored"}`))
	crossOrigin.Header.Set(fiber.HeaderOrigin, "http://attacker.example")
	crossOrigin.Header.Set("Sec-Fetch-Site", "cross-site")
	crossOriginResponse, err := app.Test(crossOrigin)
	if err != nil {
		t.Fatal(err)
	}
	if crossOriginResponse.StatusCode != fiber.StatusForbidden {
		t.Fatalf("cross-origin status=%d, want 403", crossOriginResponse.StatusCode)
	}
}

func TestAccessGateAllowsConfiguredHostnameButNotWildcardAsHostname(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	cfg.Host = "gallery.home"
	app, _ := newAccessTestApp(&cfg)

	allowed := httptest.NewRequest(http.MethodGet, "http://gallery.home/api/health", nil)
	allowedResponse, err := app.Test(allowed)
	if err != nil {
		t.Fatal(err)
	}
	if allowedResponse.StatusCode != fiber.StatusNoContent {
		t.Fatalf("configured host status=%d, want 204", allowedResponse.StatusCode)
	}

	cfg.Host = "0.0.0.0"
	arbitrary := httptest.NewRequest(http.MethodGet, "http://gallery.home/api/health", nil)
	arbitraryResponse, err := app.Test(arbitrary)
	if err != nil {
		t.Fatal(err)
	}
	if arbitraryResponse.StatusCode != fiber.StatusForbidden {
		t.Fatalf("wildcard host status=%d, want 403", arbitraryResponse.StatusCode)
	}
}

func TestAccessGateHostValidationUsesWireHostAndSupportsLoopbackIPv6(t *testing.T) {
	cfg := config.Default()
	app, _ := newAccessTestApp(&cfg)

	ipv6 := httptest.NewRequest(http.MethodGet, "http://[::1]:8080/api/private", nil)
	ipv6Response, err := app.Test(ipv6)
	if err != nil {
		t.Fatal(err)
	}
	if ipv6Response.StatusCode != fiber.StatusNoContent {
		t.Fatalf("IPv6 loopback status=%d, want 204", ipv6Response.StatusCode)
	}

	forwarded := httptest.NewRequest(http.MethodGet, "http://attacker.example/api/private", nil)
	forwarded.Header.Set("X-Forwarded-Host", "127.0.0.1")
	forwarded.Header.Set("X-Forwarded-Proto", "https")
	forwardedResponse, err := app.Test(forwarded)
	if err != nil {
		t.Fatal(err)
	}
	if forwardedResponse.StatusCode != fiber.StatusForbidden {
		t.Fatalf("forwarded host status=%d, want 403", forwardedResponse.StatusCode)
	}
}

func TestAccessGateLocalRejectsNonLoopbackIPHost(t *testing.T) {
	cfg := config.Default()
	app, _ := newAccessTestApp(&cfg)
	req := httptest.NewRequest(http.MethodGet, "http://192.168.1.10/api/private", nil)
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != fiber.StatusForbidden {
		t.Fatalf("status=%d, want 403", res.StatusCode)
	}
}

func TestAccessGateLANPublishesOnlyHealthAndSessionEndpoint(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, _ := newAccessTestApp(&cfg)

	health := performAccessRequest(t, app, http.MethodGet, "/api/health", "", nil)
	if health.StatusCode != fiber.StatusNoContent {
		t.Fatalf("health status=%d", health.StatusCode)
	}
	private := performAccessRequest(t, app, http.MethodGet, "/api/private", "", nil)
	if private.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("private status=%d, want 401", private.StatusCode)
	}
	query := performAccessRequest(t, app, http.MethodGet, "/api/private?token="+testAccessToken, "", nil)
	if query.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("query token status=%d, want 401", query.StatusCode)
	}
}

func TestAccessGateAcceptsBearerToken(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, _ := newAccessTestApp(&cfg)

	res := performAccessRequest(t, app, http.MethodGet, "/api/private", "", map[string]string{
		fiber.HeaderAuthorization: "Bearer " + testAccessToken,
	})
	if res.StatusCode != fiber.StatusNoContent {
		t.Fatalf("status=%d, want 204", res.StatusCode)
	}

	bad := performAccessRequest(t, app, http.MethodGet, "/api/private", "", map[string]string{
		fiber.HeaderAuthorization: "Bearer incorrect-token",
	})
	if bad.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("bad token status=%d, want 401", bad.StatusCode)
	}
}

func TestAccessGateSessionSupportsEventSourceCookie(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, _ := newAccessTestApp(&cfg)

	login := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"`+testAccessToken+`"}`, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if login.StatusCode != fiber.StatusOK {
		t.Fatalf("login status=%d", login.StatusCode)
	}
	cookies := login.Cookies()
	if len(cookies) != 1 {
		t.Fatalf("cookies=%v", cookies)
	}
	sessionCookie := cookies[0]
	if sessionCookie.Name != accessSessionCookie || sessionCookie.Value == "" {
		t.Fatalf("unexpected session cookie: %#v", sessionCookie)
	}
	setCookie := login.Header.Get(fiber.HeaderSetCookie)
	for _, required := range []string{"path=/api", "httponly", "samesite=strict"} {
		if !strings.Contains(strings.ToLower(setCookie), required) {
			t.Errorf("Set-Cookie %q missing %q", setCookie, required)
		}
	}
	if strings.Contains(setCookie, testAccessToken) {
		t.Fatal("configured access token leaked into session cookie")
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/private", nil)
	req.AddCookie(sessionCookie)
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != fiber.StatusNoContent {
		t.Fatalf("cookie-authenticated status=%d, want 204", res.StatusCode)
	}

	statusRequest := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/auth/session", nil)
	statusRequest.AddCookie(sessionCookie)
	status, err := app.Test(statusRequest)
	if err != nil {
		t.Fatal(err)
	}
	if status.StatusCode != fiber.StatusOK {
		t.Fatalf("session status=%d, want 200", status.StatusCode)
	}
	statusBody, _ := io.ReadAll(status.Body)
	if !strings.Contains(string(statusBody), `"authenticated":true`) {
		t.Fatalf("unexpected session status body: %s", statusBody)
	}
}

func TestAccessGateRejectsCrossOriginCookie(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, gate := newAccessTestApp(&cfg)
	sessionID, _, err := gate.createSession(testAccessToken)
	if err != nil {
		t.Fatal(err)
	}

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/private", nil)
	req.AddCookie(&http.Cookie{Name: accessSessionCookie, Value: sessionID})
	req.Header.Set("Origin", "http://attacker.example")
	req.Header.Set("Sec-Fetch-Site", "cross-site")
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != fiber.StatusForbidden {
		t.Fatalf("status=%d, want 403", res.StatusCode)
	}
}

func TestAccessGateTokenRotationAndExpiryInvalidateSessions(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, gate := newAccessTestApp(&cfg)
	clock := time.Date(2026, 9, 4, 10, 0, 0, 0, time.UTC)
	gate.now = func() time.Time { return clock }
	sessionID, _, err := gate.createSession(testAccessToken)
	if err != nil {
		t.Fatal(err)
	}

	requestWithSession := func() *http.Response {
		req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1/api/private", nil)
		req.AddCookie(&http.Cookie{Name: accessSessionCookie, Value: sessionID})
		res, requestErr := app.Test(req)
		if requestErr != nil {
			t.Fatal(requestErr)
		}
		return res
	}
	if got := requestWithSession().StatusCode; got != fiber.StatusNoContent {
		t.Fatalf("initial status=%d", got)
	}

	cfg.AccessToken = "fedcba9876543210fedcba9876543210"
	if got := requestWithSession().StatusCode; got != fiber.StatusUnauthorized {
		t.Fatalf("rotated-token status=%d, want 401", got)
	}

	cfg.AccessToken = testAccessToken
	sessionID, _, err = gate.createSession(testAccessToken)
	if err != nil {
		t.Fatal(err)
	}
	clock = clock.Add(accessSessionTTL + time.Second)
	if got := requestWithSession().StatusCode; got != fiber.StatusUnauthorized {
		t.Fatalf("expired-session status=%d, want 401", got)
	}
}

func TestAccessGateSessionCreationFailureDoesNotExposeToken(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, gate := newAccessTestApp(&cfg)
	gate.random = errorReader{}

	res := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"`+testAccessToken+`"}`, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if res.StatusCode != fiber.StatusInternalServerError {
		t.Fatalf("status=%d, want 500", res.StatusCode)
	}
	buf, _ := io.ReadAll(res.Body)
	if strings.Contains(string(buf), testAccessToken) {
		t.Fatal("response leaked access token")
	}
}

func TestAccessGateBoundsAuthenticationInputAndRateLimitsFailures(t *testing.T) {
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = testAccessToken
	app, _ := newAccessTestApp(&cfg)

	largeBody := `{"token":"` + strings.Repeat("x", maxAuthRequestBytes) + `"}`
	tooLarge := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", largeBody, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if tooLarge.StatusCode != fiber.StatusRequestEntityTooLarge {
		t.Fatalf("large body status=%d, want 413", tooLarge.StatusCode)
	}

	for attempt := 1; attempt <= maxLoginFailures; attempt++ {
		failed := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"wrong"}`, map[string]string{
			fiber.HeaderContentType: fiber.MIMEApplicationJSON,
		})
		if failed.StatusCode != fiber.StatusUnauthorized {
			t.Fatalf("attempt %d status=%d, want 401", attempt, failed.StatusCode)
		}
	}
	limited := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"wrong"}`, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if limited.StatusCode != fiber.StatusTooManyRequests || limited.Header.Get(fiber.HeaderRetryAfter) == "" {
		t.Fatalf("limited status=%d retry-after=%q", limited.StatusCode, limited.Header.Get(fiber.HeaderRetryAfter))
	}

	// 正确令牌不被恶意失败尝试锁死，并会清理该来源计数。
	success := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"`+testAccessToken+`"}`, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if success.StatusCode != fiber.StatusOK {
		t.Fatalf("correct token status=%d, want 200", success.StatusCode)
	}
	again := performAccessRequest(t, app, http.MethodPost, "/api/auth/session", `{"token":"wrong"}`, map[string]string{
		fiber.HeaderContentType: fiber.MIMEApplicationJSON,
	})
	if again.StatusCode != fiber.StatusUnauthorized {
		t.Fatalf("post-success failure status=%d, want 401", again.StatusCode)
	}
}

func TestAccessGateFailsClosedWithoutConfig(t *testing.T) {
	var cfg *config.Config
	app, _ := newAccessTestApp(&cfg)
	res := performAccessRequest(t, app, http.MethodGet, "/api/private", "", nil)
	if res.StatusCode != fiber.StatusServiceUnavailable {
		t.Fatalf("status=%d, want 503", res.StatusCode)
	}
}

type errorReader struct{}

func (errorReader) Read([]byte) (int, error) {
	return 0, errors.New("random source unavailable")
}

func performAccessRequest(t *testing.T, app *fiber.App, method, target, body string, headers map[string]string) *http.Response {
	t.Helper()
	req := httptest.NewRequest(method, "http://127.0.0.1"+target, strings.NewReader(body))
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	return res
}
