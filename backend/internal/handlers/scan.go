package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// AsyncScanStartHandler 启动异步扫描，返回 scan_id。
//
// POST /api/scan/start
func AsyncScanStartHandler(runner *services.AsyncScanRunner, mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, _, reused, err := runner.StartOrReuse(ScanOptionsFromConfig(mgr))
		if err != nil {
			return writeError(c, fiber.StatusBadRequest, "scan_start_failed", "unable to start scan")
		}
		return c.JSON(fiber.Map{"scanId": id, "reused": reused})
	}
}

// ScanOptionsFromConfig 是启动自动扫描与 HTTP 手动扫描的唯一策略入口。
// 默认不设置 MaxDepth，完整递归所有可访问目录。
func ScanOptionsFromConfig(mgr *config.Manager) services.ScanOptions {
	return services.ScanOptions{
		Roots:   mgr.Roots(),
		Exclude: excludeFromConfig(mgr),
	}
}

// excludeFromConfig 把 Manager 当前配置转成归一化的 ExcludeConfig。
// 抽成 helper 是为了 ScanHandler / AsyncScanStartHandler 共用,避免两处
// 各写一遍(否则改天加字段容易漏改)。
func excludeFromConfig(mgr *config.Manager) services.ExcludeConfig {
	cfg := mgr.Get()
	return services.NormalizeExcludeConfig(
		cfg.SkipHidden,
		cfg.SystemFiles,
		cfg.ExcludePatterns,
	)
}

// AsyncScanEventsHandler SSE 事件流。
//
// GET /api/scan/:id/events
func AsyncScanEventsHandler(runner *services.AsyncScanRunner) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		if id == "" {
			return writeError(c, fiber.StatusBadRequest, "missing_scan_id", "missing scan id")
		}

		state := runner.Get(id)
		if state == nil {
			return writeError(c, fiber.StatusNotFound, "scan_not_found", "scan not found")
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		// 已完成：直接发最终事件后返回
		if state.Status != services.ScanStatusRunning &&
			state.Status != services.ScanStatusPending {
			ev := services.ProgressEvent{
				ScanID:          id,
				Progress:        100,
				Status:          state.Status,
				AlbumsFound:     len(state.Albums),
				LibraryRevision: state.Revision,
			}
			if state.Result != nil {
				ev.AlbumsFound = state.Result.AlbumCount
			}
			if state.Err != nil && state.Status == services.ScanStatusError {
				// 扫描器内部错误可能包含本地绝对路径，公共响应只返回
				// 稳定错误类型；详细原因保留在服务端诊断范围内。
				ev.Error = "scan failed"
			}
			writeSSE(c, string(ev.Status), ev)
			return nil
		}

		events, unsubscribe, ok := runner.Subscribe(id)
		if !ok {
			return writeError(c, fiber.StatusNotFound, "scan_not_found", "scan not found")
		}

		// 流式推送；每个连接使用独立订阅，不会与其它客户端竞争消费。
		c.Response().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer unsubscribe()
			defer w.Flush()
			for ev := range events {
				data, _ := json.Marshal(ev)
				fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Status, data)
				w.Flush()
				if ev.Status != services.ScanStatusRunning {
					return
				}
			}
		})

		return nil
	}
}

// AsyncScanCancelHandler 取消正在进行的扫描。
//
// DELETE /api/scan/:id
func AsyncScanCancelHandler(runner *services.AsyncScanRunner) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		state := runner.Get(id)
		if state == nil {
			return writeError(c, fiber.StatusNotFound, "scan_not_found", "scan not found")
		}
		if state.Status != services.ScanStatusRunning && state.Status != services.ScanStatusPending {
			return c.JSON(fiber.Map{"ok": true, "alreadyDone": true})
		}
		state.Cancel()
		return c.JSON(fiber.Map{"ok": true})
	}
}

// ScanCacheClearHandler 强制清空扫描结果缓存（POST /api/scan/cache/clear）。
//
// 同时清掉 ScanResultCache 内存和磁盘 scan_cache.json 文件。
// 清空后 manifest 不再可用；前端应提示用户「建议重新扫描」。
func ScanCacheClearHandler(
	scanCache *services.ScanResultCache,
	catalog *services.ResourceCatalog,
	runner *services.AsyncScanRunner,
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if runner != nil {
			runner.Invalidate()
		}
		var err error
		if catalog != nil {
			err = catalog.ClearWithCache(scanCache)
		} else {
			err = scanCache.Clear()
		}
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, "scan_cancel_failed", "unable to cancel scan")
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func writeSSE(c *fiber.Ctx, event string, payload any) {
	data, _ := json.Marshal(payload)
	c.Set("Content-Type", "text/event-stream")
	fmt.Fprintf(c, "event: %s\ndata: %s\n\n", event, data)
}
