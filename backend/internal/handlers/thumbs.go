package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

// ThumbHandler 返回 /api/thumbs/* 处理函数。
//
//   GET /api/thumbs?path=<absolute>
//   GET /api/thumbs/<key>.png（key 可由客户端先调 /api/albums/*/thumbkey 获取）
//
// T5 简化版：仅接受 ?path=<绝对路径>，服务端校验在 ComicRoot 内。
//
// 视频路径时：若封面已缓存则正常返回；未缓存时返回 404 + code
// "video_cover_missing"，前端据此触发 `<video>` 抽帧后回传
// POST /api/thumbs/cover。
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
			case errors.Is(err, services.ErrVideoCoverMissing):
				// 视频封面未生成 → 前端抽帧后回传
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "video cover not yet extracted",
					"code":  "video_cover_missing",
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

// ThumbCoverHandler 接收前端浏览器抽帧后的视频封面字节，写入缓存。
//
//   POST /api/thumbs/cover?path=<absolute_video_path>
//   Content-Type: image/jpeg | image/png
//   Body: 原始图片字节（canvas.toBlob('image/jpeg', 0.85) 典型）
//
// 成功：200 + { ok: true, bytes: <int> }
// 失败：
//   - 400：path 缺失 / body 为空
//   - 404：视频文件不存在
//   - 413：payload 超过 5 MB（防 OOM）
//   - 415：上传的字节不是合法图片 / 路径不是视频
//   - 500：写盘失败
//
// 设计要点：
//   - 不依赖 ffmpeg：服务端只 decode + resize + 缓存，不解析视频容器
//   - 字节大小限制：单张封面 5 MB 足够 4K canvas JPEG（4K JPEG 8bit ~3 MB）
//   - 与 /api/thumbs 的 key 体系一致：mtime/size 变化自动失效
//
// 注意：直接用 c.Body() 读整 body。Fiber 默认 BodyLimit=4MiB，所以
// 启动时需要在 app/fiber.Config{ BodyLimit: 6 MiB } 给该接口留点余量。
// BodyLimit 是 Fiber 全局设置，本 handler 不另行检查（Fiber 自身会
// 拦截超大请求并返回 413）。
func ThumbCoverHandler(svc *services.ThumbnailService) fiber.Handler {
	const maxCoverBytes = 5 * 1024 * 1024 // 5 MB
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		body := c.Body()
		if len(body) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "empty body",
			})
		}
		if len(body) > maxCoverBytes {
			return c.Status(fiber.StatusRequestEntityTooLarge).JSON(fiber.Map{
				"error": "cover payload too large",
			})
		}
		if err := svc.SaveVideoCover(path, body); err != nil {
			switch {
			case errors.Is(err, services.ErrSourceMissing):
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "source video not found"})
			case errors.Is(err, services.ErrUnsupportedFormat):
				return c.Status(fiber.StatusUnsupportedMediaType).JSON(fiber.Map{
					"error": "cover data is not a valid image",
				})
			default:
				// 非视频路径会落到这里（fmt.Errorf），返回 400 更准确
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": err.Error(),
				})
			}
		}
		return c.JSON(fiber.Map{"ok": true, "bytes": len(body)})
	}
}
