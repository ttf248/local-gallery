package handlers

import (
	"os"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/middleware"
)

// ImageHandler 返回 /api/images 原图（支持 Range 请求）。
//
//   GET /api/images?path=<绝对路径>
//
// T11：基础 Range 支持由 Fiber 内置 ServeFile 提供。
// T14：路径安全校验在 path_safety 中间件统一处理。
func ImageHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		// T11 简化：直接 ServeFile；T14 加路径安全
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		c.Set("Cache-Control", "public, max-age=86400")
		return c.SendFile(path, false)
	}
}

// 引用 middleware 包以确保 import 路径正确
var _ = middleware.Recover
