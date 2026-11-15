package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

// SmartAlbumRefreshStartRequest 是启动一次智能相册刷新的请求体。
type SmartAlbumRefreshStartRequest struct {
	// Force 为真时无视缓存，全部重算；缺省只重建有变化的相册与维度。
	Force bool `json:"force"`
}

// SmartAlbumRefreshStartHandler 启动一次全库智能相册刷新。
//
//	POST /api/smart-albums/refresh
//	{"force": false}
//
// 响应 `{ ok, jobId, reused }`。已有任务在跑时复用它（reused=true），
// 避免两个刷新同时读同一份派生缓存。
//
// 刷新是后台任务：全库分组要按相册 × 四个维度逐个算，放在请求里同步跑
// 会撞超时，这里返回任务号，进度与取消另有接口。
func SmartAlbumRefreshStartHandler(svc *services.SmartAlbumRefreshService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if svc == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		var body SmartAlbumRefreshStartRequest
		if len(c.Body()) > 0 {
			if err := json.Unmarshal(c.Body(), &body); err != nil {
				return writeError(c, fiber.StatusBadRequest, "invalid_smart_album_refresh", "request body is not valid JSON")
			}
		}
		jobID, reused, err := svc.Start(body.Force)
		if err != nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_album_refresh_failed", "smart album refresh could not be started")
		}
		return c.JSON(fiber.Map{
			"ok":     true,
			"jobId":  jobID,
			"reused": reused,
			"force":  body.Force,
		})
	}
}

// SmartAlbumRefreshActiveHandler 返回当前正在跑的刷新任务。
//
//	GET /api/smart-albums/refresh/active
//
// 没有任务时返回 `{ ok: true, task: null }`：这是一次常规的状态查询，
// 不是错误 —— 用 404 会让每次打开任务中心都在浏览器控制台留下一条报错。
func SmartAlbumRefreshActiveHandler(svc *services.SmartAlbumRefreshService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if svc == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		progress, ok := svc.Active()
		if !ok {
			return c.JSON(fiber.Map{"ok": true, "task": nil})
		}
		return c.JSON(fiber.Map{"ok": true, "task": progress})
	}
}

// SmartAlbumRefreshStatusHandler 返回刷新任务的当前快照。
//
//	GET /api/smart-albums/refresh/:id
func SmartAlbumRefreshStatusHandler(svc *services.SmartAlbumRefreshService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if svc == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		id := c.Params("id")
		if id == "" {
			return writeError(c, fiber.StatusBadRequest, "missing_smart_album_refresh_id", "missing smart album refresh id")
		}
		progress, ok := svc.Status(id)
		if !ok {
			return writeError(c, fiber.StatusNotFound, "smart_album_refresh_not_found", "smart album refresh task not found")
		}
		return c.JSON(progress)
	}
}

// SmartAlbumRefreshCancelHandler 取消正在进行的刷新。
//
//	DELETE /api/smart-albums/refresh/:id
func SmartAlbumRefreshCancelHandler(svc *services.SmartAlbumRefreshService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if svc == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		id := c.Params("id")
		if id == "" {
			return writeError(c, fiber.StatusBadRequest, "missing_smart_album_refresh_id", "missing smart album refresh id")
		}
		if !svc.Cancel(id) {
			if _, ok := svc.Status(id); !ok {
				return writeError(c, fiber.StatusNotFound, "smart_album_refresh_not_found", "smart album refresh task not found")
			}
			// 已经结束的任务不必报错：用户点取消时它可能刚好做完。
			return c.JSON(fiber.Map{"ok": true, "alreadyDone": true})
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// SmartAlbumRefreshEventsHandler 推送刷新进度（SSE）。
//
//	GET /api/smart-albums/refresh/:id/events
//
// 事件名与任务状态同名（pending/running/complete/cancelled/error），
// data 为进度快照。终态事件后关闭连接。
func SmartAlbumRefreshEventsHandler(svc *services.SmartAlbumRefreshService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if svc == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		id := c.Params("id")
		if id == "" {
			return writeError(c, fiber.StatusBadRequest, "missing_smart_album_refresh_id", "missing smart album refresh id")
		}
		events, unsubscribe, ok := svc.Subscribe(id)
		if !ok {
			return writeError(c, fiber.StatusNotFound, "smart_album_refresh_not_found", "smart album refresh task not found")
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		c.Response().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer unsubscribe()
			streamSmartAlbumRefreshEvents(w, events, 15*time.Second)
		})
		return nil
	}
}

func streamSmartAlbumRefreshEvents(
	w *bufio.Writer,
	events <-chan services.SmartAlbumRefreshProgress,
	heartbeat time.Duration,
) {
	ticker := time.NewTicker(heartbeat)
	defer ticker.Stop()
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				return
			}
			data, _ := json.Marshal(ev)
			if _, err := fmt.Fprintf(w, "event: %s\ndata: %s\n\n", ev.Status, data); err != nil {
				return
			}
			if err := w.Flush(); err != nil {
				return
			}
			if ev.Status != services.SmartAlbumRefreshStatusPending &&
				ev.Status != services.SmartAlbumRefreshStatusRunning {
				return
			}
		case <-ticker.C:
			if _, err := fmt.Fprint(w, ": keep-alive\n\n"); err != nil {
				return
			}
			if err := w.Flush(); err != nil {
				return
			}
		}
	}
}
