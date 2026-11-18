package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

// LibrarySyncStatusHandler 返回自动发现文件变化的开关与运行状态。
//
// GET /api/library-sync
func LibrarySyncStatusHandler(sync *services.LibrarySyncService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if sync == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "library_sync_unavailable", "library sync is unavailable")
		}
		return c.JSON(sync.Status())
	}
}

// LibrarySyncUpdateHandler 修改自动发现文件变化的开关。
//
// PUT /api/library-sync
// Body: {"enabled": true, "autoAnalyze": false}
//
// 两个开关都必须显式给出：省略表示「不改」，而不是「关掉」。
func LibrarySyncUpdateHandler(sync *services.LibrarySyncService) fiber.Handler {
	type request struct {
		Enabled     *bool `json:"enabled"`
		AutoAnalyze *bool `json:"autoAnalyze"`
	}
	return func(c *fiber.Ctx) error {
		if sync == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "library_sync_unavailable", "library sync is unavailable")
		}
		var body request
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_library_sync_body", "invalid library sync body")
		}
		if body.Enabled == nil && body.AutoAnalyze == nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_library_sync_body", "no library sync setting provided")
		}
		current := sync.Status()
		next := services.LibrarySyncSettings{
			Enabled:     current.Enabled,
			AutoAnalyze: current.AutoAnalyze,
		}
		if body.Enabled != nil {
			next.Enabled = *body.Enabled
		}
		if body.AutoAnalyze != nil {
			next.AutoAnalyze = *body.AutoAnalyze
		}
		status, err := sync.Update(c.Context(), next)
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, "library_sync_update_failed", "unable to update library sync settings")
		}
		return c.JSON(status)
	}
}
