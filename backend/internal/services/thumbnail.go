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
)

// ErrUnsupportedFormat 图片格式不受支持。
var ErrUnsupportedFormat = errors.New("unsupported image format")

// ErrSourceMissing 源图片不存在。
var ErrSourceMissing = errors.New("source image not found")

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

// GetOrCreate 获取或生成缩略图。返回 PNG 字节。
func (s *ThumbnailService) GetOrCreate(absPath string) ([]byte, error) {
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
