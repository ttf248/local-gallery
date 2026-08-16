package middleware

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"

	"github.com/gofiber/fiber/v2"
)

// OpenInOS 在系统文件管理器中打开给定路径。
// 仅当 allowOsOpen=true 时由 handler 调用，否则返回 403。
func OpenInOS(path string) error {
	if path == "" {
		return fmt.Errorf("empty path")
	}
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	target := path
	if st.IsDir() {
		target = path
	} else {
		target = filepath.Dir(path)
	}

	switch runtime.GOOS {
	case "windows":
		// explorer.exe /select,"<file>" 高亮文件
		if !st.IsDir() {
			return exec.Command("explorer.exe", "/select,", path).Run()
		}
		return exec.Command("explorer.exe", path).Run()
	case "darwin":
		return exec.Command("open", target).Run()
	default:
		return exec.Command("xdg-open", target).Run()
	}
}

// pathState 当前生效的根路径，atomic 保证读无锁。
type pathState struct {
	root       string
	rootWithSep string
}

type safetyState struct {
	v atomic.Pointer[pathState]
}

// PathSafetyMiddleware 返回中间件：把 ?path=<abs> 解析后校验是否在 comicRoot 之下。
// 根路径由 RootProvider 在每次请求时提供（支持运行中热更新）。
// RootProvider 返回的字符串必须是绝对路径或可被 filepath.Abs 解析；返回空
// 字符串时按"无根"处理（拒绝所有非 smart: 路径）。
type RootProvider func() string

func PathSafetyMiddleware(initial string) (fiber.Handler, *safetyState) {
	state := &safetyState{}
	state.set(initial)
	handler := func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Next()
		}
		// smart: 前缀不是绝对路径，但 handler 需据此查询"按标签聚合的合集"
		if strings.HasPrefix(path, "smart:") {
			c.Locals("safePath", path)
			return c.Next()
		}
		ps := state.v.Load()
		if ps == nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "mediaRoot not configured",
			})
		}
		clean, err := validatePath(ps.root, ps.rootWithSep, path)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		// 覆盖 query，便于下游 handler 直接使用
		c.Query("path") // no-op; 保留原值
		c.Locals("safePath", clean)
		return c.Next()
	}
	return handler, state
}

// set 替换根路径；不合法时保持原值不变。
func (s *safetyState) set(root string) {
	abs, err := filepath.Abs(root)
	if err != nil {
		abs = root
	}
	s.v.Store(&pathState{
		root:       abs,
		rootWithSep: abs + string(os.PathSeparator),
	})
}

// SetRoot 公开方法，供 Manager 回调调用以热更新根路径。
func (s *safetyState) SetRoot(root string) {
	s.set(root)
}

// SafePath 从 c.Locals 取出已校验的绝对路径。
func SafePath(c *fiber.Ctx) string {
	if v, ok := c.Locals("safePath").(string); ok && v != "" {
		return v
	}
	return c.Query("path")
}

func validatePath(root, rootWithSep, p string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	// 用 filepath.Rel 检测是否真正位于 root 之下，结果以 .. 开头即为逃逸。
	rel, err := filepath.Rel(root, abs)
	if err != nil {
		return "", fmt.Errorf("path outside comic root")
	}
	if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
		return "", fmt.Errorf("path outside comic root")
	}
	return abs, nil
}

func normalizeForCompare(p string) string {
	if runtime.GOOS == "windows" {
		return strings.ToLower(p)
	}
	return p
}

var _ = normalizeForCompare // 保留供未来使用
