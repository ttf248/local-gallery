package services

import (
	"io/fs"
	"os"
	"path/filepath"
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
