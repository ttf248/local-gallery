// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// walkCollections 递归把 Collection（含嵌套子集合 + 内部 albums）按 name 关键字搜索命中。
//
// 扫描器支持 Collection 嵌套（"2024年/夏威夷-度假/相片"），搜索也要跟着
// 走到所有层级，否则用户搜「相片」这种常见关键词时，4-5 层结构里的
// 子集合一个都搜不到。
//
// 同时：collection 直属的 album（如「2024年」下的「散图」或「学校的某次画展」）
// 也要参与匹配；只搜 collection 名字会漏掉「搜子相册名」的场景。
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
	for i := range col.Albums {
		if match(col.Albums[i].Name) || match(col.Albums[i].Author) {
			*out = append(*out, searchHit{
				Kind: "album", Path: col.Albums[i].Path, Name: col.Albums[i].Name,
				Author: col.Albums[i].Author, Count: col.Albums[i].ImageCount,
				Cover: col.Albums[i].CoverImage,
			})
		}
	}
	for i := range col.Collections {
		walkCollections(col.Collections[i], out, match)
	}
}

// searchHit 搜索结果的统一响应结构。
//
// album / smartCollection / collection 三种 kind 共用同一个 schema，
// 提到包级方便 walkCollections 等辅助函数复用。
type searchHit struct {
	Kind   string `json:"kind"` // album / smartCollection / collection
	Path   string `json:"path"`
	Name   string `json:"name"`
	Author string `json:"author,omitempty"`
	Count  int    `json:"count"`
	Cover  string `json:"coverImage,omitempty"`
}

// AlbumSetCoverHandler 把用户指定的 file 设为 album path 的自定义封面。
//
//	PUT /api/albums/cover?path=<album>&file=<absolute>
//
// 双层校验：
//  1. path 必须经过 SafePath 中间件（不允许越出媒体根）
//  2. file 必须实际位于该 album 目录里（防越权：不能把别处图片设成该 album 封面）
//
// 行为：写入 cover_overrides.json，更新内存 ScanResult，标记 dirty 异步落盘。
// 返回新的 CoverImage + CoverKind，前端立即拿来刷缩略图。
func AlbumSetCoverHandler(cache *services.ScanResultCache, store *services.CoverOverrideStore, catalogs ...*services.ResourceCatalog) fiber.Handler {
	catalog := optionalCatalog(catalogs)
	return func(c *fiber.Ctx) error {
		albumPath := middleware.SafePath(c)
		if albumPath == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		fileID := strings.TrimSpace(c.Query("file"))
		if fileID == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'file' query parameter",
			})
		}
		file, ok := resolveResource(c, catalog, fileID, services.ResourceFile)
		if !ok {
			return nil
		}
		if !isFileInsideAlbum(file, albumPath) {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "file is not inside the album directory",
			})
		}
		if fi, err := os.Stat(file); err != nil || fi.IsDir() {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "file does not exist or is a directory",
			})
		}
		kind := coverKindFromExt(file)
		if kind == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "file extension not supported (need image or video)",
			})
		}
		if err := store.Set(albumPath, file); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "save cover override: " + err.Error(),
			})
		}
		if catalog != nil {
			if _, _, ok := catalog.RefreshCovers(cache, store); !ok {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "library not ready"})
			}
		} else {
			cache.SetWithOverrideApplied(albumPath, file, kind)
		}
		return c.JSON(fiber.Map{
			"ok":         true,
			"albumPath":  rawResourceID(c),
			"coverImage": publicID(catalog, file, services.ResourceFile),
			"coverKind":  kind,
		})
	}
}

// AlbumClearCoverHandler 清除 album path 的自定义封面（回到扫描器默认）。
//
//	DELETE /api/albums/cover?path=<album>
//
// 行为：删除 cover_overrides.json 里这条记录，立刻把该 album 的
// CoverImage / CoverKind 重置为 images[0] / videos[0]（图片优先）。
// 不触发全库扫描 — 单条 album 的封面回退是确定的（来自同一份
// ScanResult 内的 ImageFiles / VideoFiles）。
func AlbumClearCoverHandler(cache *services.ScanResultCache, store *services.CoverOverrideStore, catalogs ...*services.ResourceCatalog) fiber.Handler {
	catalog := optionalCatalog(catalogs)
	return func(c *fiber.Ctx) error {
		albumPath := middleware.SafePath(c)
		if albumPath == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		if err := store.Clear(albumPath); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"error": "clear cover override: " + err.Error(),
			})
		}
		if catalog != nil {
			if _, _, ok := catalog.RefreshCovers(cache, store); !ok {
				return c.Status(fiber.StatusConflict).JSON(fiber.Map{"error": "library not ready"})
			}
		} else {
			cache.RebuildCoverForAlbum(albumPath)
		}
		return c.JSON(fiber.Map{
			"ok":        true,
			"albumPath": rawResourceID(c),
		})
	}
}

// isFileInsideAlbum 检查 file 是不是 albumPath 目录里的文件（防越权）。
// Windows 下大小写不敏感。
func isFileInsideAlbum(file, albumPath string) bool {
	fp := filepath.Clean(file)
	dp := filepath.Clean(albumPath)
	if runtime.GOOS == "windows" {
		fp = strings.ToLower(fp)
		dp = strings.ToLower(dp)
	}
	if fp == dp {
		return false
	}
	// 必须在目录下：用 filepath.Rel
	rel, err := filepath.Rel(dp, fp)
	if err != nil {
		return false
	}
	if rel == "." || rel == ".." || strings.HasPrefix(rel, "..") {
		return false
	}
	return true
}

// coverKindFromExt 后端 handler 复制，跟 services/scan_cache 里的同名函数
// 实现一致（services 包不导出）。保持 handler 内部能用。
func coverKindFromExt(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov", ".mkv", ".avi":
		return "video"
	}
	return ""
}

//	GET /api/search?q=<keyword>&limit=<n>
//
// 关键字匹配 name/author 子串（不区分大小写）。limit 默认 50。
// 集合（collection）搜索递归遍历所有嵌套子集合。
func SearchHandler(cache *services.ScanResultCache, catalogs ...*services.ResourceCatalog) fiber.Handler {
	catalog := optionalCatalog(catalogs)
	return func(c *fiber.Ctx) error {
		q := strings.ToLower(strings.TrimSpace(c.Query("q")))
		if q == "" {
			return c.JSON(fiber.Map{"ok": true, "results": []searchHit{}})
		}
		limit := c.QueryInt("limit", 50)
		if limit <= 0 || limit > 500 {
			limit = 50
		}

		var (
			r        *models.ScanResult
			snapshot services.CatalogSnapshot
		)
		if catalog != nil {
			snapshot = catalog.Acquire()
			r = snapshot.Result()
		} else {
			r = cache.Get()
		}
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
		if catalog != nil {
			for i := range out {
				switch out[i].Kind {
				case "album":
					out[i].Path = snapshot.ExternalID(out[i].Path, services.ResourceAlbum)
				case "collection":
					out[i].Path = snapshot.ExternalID(out[i].Path, services.ResourceCollection)
				}
				out[i].Cover = snapshot.ExternalID(out[i].Cover, services.ResourceFile)
			}
		}
		return c.JSON(fiber.Map{"ok": true, "results": out, "count": len(out), "revision": snapshot.Revision()})
	}
}

func rawResourceID(c *fiber.Ctx) string {
	return strings.TrimSpace(middleware.ResourceID(c))
}
