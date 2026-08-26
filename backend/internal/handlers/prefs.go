package handlers

import (
	"fmt"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// PrefsGetHandler GET /api/prefs
func PrefsGetHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, err := s.Get()
		if err != nil {
			return prefsInternalError(c)
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
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}

		cur, err := s.Get()
		if err != nil {
			return prefsInternalError(c)
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
			return prefsInternalError(c)
		}
		return c.JSON(cur)
	}
}

// FavoritesListHandler GET /api/favorites
func FavoritesListHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, err := s.Get()
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"favorites": p.Favorites})
	}
}

// FavoriteAddHandler POST /api/favorites
//
// Body: {"resourceId": "a_... | c_... | smart:<tag>"}
func FavoriteAddHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		ResourceID string `json:"resourceId"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || !models.IsFavoriteResourceID(r.ResourceID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid resourceId"})
		}
		out, err := s.AddFavorite(r.ResourceID)
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"favorites": out})
	}
}

// FavoriteRemoveHandler DELETE /api/favorites
//
// Body: {"resourceId": "..."}
func FavoriteRemoveHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		ResourceID string `json:"resourceId"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || !models.IsFavoriteResourceID(r.ResourceID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid resourceId"})
		}
		out, err := s.RemoveFavorite(r.ResourceID)
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"favorites": out})
	}
}

// HistoryListHandler GET /api/history
func HistoryListHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		p, err := s.Get()
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"history": p.History})
	}
}

// HistoryAddHandler POST /api/history
//
// Body: {"albumId": "a_...", "name": "...", "imageCount": 42}
func HistoryAddHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		AlbumID    string `json:"albumId"`
		Name       string `json:"name"`
		ImageCount int    `json:"imageCount"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || !models.IsAlbumID(r.AlbumID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid albumId"})
		}
		entry := models.HistoryEntry{
			AlbumID:    r.AlbumID,
			Name:       r.Name,
			ImageCount: r.ImageCount,
			OpenedAt:   time.Now(),
		}
		out, err := s.AddHistory(entry)
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"history": out})
	}
}

// HistoryClearHandler DELETE /api/history
func HistoryClearHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if err := s.ClearHistory(); err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// FavoritesPruneHandler POST /api/favorites/prune
//
// 移除当前资源目录中已不存在的收藏；智能标签保留，避免临时空标签丢失。
func FavoritesPruneHandler(s *store.PrefsStore, catalog *services.ResourceCatalog) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if catalog == nil || !catalog.Ready() {
			return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "library not ready"})
		}
		removed, err := s.PruneInvalidFavorites(func(id string) bool {
			if len(id) > len("smart:") && id[:len("smart:")] == "smart:" {
				return true
			}
			ref, ok := catalog.Lookup(id)
			return ok && (ref.Kind == services.ResourceAlbum || ref.Kind == services.ResourceCollection)
		})
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"removed": removed})
	}
}

// ProgressSetHandler POST /api/progress
//
// Body: {"albumId": "a_...", "index": 12, "total": 30, "scroll": 0}
func ProgressSetHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		AlbumID string `json:"albumId"`
		Index   int    `json:"index"`
		Total   int    `json:"total"`
		Scroll  int    `json:"scroll"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil ||
			!validProgress(r.AlbumID, r.Index, r.Total, r.Scroll) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid body"})
		}
		entry := models.ReadingProgress{
			AlbumID: r.AlbumID,
			Index:   r.Index,
			Total:   r.Total,
			Scroll:  r.Scroll,
			Updated: time.Now(),
		}
		if err := s.SetReadingProgress(entry); err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// ProgressGetHandler GET /api/progress?albumId=<album ID>
func ProgressGetHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		albumID := c.Query("albumId")
		if !models.IsAlbumID(albumID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid albumId"})
		}
		rp, ok, err := s.GetReadingProgress(albumID)
		if err != nil {
			return prefsInternalError(c)
		}
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "no progress"})
		}
		return c.JSON(rp)
	}
}

// ProgressBatchGetHandler POST /api/progress/batch
// Body: {"albumIds": ["a_...", ...]}
//
// 一次返回多个相册 ID 的阅读进度（map[albumId]progress），缺失项不出现在
// 返回值中。避免主页一次发 N 路并发 GET 的开销。
func ProgressBatchGetHandler(s *store.PrefsStore) fiber.Handler {
	type req struct {
		AlbumIDs []string `json:"albumIds"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || len(r.AlbumIDs) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing albumIds"})
		}
		if len(r.AlbumIDs) > maxProgressBatch {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("too many albumIds (max %d)", maxProgressBatch),
			})
		}
		for _, albumID := range r.AlbumIDs {
			if !models.IsAlbumID(albumID) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid albumId"})
			}
		}
		out, err := s.GetReadingProgressBatch(r.AlbumIDs)
		if err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"progress": out, "count": len(out)})
	}
}

// ProgressBatchSetHandler PUT /api/progress/batch
// Body: {"entries": [{"albumId":"a_...","index":12,"total":30,"scroll":0}]}
//
// 整批先校验再一次性合并、落盘，避免“全部标记已读”产生 N 个请求和 N 次
// JSON 重写。任一条非法时整批拒绝。
func ProgressBatchSetHandler(s *store.PrefsStore) fiber.Handler {
	type entry struct {
		AlbumID string `json:"albumId"`
		Index   int    `json:"index"`
		Total   int    `json:"total"`
		Scroll  int    `json:"scroll"`
	}
	type req struct {
		Entries []entry `json:"entries"`
	}
	return func(c *fiber.Ctx) error {
		var r req
		if err := c.BodyParser(&r); err != nil || len(r.Entries) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "missing entries"})
		}
		if len(r.Entries) > maxProgressBatch {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": fmt.Sprintf("too many entries (max %d)", maxProgressBatch),
			})
		}
		now := time.Now()
		entries := make([]models.ReadingProgress, len(r.Entries))
		for i, item := range r.Entries {
			if !validProgress(item.AlbumID, item.Index, item.Total, item.Scroll) {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid progress entry"})
			}
			entries[i] = models.ReadingProgress{
				AlbumID: item.AlbumID,
				Index:   item.Index,
				Total:   item.Total,
				Scroll:  item.Scroll,
				Updated: now,
			}
		}
		if err := s.SetReadingProgressBatch(entries); err != nil {
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"ok": true, "updated": len(entries)})
	}
}

// ProgressDeleteHandler DELETE /api/progress/item?albumId=<album ID>
//
// 删除某相册的阅读进度。用于首页「继续阅读」里用户主动移出某一本。
// 幂等：原本没有也返回 ok。
func ProgressDeleteHandler(s *store.PrefsStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		albumID := c.Query("albumId")
		if !models.IsAlbumID(albumID) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "invalid albumId"})
		}
		removed, err := s.DeleteReadingProgress(albumID)
		if err != nil {
			return prefsInternalError(c)
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
			return prefsInternalError(c)
		}
		return c.JSON(fiber.Map{"ok": true, "removed": n})
	}
}

const maxProgressBatch = 10_000

func validProgress(albumID string, index, total, scroll int) bool {
	return models.IsAlbumID(albumID) && index >= 0 && total >= 0 && index <= total && scroll >= 0
}

func prefsInternalError(c *fiber.Ctx) error {
	return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "preferences unavailable"})
}
