package services

import (
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CacheUsage 缓存目录的占用快照。
type CacheUsage struct {
	Path       string    `json:"path"`
	TotalBytes int64     `json:"totalBytes"`
	FileCount  int       `json:"fileCount"`
	ScannedAt  time.Time `json:"scannedAt"`
	DurationMs int64     `json:"durationMs"`
	// 目录存在但还没被扫描/磁盘读取出错时给 false
	Available bool `json:"available"`

	// 按子目录细分的占用。子目录在 ConfigCacheDir 下:
	//   - thumbs/<md5>.jpg      → Thumbs(图片 + 视频封面缩略图)
	//   - video-faststart/<md5>.mp4 → 非 faststart MP4 的 remux 缓存
	//   - video-transcode/<md5>.mp4 → 冷门编码 → H.264+AAC 转码缓存
	//
	// Settings 页面用这些数据告诉用户「大头在哪」,让用户知道
	// 转码缓存过大时可以批量清理。totalBytes = 三个子目录之和
	// (顶层 scan_cache.json / web_settings.json 忽略,体量小且跟
	// 用户数据无关)。
	Thumbs        SubUsage `json:"thumbs"`
	VideoFaststart SubUsage `json:"videoFaststart"`
	VideoTranscode SubUsage `json:"videoTranscode"`
}

// SubUsage 子目录占用(单一子树)。
type SubUsage struct {
	Path      string `json:"path"` // 子目录绝对路径,UI 可用「在资源管理器中打开」
	Bytes     int64  `json:"bytes"`
	FileCount int    `json:"fileCount"`
	// 子目录不存在时为 false(用户可能还没产生过该类缓存)
	Available bool `json:"available"`
}

// CacheStatsService 缓存目录统计服务,带 30s 内存 TTL 避免频繁刷新卡 UI。
type CacheStatsService struct {
	mu     sync.Mutex
	cache  *CacheUsage
	expiry time.Time
	ttl    time.Duration
}

// NewCacheStatsService 构造;ttl 通常 30s。
func NewCacheStatsService(ttl time.Duration) *CacheStatsService {
	if ttl <= 0 {
		ttl = 30 * time.Second
	}
	return &CacheStatsService{ttl: ttl}
}

// Usage 返回 cacheDir 当前占用快照。
//
//   - 目录不存在:返回 Available=false 的空快照,不报错(用户可能没建好)
//   - TTL 内的重复调用:直接返回缓存
//   - 扫描出错(权限等):返回部分结果 + 错误(调用方按需处理)
func (s *CacheStatsService) Usage(cacheDir string) (*CacheUsage, *time.Time, error) {
	if cacheDir == "" {
		return &CacheUsage{Available: false}, nil, nil
	}

	// 先检查 TTL 命中
	s.mu.Lock()
	if s.cache != nil && s.cache.Path == cacheDir && time.Now().Before(s.expiry) {
		cp := *s.cache
		exp := s.expiry
		s.mu.Unlock()
		return &cp, &exp, nil
	}
	s.mu.Unlock()

	start := time.Now()
	// 先用 Stat 探测顶层:WalkDir 自身对根目录不存在的错误包装不稳定,
	// 显式 stat 一次更可靠。
	info, statErr := os.Stat(cacheDir)
	if statErr != nil {
		// 顶层目录不存在/无权限:返回空快照不算错
		usage := &CacheUsage{
			Path:      cacheDir,
			Available: false,
			ScannedAt: time.Now(),
		}
		// 仍然写入缓存(无错误,只是空),让 TTL 命中避免每次请求 stat
		s.mu.Lock()
		s.cache = usage
		s.expiry = time.Now().Add(s.ttl)
		s.mu.Unlock()
		exp := s.expiry
		return usage, &exp, nil
	}
	if !info.IsDir() {
		// 路径是文件不是目录:同样返回空
		usage := &CacheUsage{
			Path:      cacheDir,
			Available: false,
			ScannedAt: time.Now(),
		}
		s.mu.Lock()
		s.cache = usage
		s.expiry = time.Now().Add(s.ttl)
		s.mu.Unlock()
		exp := s.expiry
		return usage, &exp, nil
	}

	var (
		total   int64
		count   int
		walkErr error
	)
	// filepath.WalkDir 单次遍历;err 走 visit 的 err 参数(单文件读不到 stat 时
	// 跳过,不让整个遍历失败)
	walkErr = filepath.WalkDir(cacheDir, func(_ string, d fs.DirEntry, err error) error {
		if err != nil {
			// 跳过单个错误,继续扫描
			return nil
		}
		if d.IsDir() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		total += fi.Size()
		count++
		return nil
	})

	usage := &CacheUsage{
		Path:       cacheDir,
		TotalBytes: total,
		FileCount:  count,
		ScannedAt:  time.Now(),
		DurationMs: time.Since(start).Milliseconds(),
		Available:  walkErr == nil,
		// 按子目录细分:thumbs 走顶层 .jpg(实际存放在 cacheDir 顶层),
		// faststart / transcode 走子目录(由各自 service 写入子目录)。
		// 详见 scanThumbsTopLevel 的注释。
		Thumbs:         scanThumbsTopLevel(cacheDir),
		VideoFaststart: scanSubDir(filepath.Join(cacheDir, "video-faststart")),
		VideoTranscode: scanSubDir(filepath.Join(cacheDir, "video-transcode")),
	}

	// 缓存(只有没错误的快照才缓存,避免权限错误被锁住)
	var expiry *time.Time
	if walkErr == nil {
		s.mu.Lock()
		s.cache = usage
		s.expiry = time.Now().Add(s.ttl)
		exp := s.expiry
		s.mu.Unlock()
		expiry = &exp
	}
	return usage, expiry, walkErr
}

// Invalidate 强制下一次 Usage 调用重算(用于清理缓存后立即刷新展示)。
func (s *CacheStatsService) Invalidate() {
	s.mu.Lock()
	s.cache = nil
	s.expiry = time.Time{}
	s.mu.Unlock()
}

// scanSubDir 扫描单个子目录,返回 SubUsage。
//
// 与主扫描共用相同的「跳过单文件错误,继续遍历」策略 —
// 一个权限错误不应该让整个 cache stats 报失败。
// 子目录不存在是正常情况(用户还没产生过该类缓存),返回 Available=false
// 即可,不算 error。
func scanSubDir(path string) SubUsage {
	su := SubUsage{Path: path, Available: false}
	info, err := os.Stat(path)
	if err != nil || !info.IsDir() {
		return su
	}
	su.Available = true
	_ = filepath.WalkDir(path, func(_ string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() {
			return nil
		}
		fi, err := d.Info()
		if err != nil {
			return nil
		}
		su.Bytes += fi.Size()
		su.FileCount++
		return nil
	})
	return su
}

// scanThumbsTopLevel 统计 cacheDir 顶层缩略图文件。
//
// 历史背景:ThumbnailService 把每张缩略图直接以 <md5>.jpg 存在
// cacheDir 顶层,不放在 thumbs/ 子目录里(早期 cache.go 也用这个路径
// 写 cacheDir/sub/<file> 这样的双层嵌套,后续被修正)。但 cache stats
// 一直按"thumbs/ 子目录"去 scanSubDir,导致子目录不存在 → Available=false
// → UI 永远显示"—",即便用户其实有几百 MB 缩略图。
//
// 修法:在 cacheDir 顶层只统计扩展名为 .jpg / .jpeg 的文件,跳过:
//   - 顶层子目录(video-faststart / video-transcode 等由 scanSubDir 接管)
//   - 顶层元数据文件(scan_cache.json / web_settings.json / cover_overrides.json
//     等,扩展名非图片)
//
// 单层 ReadDir 而不递归,避免误把子目录里的 jpg 算进来
// (子目录的扫描由 scanSubDir 单独负责)。
func scanThumbsTopLevel(cacheDir string) SubUsage {
	su := SubUsage{Path: cacheDir, Available: false}
	info, err := os.Stat(cacheDir)
	if err != nil || !info.IsDir() {
		return su
	}
	entries, err := os.ReadDir(cacheDir)
	if err != nil {
		// 目录存在但读不到(权限等):available 仍为 false
		return su
	}
	su.Available = true
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		ext := strings.ToLower(filepath.Ext(e.Name()))
		if ext != ".jpg" && ext != ".jpeg" {
			continue
		}
		fi, infoErr := e.Info()
		if infoErr != nil {
			continue
		}
		su.Bytes += fi.Size()
		su.FileCount++
	}
	return su
}
