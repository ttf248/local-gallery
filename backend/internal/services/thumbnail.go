package services

import (
	"bytes"
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/disintegration/imaging"
	lru "github.com/hashicorp/golang-lru/v2"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// ErrUnsupportedFormat 图片格式不受支持。
var ErrUnsupportedFormat = errors.New("unsupported image format")

// ErrSourceMissing 源图片不存在。
var ErrSourceMissing = errors.New("source image not found")

// ErrVideoCoverMissing 视频封面尚未生成。
//
// 流程：前端首次访问视频封面时 GetOrCreate 返回此错误，handler 透传
// 404 + code=video_cover_missing 触发前端 `<video>` 抽帧 → SaveVideoCover
// 回填。第二次访问直接命中磁盘缓存。
var ErrVideoCoverMissing = errors.New("video cover not yet extracted")

// ThumbnailService 缩略图服务：LRU 内存缓存 + 磁盘缓存。
//
// 缓存 key 由 (abs_path, mtime, size) 派生，确保源文件变更后能自动失效。
type ThumbnailService struct {
	cacheDir   string
	width      int
	height     int
	maxAgeDays int
	lruSize    int

	mu       sync.Mutex
	memCache *lru.Cache[string, []byte]
}

// ThumbnailOptions 构造选项。
type ThumbnailOptions struct {
	CacheDir   string // 必填
	Width      int    // 默认 320
	Height     int    // 默认 350
	MaxAgeDays int    // 默认 30
	LRUSize    int    // 默认 500
}

// NewThumbnailService 创建缩略图服务。
func NewThumbnailService(opts ThumbnailOptions) (*ThumbnailService, error) {
	if opts.CacheDir == "" {
		return nil, errors.New("cacheDir is required")
	}
	if err := os.MkdirAll(opts.CacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("create cache dir: %w", err)
	}

	w := opts.Width
	if w <= 0 {
		w = 320
	}
	h := opts.Height
	if h <= 0 {
		h = 350
	}
	days := opts.MaxAgeDays
	if days <= 0 {
		days = 30
	}
	lruSize := opts.LRUSize
	if lruSize <= 0 {
		lruSize = 500
	}

	cache, err := lru.New[string, []byte](lruSize)
	if err != nil {
		return nil, fmt.Errorf("create lru: %w", err)
	}

	return &ThumbnailService{
		cacheDir:   opts.CacheDir,
		width:      w,
		height:     h,
		maxAgeDays: days,
		lruSize:    lruSize,
		memCache:   cache,
	}, nil
}

// CacheKey 计算缓存键。
//
// key = md5(abs_path + "|" + mtime_ns + "|" + size)
func CacheKey(absPath string, mtime time.Time, size int64) string {
	h := md5.New()
	fmt.Fprintf(h, "%s|%d|%d", absPath, mtime.UnixNano(), size)
	return hex.EncodeToString(h.Sum(nil))
}

// CacheKeyFromStat 便捷方法：从文件信息生成 key。
func CacheKeyFromStat(absPath string, fi os.FileInfo) string {
	return CacheKey(absPath, fi.ModTime(), fi.Size())
}

// videoCoverKey 视频封面专用缓存键。
//
// 在普通 CacheKey 前加 "vc:" 前缀，避免与同路径下的图片缩略图键碰撞
// （虽然一般不会同路径同时有图有视频，但显式区分更安全）。失效策略
// 与图片一致：mtime 或 size 变化时自动重新生成。
func videoCoverKey(absPath string, mtime time.Time, size int64) string {
	h := md5.New()
	fmt.Fprintf(h, "vc:%s|%d|%d", absPath, mtime.UnixNano(), size)
	return hex.EncodeToString(h.Sum(nil))
}

// GetOrCreate 获取或生成缩略图。返回 PNG 字节。
//
// 按源文件类型自动分流：
//   - 图片（jpg/png/gif/bmp/webp/tiff）：解码 → 缩放 → 缓存
//   - 视频（mp4/webm/mov/mkv/avi/m4v）：仅查询已缓存的封面
//     （由前端浏览器抽帧后回填到 SaveVideoCover），未命中返回
//     ErrVideoCoverMissing，handler 端透传 404 + code 让前端触发抽帧。
func (s *ThumbnailService) GetOrCreate(absPath string) ([]byte, error) {
	if models.IsVideoFile(filepath.Base(absPath)) {
		return s.getVideoCover(absPath)
	}
	return s.getOrCreateImage(absPath)
}

// getOrCreateImage 现有图片缩略图流程。
func (s *ThumbnailService) getOrCreateImage(absPath string) ([]byte, error) {
	fi, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrSourceMissing
		}
		return nil, err
	}

	key := CacheKeyFromStat(absPath, fi)

	// 1) 内存缓存
	if data, ok := s.memCache.Get(key); ok {
		return data, nil
	}

	// 2) 磁盘缓存
	diskPath := filepath.Join(s.cacheDir, key+".png")
	if data, err := os.ReadFile(diskPath); err == nil {
		s.memCache.Add(key, data)
		return data, nil
	}

	// 3) 生成
	data, err := s.generate(absPath)
	if err != nil {
		return nil, err
	}

	// 写磁盘 + 内存
	if werr := os.WriteFile(diskPath, data, 0o644); werr != nil {
		// 写失败不影响返回（仅缓存丢失）
		fmt.Fprintf(os.Stderr, "write thumb cache %s: %v\n", diskPath, werr)
	}
	s.memCache.Add(key, data)
	return data, nil
}

