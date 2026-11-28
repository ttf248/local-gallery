package handlers

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

func comicBody(c *fiber.Ctx, target any) bool {
	d := json.NewDecoder(bytes.NewReader(c.Body()))
	d.DisallowUnknownFields()
	return d.Decode(target) == nil && d.Decode(new(any)) == io.EOF
}
func ComicMetaHandler(s *services.ComicMetaService, validator middleware.PathValidator) fiber.Handler {
	return func(c *fiber.Ctx) error {
		snap := s.Catalog.Acquire()
		id := c.Params("id")
		if !snap.Ready() {
			return writeError(c, 409, "library_not_ready", "媒体库尚未就绪")
		}
		ref, ok := snap.Lookup(id)
		if !ok {
			return writeError(c, 404, "comic_not_found", "未找到漫画")
		}
		if _, err := validator.Validate(ref.AbsolutePath); err != nil {
			return writeError(c, 404, "comic_not_found", "未找到漫画")
		}
		meta, ok := s.ResolveNodeMeta(snap, id)
		if !ok {
			return writeError(c, 400, "not_comic_resource", "请选择漫画作品或卷")
		}
		var err error
		switch c.Method() {
		case "PUT":
			var p services.ComicWorkOverridePatch
			if !comicBody(c, &p) {
				return writeError(c, 400, "invalid_comic_meta", "作品信息格式无效")
			}
			meta, err = s.SaveOverride(snap, id, p)
		case "DELETE":
			meta, err = s.ClearOverride(snap, id)
		case "POST":
			var p struct {
				Force       bool
				AllowOnline *bool
			}
			if len(c.Body()) > 0 && !comicBody(c, &p) {
				return writeError(c, 400, "invalid_comic_meta", "识别选项无效")
			}
			online := s.OnlineEnabled()
			if p.AllowOnline != nil {
				online = *p.AllowOnline
			}
			meta, err = s.RefreshWork(c.UserContext(), snap, id, online)
		}
		switch {
		case errors.Is(err, services.ErrOnlineComicDisabled):
			return writeError(c, 403, "online_meta_disabled", "在线元数据匹配尚未开启")
		case errors.Is(err, services.ErrInvalidComicMeta):
			return writeError(c, 400, "invalid_comic_meta", "请检查作品信息的长度与内容")
		case errors.Is(err, services.ErrLibraryResourceNotFound):
			return writeError(c, 404, "comic_not_found", "未找到漫画")
		case err != nil:
			return writeError(c, 500, "comic_meta_failed", "作品信息处理失败")
		}
		result := fiber.Map{"ok": true, "meta": meta, "revision": s.Catalog.Acquire().Revision()}
		if meta.Warning != "" {
			result["warning"] = meta.Warning
		}
		return c.JSON(result)
	}
}
func CollectionCoverHandler(catalog *services.ResourceCatalog, cache *services.ScanResultCache, store *services.CoverOverrideStore, v middleware.PathValidator) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		snap := catalog.Acquire()
		node, ok := snap.LibraryNode(id)
		if !ok {
			return writeError(c, 404, "comic_not_found", "未找到作品")
		}
		if node.Kind != "collection" || node.ContentKind != "comic" {
			return writeError(c, 400, "not_comic_resource", "请选择漫画作品")
		}
		ref, _ := snap.Lookup(id)
		dir, err := v.Validate(ref.AbsolutePath)
		if err != nil {
			return writeError(c, 404, "comic_not_found", "未找到作品")
		}
		if c.Method() == "PUT" {
			file, ok := snap.Lookup(c.Query("file"))
			if !ok || file.Kind != services.ResourceFile || file.RootID != ref.RootID || !isFileInsideDir(file.AbsolutePath, dir) {
				return writeError(c, 400, "file_outside_collection", "请选择该作品中的页面")
			}
			path, err := v.Validate(file.AbsolutePath)
			if err != nil {
				return writeError(c, 400, "invalid_cover_file", "页面不可用")
			}
			info, err := os.Lstat(path)
			if err != nil || !info.Mode().IsRegular() || !models.IsImageFile(path) {
				return writeError(c, 400, "invalid_cover_file", "页面不可用")
			}
			err = store.SetCollection(dir, path)
			if err != nil {
				return writeError(c, 500, "cover_override_save_failed", "保存封面失败")
			}
		} else if err = store.ClearCollection(dir); err != nil {
			return writeError(c, 500, "cover_override_clear_failed", "清除封面失败")
		}
		_, rev, ok := catalog.RefreshCovers(cache, store)
		if !ok {
			return writeError(c, 409, "library_not_ready", "媒体库尚未就绪")
		}
		node, _ = catalog.Acquire().LibraryNode(id)
		return c.JSON(fiber.Map{"ok": true, "collectionId": id, "coverImage": node.CoverImage, "coverKind": node.CoverKind, "revision": rev})
	}
}
