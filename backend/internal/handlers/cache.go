// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

// CacheStatsResponse GET /api/cache/stats 的响应体。
type CacheStatsResponse struct {
	Path       string `json:"path"`
	TotalBytes int64  `json:"totalBytes"`
	FileCount  int    `json:"fileCount"`
	ScannedAt  string `json:"scannedAt"`
	DurationMs int64  `json:"durationMs"`
	Available  bool   `json:"available"`
	// CacheTTLSeconds 缓存剩余秒数(前端可据此显示"30s 前更新"等提示)
	CacheTTLSeconds int `json:"cacheTtlSeconds"`
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
			Path:       usage.Path,
			TotalBytes: usage.TotalBytes,
			FileCount:  usage.FileCount,
			ScannedAt:  usage.ScannedAt.UTC().Format("2006-01-02T15:04:05Z"),
			DurationMs: usage.DurationMs,
			Available:  usage.Available,
			CacheTTLSeconds: 0,
		}
		if expiresAt != nil {
			left := int(time.Until(*expiresAt).Seconds())
			if left > 0 {
				resp.CacheTTLSeconds = left
			}
		}
		return c.JSON(resp)
	}
}
