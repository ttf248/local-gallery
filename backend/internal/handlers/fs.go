package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/middleware"
)

// FsOpenHandler 在系统文件管理器中打开 path。
// 当 mgr 当前 AllowOsOpen=false 时返回 403；AllowOsOpen 可通过 /api/config
// 在运行中切换。
func FsOpenHandler(mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := mgr.Get()
		if !cfg.AllowOsOpen {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"error": "allowOsOpen is disabled",
			})
		}
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		if err := middleware.OpenInOS(path); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}
