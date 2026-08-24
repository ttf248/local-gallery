// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// walkCollections 递归把 Collection（含嵌套子集合）按 name 关键字搜索命中。
//
// 扫描器支持 Collection 嵌套（"2024年/夏威夷-度假/相片"），搜索也要跟着
// 走到所有层级，否则用户搜「相片」这种常见关键词时，4-5 层结构里的
// 子集合一个都搜不到。
func walkCollections(col models.Collection, out *[]searchHit, match func(string) bool) {
	if match(col.Name) {
		var cover string
		if len(col.Albums) > 0 {
			cover = col.Albums[0].CoverImage
		}
		*out = append(*out, searchHit{
			Kind: "collection", Path: col.Path, Name: col.Name,
			Count: col.AlbumCount, Cover: cover,
		})
	}
	for i := range col.Collections {
		walkCollections(col.Collections[i], out, match)
	}
}
//
//	GET /api/scan/latest
//
// 没有缓存结果时返回 404。前端可在启动时直接调用此接口拉取上次扫描结果。
func LatestScanHandler(cache *services.ScanResultCache) fiber.Handler {
	return func(c *fiber.Ctx) error {
		r := cache.Get()
		if r == nil {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"error": "no cached scan result; please run a scan first",
			})
		}
		return c.JSON(fiber.Map{"ok": true, "result": r})
	}
}

// AlbumDetailHandler 返回某相册（按路径）的详细信息 + 图片列表。
//
//	GET /api/albums?path=<absolute>
//
// path 支持绝对路径或 "smart:<author>"。
func AlbumDetailHandler(cache *services.ScanResultCache) fiber.Handler {
	return func(c *fiber.Ctx) error {
		raw := c.Query("path")
		if raw == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		// 路径安全校验（仅在确实是绝对路径时执行）
		if !strings.HasPrefix(raw, "smart:") {
			checked := middleware.SafePath(c)
			if checked == "" {
				return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
					"error": "missing 'path' query parameter",
				})
			}
		}
		if strings.HasPrefix(raw, "smart:") {
			author := strings.TrimPrefix(raw, "smart:")
			s := cache.FindSmartCollection(author)
			if s == nil {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"error": "smart collection not found",
				})
			}
			return c.JSON(fiber.Map{"ok": true, "kind": "smart", "data": s})
		}
		album := cache.FindAlbum(raw)
		if album != nil {
			return c.JSON(fiber.Map{"ok": true, "kind": "album", "data": album})
		}
		coll := cache.FindCollection(raw)
		if coll != nil {
			return c.JSON(fiber.Map{"ok": true, "kind": "collection", "data": coll})
		}
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "album/collection not found in cached scan",
		})
	}
}

// searchHit 搜索结果的统一响应结构。
//
// album / smartCollection / collection 三种 kind 共用同一个 schema，
// 提到包级方便 walkCollections 等辅助函数复用。
type searchHit struct {
	Kind   string `json:"kind"`             // album / smartCollection / collection
	Path   string `json:"path"`
	Name   string `json:"name"`
	Author string `json:"author,omitempty"`
	Count  int    `json:"count"`
	Cover  string `json:"coverImage,omitempty"`
}

// SearchHandler 在缓存中按关键字搜索相册/智能集合。
//
//	GET /api/search?q=<keyword>&limit=<n>
//
// 关键字匹配 name/author 子串（不区分大小写）。limit 默认 50。
// 集合（collection）搜索递归遍历所有嵌套子集合。
func SearchHandler(cache *services.ScanResultCache) fiber.Handler {
	return func(c *fiber.Ctx) error {
		q := strings.ToLower(strings.TrimSpace(c.Query("q")))
		if q == "" {
			return c.JSON(fiber.Map{"ok": true, "results": []searchHit{}})
		}
		limit := c.QueryInt("limit", 50)
		if limit <= 0 || limit > 500 {
			limit = 50
		}

		r := cache.Get()
		if r == nil {
			return c.JSON(fiber.Map{"ok": true, "results": []searchHit{}, "scanned": false})
		}

		var out []searchHit
		match := func(s string) bool { return strings.Contains(strings.ToLower(s), q) }

		for _, a := range r.Albums {
			if match(a.Name) || match(a.Author) {
				out = append(out, searchHit{
					Kind: "album", Path: a.Path, Name: a.Name,
					Author: a.Author, Count: a.ImageCount, Cover: a.CoverImage,
				})
			}
		}
		for _, col := range r.Collections {
			walkCollections(col, &out, match)
		}
		for _, s := range r.SmartCollections {
			if match(s.Author) {
				out = append(out, searchHit{
					Kind: "smartCollection", Path: "smart:" + s.Author,
					Name: s.Author, Author: s.Author,
					Count: s.AlbumCount, Cover: s.CoverImage,
				})
			}
		}
		if len(out) > limit {
			out = out[:limit]
		}
		return c.JSON(fiber.Map{"ok": true, "results": out, "count": len(out)})
	}
}
