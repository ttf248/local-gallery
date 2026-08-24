package handlers

import (
	"os"
	"path/filepath"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
)

// FsOpenHandler 在系统文件管理器中打开 path。
//
// 当 mgr 当前 AllowOsOpen=false 时返回 403；AllowOsOpen 可通过 /api/config
// 在运行中切换。
//
// 安全策略：
//   - 默认：path 由 path safety 中间件校验（必须在任一 mediaRoots 之下），
//     防止越权打开用户本地任意目录
//   - 当 query `allowConfig=1` 时：path_safety 中间件放行（设 skipSafety
//     标志），handler 自行从 c.Query("path") 读路径，并校验路径是 cfg
//     中某个已知字段（cacheDir / staticDir / mediaRoots / cwd）才放行；
//     用于让用户在 Settings 页能直接打开「缓存目录」/「前端构建目录」等
//     自配置路径
func FsOpenHandler(mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := mgr.Get()
		if !cfg.AllowOsOpen {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "allowOsOpen is disabled",
			})
		}

		var path string
		if middleware.IsSafetyBypassed(c) {
			// allowConfig 模式：跳过 path safety，handler 自己校验白名单
			path = c.Query("path")
			if path == "" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "missing 'path' query parameter",
				})
			}
			if !isAllowedConfigPath(path, cfg) {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"error": "path is not one of the configured cfg paths (cacheDir/staticDir/mediaRoots)",
				})
			}
		} else {
			// 常规模式：path 必须已经过 path safety 中间件校验
			path = middleware.SafePath(c)
			if path == "" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "missing 'path' query parameter",
				})
			}
		}

		if err := middleware.OpenInOS(path); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// isAllowedConfigPath 校验 path 是 cfg 中 cacheDir/staticDir/mediaRoots 之一。
// 用绝对路径 + Clean 规范化后比较，避免「./」「../」绕过。
func isAllowedConfigPath(path string, cfg *config.Config) bool {
	abs, err := filepath.Abs(path)
	if err != nil {
		return false
	}
	abs = filepath.Clean(abs)
	check := func(p string) bool {
		if p == "" {
			return false
		}
		ap, err := filepath.Abs(p)
		if err != nil {
			return false
		}
		return filepath.Clean(ap) == abs
	}
	if check(cfg.CacheDir) {
		return true
	}
	if check(cfg.StaticDir) {
		return true
	}
	for _, r := range cfg.Roots() {
		if check(r) {
			return true
		}
	}
	// 兜底：当前 cwd 也是允许的（用户常在 cwd 下启后端，cacheDir 默认就是它）
	if cwd, err := os.Getwd(); err == nil {
		if filepath.Clean(cwd) == abs {
			return true
		}
	}
	return false
}
