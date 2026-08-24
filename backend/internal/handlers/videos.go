package handlers

import (
	"errors"
	"os"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/models"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

// VideoHandler 返回 /api/videos 原视频流（支持 Range 请求）。
//
//   GET /api/videos?path=<absolute>
//
// 浏览器 `<video>` 元素拖动进度条时会自动发 Range 请求；Fiber 的
// SendFile 默认支持 Range，依赖源文件大小返回 206 Partial Content。
//
// 重要：路径必须在任一 mediaRoots 之下（路径安全中间件统一校验），
// 扩展名必须在 models.VideoExts 白名单内（防止把任意文件当视频流）。
func VideoHandler() fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		if !models.IsVideoFile(filepath.Base(path)) {
			return c.Status(fiber.StatusUnsupportedMediaType).JSON(fiber.Map{
				"error": "not a supported video format",
			})
		}
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		c.Set("Content-Type", videoMime(path))
		c.Set("Accept-Ranges", "bytes")
		// 视频比图片大得多，缓存时间短一些（1 天）
		c.Set("Cache-Control", "public, max-age=86400")
		_ = info // 预留：将来可用于记录 last-modified / content-length 头
		return c.SendFile(path, false)
	}
}

// VideoInfoHandler 返回视频文件的元数据。
//
//   GET /api/videos/info?path=<absolute>
//
// 字段：
//   - path / name / dir / size / mtime：与服务端文件信息一致
//   - format：扩展名（含点，小写）
//   - duration / width / height / codec / container / bitRate：
//     当 VideoInfoService 可用（ffprobe 装好）时填入；否则全 0/空串，
//     前端仍可走 <video> 元素的 loadedmetadata 上报作为兜底。
//
// 性能: ffprobe 只读 metadata,1GB 视频典型 50-150ms,远快于让前端
// <video> 加载整个文件再拿 metadata(几个 GB 流量 + 几秒解码)。
func VideoInfoHandler(infoSvc *services.VideoInfoService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		path := middleware.SafePath(c)
		if path == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "missing 'path' query parameter",
			})
		}
		if !models.IsVideoFile(filepath.Base(path)) {
			return c.Status(fiber.StatusUnsupportedMediaType).JSON(fiber.Map{
				"error": "not a supported video format",
			})
		}
		info, err := os.Stat(path)
		if err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		}
		resp := fiber.Map{
			"path":   path,
			"name":   filepath.Base(path),
			"dir":    filepath.Dir(path),
			"size":   info.Size(),
			"mtime":  info.ModTime().UTC().Format("2006-01-02T15:04:05Z"),
			"format": strings.ToLower(filepath.Ext(path)),
		}
		// 可选:ffprobe 元数据。失败也不报错(前端 <video> 可兜底)
		if infoSvc != nil && infoSvc.Available() {
			if meta, err := infoSvc.Probe(path); err == nil && meta != nil {
				resp["duration"] = meta.DurationSec
				resp["width"] = meta.Width
				resp["height"] = meta.Height
				resp["codec"] = meta.Codec
				resp["container"] = meta.Container
				resp["bitRate"] = meta.BitRate
			} else if err != nil && !errors.Is(err, services.ErrProbeUnavailable) {
				// 解析错误:记日志但仍返回基础元数据
				// (避免单文件坏掉让整个接口 5xx)
				resp["probeError"] = err.Error()
			}
		}
		return c.JSON(resp)
	}
}

// videoMime 按扩展名返回常见视频 MIME。
//
// `<video>` 元素对错误的 MIME 会拒绝播放；显式声明覆盖 Fiber 默认
// table 中可能缺失的条目。
func videoMime(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp4", ".m4v":
		return "video/mp4"
	case ".webm":
		return "video/webm"
	case ".mov":
		return "video/quicktime"
	case ".mkv":
		// .mkv 在 Web 平台不官方支持（虽部分浏览器能播），标 matroska 更安全
		return "video/x-matroska"
	case ".avi":
		return "video/x-msvideo"
	default:
		return "application/octet-stream"
	}
}
