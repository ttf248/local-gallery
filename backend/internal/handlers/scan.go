package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/services"
)

// ScanHandler 返回 /api/scan 同步扫描处理函数。
//
// POST /api/scan               使用配置中的 ComicRoot
// POST /api/scan?root=...      使用传入的绝对路径（仍在 ComicRoot 内校验）
func ScanHandler(scanner *services.Scanner, comicRoot string) fiber.Handler {
	type resp struct {
		OK     bool   `json:"ok"`
		Error  string `json:"error,omitempty"`
		Result any    `json:"result,omitempty"`
	}

	return func(c *fiber.Ctx) error {
		// T4：直接使用配置中的 ComicRoot；路径安全校验在 T6 加。
		result, err := scanner.Scan(services.ScanOptions{
			Root:     comicRoot,
			MaxDepth: 2,
		})
		if err != nil {
			status := fiber.StatusInternalServerError
			if se, ok := err.(*services.ScanError); ok {
				switch se.Kind {
				case services.ScanRootMissing, services.ScanRootNotDir:
					status = fiber.StatusBadRequest
				}
			}
			return c.Status(status).JSON(resp{Error: err.Error()})
		}
		return c.JSON(resp{OK: true, Result: result})
	}
}