// getVideoCover 仅查询已缓存的视频封面；未命中返回 ErrVideoCoverMissing。
//
// 注意：先做 Stat 校验源文件存在，避免对已删除视频返回错误状态码
// 误导前端"以为要抽帧"。
func (s *ThumbnailService) getVideoCover(absPath string) ([]byte, error) {
	fi, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, ErrSourceMissing
		}
		return nil, err
	}
	key := videoCoverKey(absPath, fi.ModTime(), fi.Size())

	if data, ok := s.memCache.Get(key); ok {
		return data, nil
	}
	diskPath := filepath.Join(s.cacheDir, key+".png")
	if data, err := os.ReadFile(diskPath); err == nil {
		s.memCache.Add(key, data)
		return data, nil
	}
	return nil, ErrVideoCoverMissing
}

// SaveVideoCover 接收前端浏览器抽帧得到的封面字节，写入缓存。
//
// 流程：
//  1. 校验 absPath 是受支持的视频扩展名 + 文件存在（用于派生 cache key）
//  2. 解码 data 为 image.Image（支持 jpeg/png，前端 canvas.toBlob 通常
//     给出 jpeg，但允许 png）
//  3. 缩放到 s.width × s.height（与图片缩略图同一尺寸，UI 通用）
//  4. 编码为 PNG，写磁盘 + 加内存缓存
//
// 源文件不存在时返回 ErrSourceMissing（前端抽完帧视频已被删等场景）。
// 源文件存在但 data 不是合法图片时返回 ErrUnsupportedFormat。
func (s *ThumbnailService) SaveVideoCover(absPath string, data []byte) error {
	if !models.IsVideoFile(filepath.Base(absPath)) {
		return fmt.Errorf("not a video file: %s", absPath)
	}
	fi, err := os.Stat(absPath)
	if err != nil {
		if os.IsNotExist(err) {
			return ErrSourceMissing
		}
		return err
	}

	// 解码前端上传的字节
	img, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return fmt.Errorf("decode cover data: %w", ErrUnsupportedFormat)
	}

	// 缩放到目标尺寸
	thumb := imaging.Fit(img, s.width, s.height, imaging.Lanczos)
	buf, err := encodePNG(thumb)
	if err != nil {
		return fmt.Errorf("encode png: %w", err)
	}

	key := videoCoverKey(absPath, fi.ModTime(), fi.Size())
	diskPath := filepath.Join(s.cacheDir, key+".png")
	if werr := os.WriteFile(diskPath, buf, 0o644); werr != nil {
		return fmt.Errorf("write cover cache: %w", werr)
	}
	s.memCache.Add(key, buf)
	return nil
}

