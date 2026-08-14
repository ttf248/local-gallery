package middleware

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"

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

// PathSafetyMiddleware 返回中间件：把 ?path=<abs> 解析后校验是否在 comicRoot 之下。
// 不在校验范围或不是绝对路径的请求返回 400。
func PathSafetyMiddleware(comicRoot string) fiber.Handler {
	root, err := filepath.Abs(comicRoot)
	if err != nil {
		root = comicRoot
	}
	rootWithSep := root + string(os.PathSeparator)

	return func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Next()
		}
		clean, err := validatePath(root, rootWithSep, path)
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