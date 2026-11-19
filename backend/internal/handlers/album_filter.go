package handlers

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// 本文件是原始照片墙的智能筛选与相似折叠的 HTTP 接口。
//
// 筛选作用在整本相册上：服务端先把条件落成「相册成员 → 是否命中」的判定，
// 再按相册的自然顺序分页。前端只拿结果与总数，不自己过滤 ——
// 否则总数、翻页与大图浏览的顺序会各说各话。

// errInvalidAlbumFilter 表示筛选参数不合法。
var errInvalidAlbumFilter = errors.New("invalid album filter")

// AlbumMediaPageHandler GET /api/albums/:id/media
//
// 按统一自然顺序分页返回图片和视频；带上筛选条件时，先按条件筛出
// 留下的照片，再对留下的那一份分页。
//
// 返回项带原始像素尺寸：照片墙要按真实宽高比排布，服务端读一次图片头
// 并缓存，比让浏览器逐张探测更省事也更稳。视频没有像素尺寸，保持 0。
func AlbumMediaPageHandler(
	catalog *services.ResourceCatalog,
	dimensions *services.MediaDimensionService,
	picks *store.PickStore,
	filters *services.AlbumFilterEngine,
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, ok := parseLibraryPageLimit(c)
		if !ok {
			return nil
		}
		albumID := strings.TrimSpace(c.Params("id"))
		if albumID == "" {
			return httputil.BadRequest(c, "missing_resource_id", "resource id is required")
		}
		query, err := parseAlbumFilterQuery(c)
		if err != nil {
			return httputil.BadRequest(c, "invalid_album_filter", "album filter parameters are invalid")
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		if filters == nil {
			return httputil.Internal(c, "album_filter_unavailable", "album filters are unavailable")
		}
		page, err := filters.Page(snapshot, albumID, query, c.Query("cursor"), limit)
		if err != nil {
			return writeLibraryPageError(c, err, snapshot.Revision())
		}
		enrichMediaDimensions(snapshot, page.Items, dimensions)
		// 精选是照片级状态，照片墙的每一格都要知道自己是不是精选。
		markPicks(picks, page.Items)
		setLibraryRevisionETag(c, snapshot.Revision())
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

// AlbumFiltersHandler GET /api/albums/:id/filters
//
// 返回这本相册里真实可用的筛选条件：有哪些月份、哪些人物、哪些地点，
// 以及每个维度现在为什么不能用（还没跑分析、分析了但这本相册里确实没有）。
func AlbumFiltersHandler(catalog *services.ResourceCatalog, filters *services.AlbumFilterEngine) fiber.Handler {
	return func(c *fiber.Ctx) error {
		albumID := strings.TrimSpace(c.Params("id"))
		if albumID == "" {
			return httputil.BadRequest(c, "missing_resource_id", "resource id is required")
		}
		if filters == nil {
			return httputil.Internal(c, "album_filter_unavailable", "album filters are unavailable")
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		facets, err := filters.Facets(snapshot, albumID)
		if err != nil {
			return writeLibraryPageError(c, err, snapshot.Revision())
		}
		setLibraryRevisionETag(c, snapshot.Revision())
		return c.JSON(fiber.Map{"ok": true, "revision": snapshot.Revision(), "facets": facets})
	}
}

// parseAlbumFilterQuery 读取照片墙的筛选条件。
//
// 参数名沿用既有接口的写法：from/to 是日历月区间，personId 是人物分组，
// adcode 是行政区划码，picks 是精选口径，scene 是画面口径，collapse 是折叠开关。
func parseAlbumFilterQuery(c *fiber.Ctx) (services.AlbumFilterQuery, error) {
	query := services.AlbumFilterQuery{
		From:     strings.TrimSpace(c.Query("from")),
		To:       strings.TrimSpace(c.Query("to")),
		PersonID: strings.TrimSpace(c.Query("personId")),
	}
	if raw := strings.TrimSpace(c.Query("adcode")); raw != "" {
		adcode, err := strconv.Atoi(raw)
		if err != nil || adcode <= 0 {
			return query, errInvalidAlbumFilter
		}
		query.Adcode = adcode
	}
	switch picks := strings.TrimSpace(c.Query("picks")); picks {
	case "", services.AlbumFilterPicksOnly, services.AlbumFilterPicksNone:
		query.Picks = picks
	default:
		return query, errInvalidAlbumFilter
	}
	switch scene := strings.TrimSpace(c.Query("scene")); scene {
	case "", services.AlbumFilterSceneGroupPhoto, services.AlbumFilterSceneSimilar:
		query.Scene = scene
	default:
		return query, errInvalidAlbumFilter
	}
	switch collapse := strings.TrimSpace(c.Query("collapse")); collapse {
	case "", "0", "false":
		query.Collapse = false
	case "1", "true":
		query.Collapse = true
	default:
		return query, errInvalidAlbumFilter
	}
	if query.From != "" && !validAlbumMonth(query.From) {
		return query, errInvalidAlbumFilter
	}
	if query.To != "" && !validAlbumMonth(query.To) {
		return query, errInvalidAlbumFilter
	}
	if query.From != "" && query.To != "" && query.From > query.To {
		return query, errInvalidAlbumFilter
	}
	return query, nil
}

// validAlbumMonth 判断是不是 "YYYY-MM"。
func validAlbumMonth(value string) bool {
	if len(value) != 7 || value[4] != '-' {
		return false
	}
	year, err := strconv.Atoi(value[:4])
	if err != nil || year < 1900 || year > 2099 {
		return false
	}
	month, err := strconv.Atoi(value[5:])
	return err == nil && month >= 1 && month <= 12
}
