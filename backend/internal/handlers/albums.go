// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

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
// 关键字匹配 name/tag 子串（不区分大小写）。limit 默认 50。
// 搜索索引与分页摘要随同一个 catalog revision 一次性发布。
func SearchHandler(catalog *services.ResourceCatalog) fiber.Handler {
	return func(c *fiber.Ctx) error {
		q := strings.TrimSpace(c.Query("q"))
		if q == "" {
			return c.JSON(fiber.Map{"ok": true, "results": []services.LibrarySearchHit{}})
		}
		limit := c.QueryInt("limit", 50)
		if limit <= 0 || limit > 500 {
			limit = 50
		}
		snapshot := catalog.Acquire()
		if !snapshot.Ready() {
			return c.JSON(fiber.Map{"ok": true, "results": []services.LibrarySearchHit{}, "scanned": false})
		}
		results := services.SearchLibrary(snapshot, q, limit)
		return c.JSON(fiber.Map{"ok": true, "results": results, "count": len(results), "revision": snapshot.Revision()})
	}
}

func rawResourceID(c *fiber.Ctx) string {
	return strings.TrimSpace(middleware.ResourceID(c))
}
