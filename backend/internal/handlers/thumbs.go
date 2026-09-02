package handlers

import (
	"errors"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// ThumbHandler 返回 /api/thumbs/* 处理函数。
//
//	GET /api/thumbs?path=<absolute>
//
// 视频路径时：若封面已缓存则正常返回；未缓存时返回 404 + code
// "video_cover_missing"，前端据此触发 `<video>` 抽帧后回传
// POST /api/thumbs/cover。
//
// 缓存协商（仅在 200 响应时启用）：响应 ETag = CacheKey（md5 16 字
// 节十六进制）。客户端带 If-None-Match 命中时返回 304 + 空 body，0
// 字节 0 CPU。配合 Cache-Control: max-age=2592000 实现「30 天内走
// 浏览器缓存，30 天后走 304 验证」的二层策略。
//
// 注意：4xx/5xx 响应**不**带 ETag —— 视频 404 状态本身是临时的
// (cover 抽帧后变成 200)，不能让浏览器把 404 缓存住，否则 cover
// 永远拿不到。
func ThumbHandler(svc *services.ThumbnailService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return httputil.BadRequest(c, "missing_path", "missing 'path' query parameter")
		}

		// 先尝试 ETag 协商：客户端带了 If-None-Match 且与当前文件
		// mtime/size 派生的 ETag 一致时直接 304,省掉 GetOrCreate 的
		// 磁盘读 + 解码 + 缩放 + JPEG 编码。这是冷启动 / 翻到未缓存合集
		// 时最常见的路径(20+ 张同时 miss,1 张命中都省好几 ms)。
		//
		// ETagFor 内部只调一次 os.Stat,失败时 (源文件不存在等) 返回
		// ErrSourceMissing,这种情况下必须走 GetOrCreate 让它返回 404
		// 而不是 304。
		if etag, etagErr := svc.ETagFor(path); etagErr == nil {
			etagQuoted := `"` + etag + `"`
			if match := c.Get("If-None-Match"); match != "" && match == etagQuoted {
				c.Set("ETag", etagQuoted)
				return c.SendStatus(fiber.StatusNotModified)
			}
		}

		data, err := svc.GetOrCreate(path)
		if err != nil {
			switch {
			case errors.Is(err, services.ErrSourceMissing):
				return httputil.NotFound(c, "source_not_found", "source not found")
			case errors.Is(err, services.ErrVideoCoverMissing):
				// 不带 ETag / Cache-Control —— 4xx 状态不能被浏览器长缓存，
				// 否则视频 cover 抽帧后用户再访问仍会拿到旧的 404。
				return httputil.NotFound(c, "video_cover_missing", "video cover not yet extracted")
			case errors.Is(err, services.ErrUnsupportedFormat):
				return httputil.Error(c, fiber.StatusUnsupportedMediaType, "unsupported_format", "unsupported format")
			default:
				return httputil.Internal(c, "thumbnail_error", err.Error())
			}
		}

		// 走到这里说明客户端没带 If-None-Match(或带但不匹配),
		// 需要把 ETag 带上方便客户端下次走 304。
		if etag, etagErr := svc.ETagFor(path); etagErr == nil {
			etagQuoted := `"` + etag + `"`
			c.Set("ETag", etagQuoted)
		}

		c.Set("Content-Type", "image/jpeg")
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

// ThumbClearAllHandler 强制清空全部缩略图缓存（POST /api/thumbs/clear）。
//
// 与 /api/thumbs/cleanup 的区别:cleanup 只删过期(maxAgeDays 天前),
// clear 不管 mtime,全部删除。响应包含删除文件数和释放字节数,
// 前端用于 toast「已清空 N 个文件 / 释放 X MB」。调用方在清空后通常
// 期望"强制重建"——清空只删数据,不会主动重新生成,下次访问
// GetOrCreate 会按需生成。
func ThumbClearAllHandlerWithCacheStats(svc *services.ThumbnailService, cacheStats *services.CacheStatsService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		deleted, freed, err := svc.ClearAll()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		if cacheStats != nil {
			cacheStats.Invalidate()
		}
		return c.JSON(fiber.Map{
			"deleted":    deleted,
			"freedBytes": freed,
		})
	}
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
//	POST /api/thumbs/cover?path=<absolute_video_path>
//	Content-Type: image/jpeg | image/png
//	Body: 原始图片字节（canvas.toBlob('image/jpeg', 0.85) 典型）
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
