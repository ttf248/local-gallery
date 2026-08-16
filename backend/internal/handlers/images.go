package handlers

import (
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

// ImageHandler 返回 /api/images 原图（支持 Range 请求）。
//
//   GET /api/images?path=<绝对路径>
//
// 浏览器原生不识别的格式（HEIC/HEIF）原样返回，由浏览器自身决定
// 能否解码（Safari 可显示；Chrome/Firefox 不能）。其它格式由
// Fiber 内置 ServeFile 根据扩展名自动设置 Content-Type + 支持 Range。
func ImageHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		// HEIC/HEIF 等不常见格式显式声明 Content-Type，避免 Fiber
		// mime 表里没有时落到 application/octet-stream。
		ext := strings.ToLower(filepath.Ext(path))
		if ext == ".heic" || ext == ".heif" {
			c.Set("Content-Type", "image/heic")
		}
		c.Set("Cache-Control", "public, max-age=86400")
		return c.SendFile(path, false)
	}
}

// ImageInfoHandler 返回图片元数据（尺寸、格式、大小、修改时间、checksum）。
//
//   GET /api/images/info?path=<绝对路径>
func ImageInfoHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		info, err := services.GetImageInfo(path)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		return c.JSON(info)
	}
}