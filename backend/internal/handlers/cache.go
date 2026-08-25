// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// CacheStatsResponse GET /api/cache/stats 的响应体。
//
// 与 services.CacheUsage 字段一一对应,前端 Settings 缓存占用行需要
// 三个子项(thumbs / videoFaststart / videoTranscode)来告诉用户大头在哪。
// 任何字段缺失都会让前端的 SubUsageBadge 拿到 undefined,直接读 .available
// 时炸掉整页。
type CacheStatsResponse struct {
	Path       string `json:"path"`
	TotalBytes int64  `json:"totalBytes"`
	FileCount  int    `json:"fileCount"`
	ScannedAt  string `json:"scannedAt"`
	DurationMs int64  `json:"durationMs"`
	Available  bool   `json:"available"`
	// CacheTTLSeconds 缓存剩余秒数(前端可据此显示"30s 前更新"等提示)
	CacheTTLSeconds int `json:"cacheTtlSeconds"`
	// 按子目录细分:thumbs / video-faststart / video-transcode。
	// 子目录不存在时 Available=false,前端灰显。
	Thumbs         services.SubUsage `json:"thumbs"`
	VideoFaststart services.SubUsage `json:"videoFaststart"`
	VideoTranscode services.SubUsage `json:"videoTranscode"`
}

// CacheStatsHandler 返回 /api/cache/stats 处理函数。
//
// 计算 mgr 当前 cacheDir 的总占用 + 文件数;带 30s 内存 TTL,
// 频繁刷新不会重复扫描磁盘。Cleanup / 删除缓存后 handler 会 invalidate。
func CacheStatsHandler(mgr *config.Manager, stats *services.CacheStatsService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := mgr.Get()
		usage, expiresAt, err := stats.Usage(cfg.CacheDir)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		resp := CacheStatsResponse{
			Path:            "cache",
			TotalBytes:      usage.TotalBytes,
			FileCount:       usage.FileCount,
			ScannedAt:       usage.ScannedAt.UTC().Format("2006-01-02T15:04:05Z"),
			DurationMs:      usage.DurationMs,
			Available:       usage.Available,
			CacheTTLSeconds: 0,
			Thumbs:          usage.Thumbs,
			VideoFaststart:  usage.VideoFaststart,
			VideoTranscode:  usage.VideoTranscode,
		}
		resp.Thumbs.Path = "thumbs"
		resp.VideoFaststart.Path = "video-faststart"
		resp.VideoTranscode.Path = "video-transcode"
		if expiresAt != nil {
			left := int(time.Until(*expiresAt).Seconds())
			if left > 0 {
				resp.CacheTTLSeconds = left
			}
		}
		return c.JSON(resp)
	}
}
