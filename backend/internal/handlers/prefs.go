package handlers

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// PrefsGetHandler GET /api/prefs
func PrefsGetHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, err := s.Get()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(p)
	}
}

// PrefsPatchHandler PATCH /api/prefs
//
// 仅覆盖传入的非零字段。
func PrefsPatchHandler(s *store.PrefsStore) fiber.Handler {
	type patch struct {
		Theme            *string `json:"theme"`
		AutoSwitchAlbum  *bool   `json:"autoSwitchAlbum"`
		ShowSwitchNotif  *bool   `json:"showSwitchNotif"`
		SidebarCollapsed *bool   `json:"sidebarCollapsed"`
		MaxRecent        *int    `json:"maxRecent"`
	}

	return func(c *fiber.Ctx) error {
		var p patch
		if err := c.BodyParser(&p); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
		}

		cur, err := s.Get()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}

		if p.Theme != nil {
			cur.Theme = *p.Theme
		}
		if p.AutoSwitchAlbum != nil {
			cur.AutoSwitchAlbum = *p.AutoSwitchAlbum
		}
		if p.ShowSwitchNotif != nil {
			cur.ShowSwitchNotif = *p.ShowSwitchNotif
		}
		if p.SidebarCollapsed != nil {
			cur.SidebarCollapsed = *p.SidebarCollapsed
		}
		if p.MaxRecent != nil && *p.MaxRecent > 0 {
			cur.MaxRecent = *p.MaxRecent
		}

		if err := s.Update(cur); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(cur)
	}
}

// FavoritesListHandler GET /api/favorites
func FavoritesListHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, _ := s.Get()
		return c.JSON(fiber.Map{"favorites": p.Favorites})
	}
}

// FavoriteAddHandler POST /api/favorites
//
// Body: {"path": "..."}
func FavoriteAddHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		Path string `json:"path"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || r.Path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "path required"})
		}
		out, err := s.AddFavorite(r.Path)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"favorites": out})
	}
}

// FavoriteRemoveHandler DELETE /api/favorites
//
// Body: {"path": "..."}
func FavoriteRemoveHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		Path string `json:"path"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || r.Path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "path required"})
		}
		out, err := s.RemoveFavorite(r.Path)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"favorites": out})
	}
}

// HistoryListHandler GET /api/history
func HistoryListHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, _ := s.Get()
		return c.JSON(fiber.Map{"history": p.History})
	}
}

// HistoryAddHandler POST /api/history
//
// Body: {"path": "...", "name": "...", "imageCount": 42}
func HistoryAddHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		Path       string `json:"path"`
		Name       string `json:"name"`
		ImageCount int    `json:"imageCount"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || r.Path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "path required"})
		}
		entry := models.HistoryEntry{
			Path:       r.Path,
			Name:       r.Name,
			ImageCount: r.ImageCount,
			OpenedAt:   time.Now(),
		}
		out, err := s.AddHistory(entry)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"history": out})
	}
}

// HistoryClearHandler DELETE /api/history
func HistoryClearHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := s.ClearHistory(); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// FavoritesPruneHandler POST /api/favorites/prune
//
// 移除磁盘上不存在的收藏。
func FavoritesPruneHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		removed, err := s.PruneInvalidFavorites()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"removed": removed})
	}
}

// ProgressSetHandler POST /api/progress
//
// Body: {"path": "...", "index": 12, "total": 30, "scroll": 0}
func ProgressSetHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		Path   string `json:"path"`
		Index  int    `json:"index"`
		Total  int    `json:"total"`
		Scroll int    `json:"scroll"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || r.Path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		entry := models.ReadingProgress{
			Path:    r.Path,
			Index:   r.Index,
			Total:   r.Total,
			Scroll:  r.Scroll,
			Updated: time.Now(),
		}
		if err := s.SetReadingProgress(entry); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// ProgressGetHandler GET /api/progress?path=<album path>
func ProgressGetHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing 'path'"})
		}
		rp, ok := s.GetReadingProgress(path)
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "no progress"})
		}
		return c.JSON(rp)
	}
}

// ProgressBatchGetHandler POST /api/progress/batch
// Body: {"paths": ["<path1>", "<path2>", ...]}
//
// 一次返回多个路径的阅读进度（map[path]progress），缺失项不出现在
// 返回值中。避免主页一次发 N 路并发 GET 的开销。
func ProgressBatchGetHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		Paths []string `json:"paths"`
	}
	const maxBatch = 500
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || len(r.Paths) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing 'paths'"})
		}
		if len(r.Paths) > maxBatch {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("too many paths (max %d)", maxBatch),
			})
		}
		out := s.GetReadingProgressBatch(r.Paths)
		return c.JSON(fiber.Map{"progress": out, "count": len(out)})
	}
}

// ProgressDeleteHandler DELETE /api/progress/item?path=<album path>
//
// 删除某相册的阅读进度。用于首页「继续阅读」里用户主动移出某一本。
// 幂等：原本没有也返回 ok。
func ProgressDeleteHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing 'path'"})
		}
		removed, err := s.DeleteReadingProgress(path)
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true, "removed": removed})
	}
}

// ProgressClearHandler DELETE /api/progress
//
// 清空所有阅读进度。用于首页「继续阅读」一键清空。
// 不影响 favorites / history / prefs 等其它数据。
func ProgressClearHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		n, err := s.ClearAllReadingProgress()
		if err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(fiber.Map{"ok": true, "removed": n})
	}
}
