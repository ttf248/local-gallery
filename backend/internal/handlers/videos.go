package handlers

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// VideoHandler 返回资源 ID 指向的视频流（支持 Range 请求）。
//
//	GET /api/media/:id
//
// 浏览器 `<video>` 元素拖动进度条时会自动发 Range 请求；Fiber 的
// SendFile 默认支持 Range，依赖源文件大小返回 206 Partial Content。
//
// 重要：路径必须在任一 mediaRoots 之下（路径安全中间件统一校验），
// 扩展名必须在 models.VideoExts 白名单内（防止把任意文件当视频流）。
//
// 视频处理 pipeline（按顺序尝试，全部可选；任一失败都回退到下一档）：
//  1. TranscodeService.Resolve(path) — 浏览器播不了的冷门编码
//     (AV1/HEVC/ProRes 等) 转成 H.264+AAC 缓存后发
//  2. FaststartService.Resolve(path) — moov atom 在末尾的 MP4
//     remux 移头(几秒)后发
//  3. 原文件 — 兜底
//
// 透明调用,前端不需要知道哪个文件被转码了;Range/MIME 行为不变。
func VideoHandler(transcode *services.TranscodeService, faststart *services.VideoFaststartService) fiber.Handler {
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
		if _, err := os.Stat(path); err != nil {
			if os.IsNotExist(err) {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "not found"})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "failed to read media resource"})
		}
		// 决定实际发送哪个文件:
		//   transcode 命中 → 发转码缓存(浏览器能直播)
		//   否则 faststart → 发 remux 缓存(浏览器能边下边播)
		//   都不命中      → 发原文件
		servePath := path
		if transcode != nil {
			if p, st := transcode.Resolve(path); st == services.TranscodeStatusCached {
				servePath = p
			}
		}
		if servePath == path && faststart != nil {
			servePath, _ = faststart.Resolve(path)
		}

		// 缓存协商:基于「实际发送的文件」派生 ETag(转码/重封装后是
		// 另一个文件,不能拿原文件的 mtime+size)。命中 If-None-Match
		// 时返回 304 + 空 body,1GB+ 视频可省下 206 的几 MB。
		// 304 优先于 Range:浏览器会重新发不带 If-None-Match 的 Range
		// 拿到实际片段,这是 HTTP 标准行为,主流浏览器都遵守。
		if info, statErr := os.Stat(servePath); statErr == nil {
			etag := videoETag(info)
			c.Set("ETag", etag)
			if match := c.Get("If-None-Match"); match != "" && match == etag {
				return c.SendStatus(fiber.StatusNotModified)
			}
		}

		c.Set("Content-Type", videoMime(servePath))
		c.Set("Accept-Ranges", "bytes")
		// 视频比图片大得多，缓存时间短一些（1 天）
		c.Set("Cache-Control", "public, max-age=86400")
		return c.SendFile(servePath, false)
	}
}

// VideoInfoHandler 返回视频文件的元数据。
//
//	GET /api/videos/:id/info
//
// 字段：
//   - path / name / dir / size / mtime：与服务端文件信息一致
//   - format：扩展名（含点，小写）
//   - duration / width / height / codec / container / bitRate：
//     当 VideoInfoService 可用（ffprobe 装好）时填入；否则全 0/空串，
//     前端仍可走 <video> 元素的 loadedmetadata 上报作为兜底。
//   - transcode { needed, status, progress, error }：
//     当 VideoTranscodeService 可用时填入。前端可以据此：
//   - 显示「正在转码 30% 预计 3 分钟」提示
//   - 转好后自动重挂载 <video src=...> 走缓存
//     没装 ffmpeg / 编码浏览器能播 → 整个字段省略,前端视为「不用转」
//
// 性能: ffprobe 只读 metadata,1GB 视频典型 50-150ms,远快于让前端
// <video> 加载整个文件再拿 metadata(几个 GB 流量 + 几秒解码)。
func VideoInfoHandler(infoSvc *services.VideoInfoService, transcode *services.TranscodeService, catalogs ...*services.ResourceCatalog) fiber.Handler {
	catalog := optionalCatalog(catalogs)
	return func(c *fiber.Ctx) error {
		resourceID := middleware.ResourceID(c)
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
		publicPath := path
		publicDir := filepath.Dir(path)
		if catalog != nil {
			publicPath = resourceID
			publicDir = catalog.RelativeLabel(resourceID)
		}
		resp := fiber.Map{
			"path":   publicPath,
			"name":   filepath.Base(path),
			"dir":    publicDir,
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
		// 转码状态(可选):仅在 service 可用 + ffmpeg 装好时填
		if transcode != nil && transcode.Available() {
			ts := transcode.GetStatus(path)
			// not_needed / unavailable 字段仍带,前端可以"知道自己被服务端认作不需要转"
			resp["transcode"] = fiber.Map{
				"status":   ts.Status.String(),
				"progress": ts.Progress,
				"error":    ts.Error,
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

// videoETag 基于「实际发送的文件」的 mtime+size 派生 ETag,带双引号
// 符合 HTTP 规范(浏览器回传的 If-None-Match 也带双引号,字面相等
// 才能命中)。
//
// 不使用内容的强哈希(没必要也不值得为 1GB+ 视频跑 sha256);
// mtime+size 在源文件 / 转码 / 重封装结果稳定时也稳定,符合
// 「弱 ETag」的语义。
//
// 与 thumbs.ThumbHandler 的 ETag 行为保持一致(都带双引号,十六进制
// mtime+size),保证 304 协商在两个端点都能命中。
//
// 不能用 fmt.Sprintf("%q...", int64) — %q 会把整数当 Unicode 码点
// 处理,UnixNano() 这种大数会输出乱码。改用 strconv.Quote 包装。
func videoETag(info os.FileInfo) string {
	raw := fmt.Sprintf("%x-%x", info.ModTime().UnixNano(), info.Size())
	return strconv.Quote(raw)
}
