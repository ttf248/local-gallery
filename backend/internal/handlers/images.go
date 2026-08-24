package handlers

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// imageETag 基于文件 mtime+size 派生 ETag,带双引号(强 ETag 字面相等语义)。
//
// 与视频共用同一公式:文件没被改动时 ETag 稳定,源文件改了 ETag 变,
// 浏览器重新拉;文件 mtime 因复制/解压/同步而刷新是可接受的:
// 本地画廊不是 CDN,重传一两次反而是「确保用户看到最新版」的行为。
//
// 不跑 sha256 等内容哈希:1 张 50MB RAW 拍 sha256 浪费 CPU,用户
// 感知不到差别,源文件 mtime+size 才是更合适的「弱 ETag」。
func imageETag(info os.FileInfo) string {
	return fmt.Sprintf(`"%x-%x"`, info.ModTime().UnixNano(), info.Size())
}

// ImageHandler 返回 /api/images 原图（支持 Range 请求 + ETag 协商）。
//
//   GET /api/images?path=<绝对路径>
//
// 浏览器原生不识别的格式（HEIC/HEIF）原样返回，由浏览器自身决定
// 能否解码（Safari 可显示；Chrome/Firefox 不能）。其它格式由
// Fiber 内置 ServeFile 根据扩展名自动设置 Content-Type + 支持 Range。
//
// ETag 协商:
//   - 第一次响应带 ETag = mtime+size + Cache-Control
//   - 浏览器下次带 If-None-Match;若匹配 → 304 + 空 body,省下整个文件传输
//   - 与视频共用同一公式;图片也常被重复打开(画廊里翻回去 / 缩略图 hover),
//     4MB 的 JPEG 走 304 比 200 体感差异明显(尤其在远程桌面 / 局域网场景)
func ImageHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		// ETag + 304 协商(命中 If-None-Match 时直接返回,不发 body)
		etag := imageETag(info)
		c.Set("ETag", etag)
		if match := c.Get("If-None-Match"); match != "" && match == etag {
			return c.SendStatus(fiber.StatusNotModified)
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