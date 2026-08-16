package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/services"
)

// ThumbHandler 返回 /api/thumbs/* 处理函数。
//
//   GET /api/thumbs?path=<absolute>
//   GET /api/thumbs/<key>.png（key 可由客户端先调 /api/albums/*/thumbkey 获取）
//
// T5 简化版：仅接受 ?path=<绝对路径>，服务端校验在 ComicRoot 内。
func ThumbHandler(svc *services.ThumbnailService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		// T5: 接受原始绝对路径作为参数；T14 加入路径安全中间件统一校验
		raw := c.Query("path")
		if raw == "" {
			// 兼容 /api/thumbs/:key 形式，但暂不实现（前端直接传 path 更简单）
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}

		data, err := svc.GetOrCreate(raw)
		if err != nil {
			switch {
			case errors.Is(err, services.ErrSourceMissing):
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "source not found",
				})
			case errors.Is(err, services.ErrUnsupportedFormat):
				return c.Status(fiber.StatusUnsupportedMediaType).JSON(fiber.Map{
					"error": "unsupported format",
				})
			default:
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error": err.Error(),
				})
			}
		}

		c.Set("Content-Type", "image/png")
		c.Set("Cache-Control", "public, max-age=2592000") // 30 天
		return c.Send(data)
	}
}

// ThumbStatsHandler 返回缩略图缓存统计。
func ThumbStatsHandler(svc *services.ThumbnailService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(svc.Stats())
	}
}

// ThumbCleanupHandler 返回清理过期缓存的处理函数（POST）。
func ThumbCleanupHandler(svc *services.ThumbnailService) fiber.Handler {
	return ThumbCleanupHandlerWithCacheStats(svc, nil)
}

// ThumbCleanupHandlerWithCacheStats 清理过期缩略图缓存后,通知 cacheStats
// 失效,让前端的"缓存占用"展示立即反映清理结果。
// cacheStats 为 nil 时退化为 ThumbCleanupHandler 行为(向后兼容测试)。
func ThumbCleanupHandlerWithCacheStats(svc *services.ThumbnailService, cacheStats *services.CacheStatsService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		n, err := svc.Cleanup()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		if cacheStats != nil {
			cacheStats.Invalidate()
		}
		return c.JSON(fiber.Map{"deleted": n})
	}
}
