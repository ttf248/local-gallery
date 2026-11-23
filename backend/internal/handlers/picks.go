package handlers

import (
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// PicksListHandler GET /api/picks
//
// 返回精选的文件 ID 列表（最近加入在前）与条数。
//
// 照片墙每一格都要问一次「这张在不在精选里」，因此这里给的是纯 ID：
// 前端拿到集合后本地判断，不必为每一格单独发请求。
func PicksListHandler(picks *store.PickStore) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if picks == nil {
			return httputil.Internal(c, "picks_unavailable", "pick storage is unavailable")
		}
		list := picks.Get()
		return c.JSON(fiber.Map{
			"ok":       true,
			"picks":    list,
			"total":    len(list),
			"revision": picks.Revision(),
		})
	}
}

// PicksBatchHandler POST /api/picks/batch
//
// Body: {"ids": ["f_...", ...], "action": "add" | "remove"}
//
// 加入是幂等的；移出对本来就不在精选里的条目没有影响。
func PicksBatchHandler(picks *store.PickStore) fiber.Handler {
	type request struct {
		IDs    []string `json:"ids"`
		Action string   `json:"action"`
	}
	return func(c *fiber.Ctx) error {
		if picks == nil {
			return httputil.Internal(c, "picks_unavailable", "pick storage is unavailable")
		}
		var input request
		if err := c.BodyParser(&input); err != nil ||
			len(input.IDs) == 0 ||
			len(input.IDs) > maxSelectionBatch ||
			(input.Action != "add" && input.Action != "remove") {
			return httputil.BadRequest(c, "invalid_picks_batch", "invalid picks batch")
		}
		for _, id := range input.IDs {
			if !models.IsFileID(id) {
				return httputil.BadRequest(c, "invalid_picks_batch", "invalid pick identity")
			}
		}
		updated, err := picks.Batch(input.IDs, input.Action == "add")
		if errors.Is(err, store.ErrPickLimit) {
			return httputil.BadRequest(c, "pick_limit", "pick limit exceeded")
		}
		if err != nil {
			return httputil.Internal(c, "picks_unavailable", "pick storage is unavailable")
		}
		return c.JSON(fiber.Map{
			"ok":       true,
			"updated":  updated,
			"total":    picks.Count(),
			"revision": picks.Revision(),
		})
	}
}

// PicksMediaPageHandler GET /api/picks/media
//
// 分页返回精选照片本身：跨相册，把用户在不同相册里挑出的照片放在一起。
//
// 精选列表是用户数据，媒体目录是扫描数据，两者分开存；这里在请求期
// 按当前目录解析 —— 文件被移出媒体库后它自然从精选页消失。
func PicksMediaPageHandler(catalog *services.ResourceCatalog, picks *store.PickStore, dimensions *services.MediaDimensionService, timeline *services.PhotoTimelineService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, ok := parseLibraryPageLimit(c)
		if !ok {
			return nil
		}
		if catalog == nil || picks == nil {
			return httputil.Internal(c, "picks_unavailable", "pick storage is unavailable")
		}
		snapshot := catalog.Acquire()
		page, err := services.PagePicks(snapshot, picks.Get(), picks.Revision(), c.Query("cursor"), limit)
		if err != nil {
			return writeLibraryPageError(c, err, snapshot.Revision())
		}
		enrichPickDimensions(snapshot, page.Items, dimensions)
		enrichPickDates(snapshot, page.Items, timeline)
		setLibraryRevisionETag(c, snapshot.Revision())
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

// enrichPickDates 补齐精选项的时间证据，与照片时间线同一套口径。
//
// 精选页的照片下方要写清它是什么时候拍的：只认时间线认的那几种证据
// （EXIF → 文件名 → 目录名 → 修改时间），来源与精度一并给出，界面
// 才好照实说「这是推断出来的日期」。
func enrichPickDates(snapshot services.CatalogSnapshot, items []services.PickItem, timeline *services.PhotoTimelineService) {
	if timeline == nil || len(items) == 0 {
		return
	}
	for i := range items {
		evidence, ok := timeline.MediaDate(snapshot, items[i].AlbumID, items[i].Index)
		if !ok || evidence.At.IsZero() || evidence.Source == "" {
			continue
		}
		items[i].CapturedAt = evidence.At.UTC().Format(time.RFC3339)
		items[i].DateSource = evidence.Source
		items[i].DatePrecision = evidence.Precision
		items[i].DateValue = evidence.Value
	}
}

// enrichPickDimensions 补齐精选项的像素尺寸，与相册媒体列表同一套口径。
func enrichPickDimensions(snapshot services.CatalogSnapshot, items []services.PickItem, dimensions *services.MediaDimensionService) {
	if dimensions == nil || len(items) == 0 {
		return
	}
	for i := range items {
		if items[i].Kind != "image" {
			continue
		}
		ref, ok := snapshot.Lookup(items[i].ID)
		if !ok {
			continue
		}
		size := dimensions.Dimensions(ref.AbsolutePath)
		items[i].Width = size.Width
		items[i].Height = size.Height
		items[i].Undecodable = size.Undecodable
	}
	dimensions.Flush()
}

// markPicks 给一页媒体标记是否在精选中。
//
// 精选是用户数据，不进目录索引：这一页的每一格都要问一次精选集合，
// 一次读锁问完整批，比逐格调用便宜得多。
func markPicks(picks *store.PickStore, items []services.LibraryMediaItem) {
	if picks == nil || len(items) == 0 {
		return
	}
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	flags := picks.Contains(ids)
	for i := range items {
		items[i].Picked = flags[i]
	}
}

// markFeedPicks 给一页跨相册的照片标记是否在精选中。
func markFeedPicks(picks *store.PickStore, items []services.FeedMediaItem) {
	if picks == nil || len(items) == 0 {
		return
	}
	ids := make([]string, len(items))
	for i := range items {
		ids[i] = items[i].ID
	}
	flags := picks.Contains(ids)
	for i := range items {
		items[i].Picked = flags[i]
	}
}
