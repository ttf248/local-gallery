package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

// ScanHandler 同步扫描（保留兼容）。
// mediaRoots 在每次请求时通过 mgr.Roots() 读取，响应热更新。
func ScanHandler(scanner *services.Scanner, mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		result, err := scanner.Scan(services.ScanOptions{
			Roots:    mgr.Roots(),
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
			return c.Status(status).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true, "result": result})
	}
}

// AsyncScanStartHandler 启动异步扫描，返回 scan_id。
//
// POST /api/scan/start
func AsyncScanStartHandler(runner *services.AsyncScanRunner, mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id, _, err := runner.Start(services.ScanOptions{
			Roots:    mgr.Roots(),
			MaxDepth: 2,
		})
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"scanId": id})
	}
}

// AsyncScanEventsHandler SSE 事件流。
//
// GET /api/scan/:id/events
func AsyncScanEventsHandler(runner *services.AsyncScanRunner) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		if id == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing scan id"})
		}

		state := runner.Get(id)
		if state == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "scan not found"})
		}

		c.Set("Content-Type", "text/event-stream")
		c.Set("Cache-Control", "no-cache")
		c.Set("Connection", "keep-alive")
		c.Set("X-Accel-Buffering", "no")

		// 已完成：直接发最终事件后返回
		if state.Status != services.ScanStatusRunning &&
			state.Status != services.ScanStatusPending {
			ev := services.ProgressEvent{
				ScanID:      id,
				Progress:    100,
				Status:      state.Status,
				AlbumsFound: len(state.Albums),
			}
			if state.Result != nil {
				ev.AlbumsFound = state.Result.AlbumCount
			}
			if state.Err != nil {
				ev.Error = state.Err.Error()
			}
			writeSSE(c, string(ev.Status), ev)
			return nil
		}

		// 流式推送
		c.Response().SetBodyStreamWriter(func(w *bufio.Writer) {
			defer w.Flush()
			for ev := range state.Events {
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

// AsyncScanResultHandler 获取扫描最终结果。
//
// GET /api/scan/:id/result
func AsyncScanResultHandler(runner *services.AsyncScanRunner) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		state := runner.Get(id)
		if state == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "scan not found"})
		}
		if state.Status != services.ScanStatusComplete {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error":  "scan not complete",
				"status": state.Status,
			})
		}
		return c.JSON(fiber.Map{"ok": true, "result": state.Result})
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
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "scan not found"})
		}
		if state.Status != services.ScanStatusRunning && state.Status != services.ScanStatusPending {
			return c.JSON(fiber.Map{"ok": true, "alreadyDone": true})
		}
		state.Cancel()
		return c.JSON(fiber.Map{"ok": true})
	}
}

func writeSSE(c *fiber.Ctx, event string, payload any) {
	data, _ := json.Marshal(payload)
	c.Set("Content-Type", "text/event-stream")
	fmt.Fprintf(c, "event: %s\ndata: %s\n\n", event, data)
}