// generate 解码 → 缩放 → 编码为 PNG。
func (s *ThumbnailService) generate(absPath string) ([]byte, error) {
	img, err := decodeImage(absPath)
	if err != nil {
		if errors.Is(err, imaging.ErrUnsupportedFormat) {
			return nil, ErrUnsupportedFormat
		}
		return nil, fmt.Errorf("decode: %w", err)
	}

	// 缩放到目标尺寸，保持比例，填充（letterbox）
	thumb := imaging.Fit(img, s.width, s.height, imaging.Lanczos)

	buf, err := encodePNG(thumb)
	if err != nil {
		return nil, fmt.Errorf("encode: %w", err)
	}
	return buf, nil
}

// decodeImage 按扩展名选择解码器：
//   - HEIC/HEIF：当前未实现（需要 libde265 CGO 依赖），返回 ErrUnsupportedFormat
//   - 其他：imaging（覆盖 jpg/png/gif/bmp/webp/tiff）
func decodeImage(absPath string) (image.Image, error) {
	ext := strings.ToLower(filepath.Ext(absPath))
	if ext == ".heic" || ext == ".heif" {
		return nil, ErrUnsupportedFormat
	}
	return imaging.Open(absPath, imaging.AutoOrientation(true))
}

// Cleanup 删除早于 maxAgeDays 天的缓存文件。
// 返回被删除的文件数。
func (s *ThumbnailService) Cleanup() (int, error) {
	cutoff := time.Now().AddDate(0, 0, -s.maxAgeDays)

	entries, err := os.ReadDir(s.cacheDir)
	if err != nil {
		return 0, err
	}

	count := 0
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		path := filepath.Join(s.cacheDir, e.Name())
		fi, err := e.Info()
		if err != nil {
			continue
		}
		if fi.ModTime().Before(cutoff) {
			if err := os.Remove(path); err == nil {
				count++
			}
		}
	}
	return count, nil
}

// Stats 返回缓存统计信息。
type ThumbnailStats struct {
	MemoryItems int    `json:"memoryItems"`
	DiskFiles   int    `json:"diskFiles"`
	CacheDir    string `json:"cacheDir"`
	Width       int    `json:"width"`
	Height      int    `json:"height"`
	MaxAgeDays  int    `json:"maxAgeDays"`
	LRUSize     int    `json:"lruSize"`
}

// Stats 返回当前缓存统计。
func (s *ThumbnailService) Stats() ThumbnailStats {
	s.mu.Lock()
	stats := ThumbnailStats{
		MemoryItems: s.memCache.Len(),
		CacheDir:    s.cacheDir,
		Width:       s.width,
		Height:      s.height,
		MaxAgeDays:  s.maxAgeDays,
		LRUSize:     s.lruSize,
	}
	s.mu.Unlock()

	if entries, err := os.ReadDir(s.cacheDir); err == nil {
		stats.DiskFiles = len(entries)
	}
	return stats
}

// UpdateOptions 热更新部分运行参数。0 值表示"不修改"（除了 LRUSize 显式
// 用 0 表示"不重建 LRU"）。调用方负责保证 CacheDir 已存在。
//
//   - Width/Height 变化：影响后续新生成的缩略图，旧的仍按旧尺寸保留在磁盘
//   - MaxAgeDays 变化：影响后续 Cleanup 的截止时间
//   - LRUSize 变化：重建 LRU 内存缓存（现有项全部丢弃）
//   - CacheDir 变化：先 MkdirAll 验证新目录可创建，再切换；旧目录保留
func (s *ThumbnailService) UpdateOptions(opts ThumbnailOptions) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if opts.Width > 0 {
		s.width = opts.Width
	}
	if opts.Height > 0 {
		s.height = opts.Height
	}
	if opts.MaxAgeDays > 0 {
		s.maxAgeDays = opts.MaxAgeDays
	}
	if opts.LRUSize > 0 && opts.LRUSize != s.lruSize {
		cache, err := lru.New[string, []byte](opts.LRUSize)
		if err != nil {
			return fmt.Errorf("rebuild lru: %w", err)
		}
		s.memCache = cache
		s.lruSize = opts.LRUSize
	}
	if opts.CacheDir != "" && opts.CacheDir != s.cacheDir {
		if err := os.MkdirAll(opts.CacheDir, 0o755); err != nil {
			return fmt.Errorf("create new cache dir: %w", err)
		}
		s.cacheDir = opts.CacheDir
	}
	return nil
}

// ---- 辅助：避免引入 png encoder 时的循环依赖噪音 ----

func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
