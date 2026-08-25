// Package store 提供偏好持久化与原子读写。
package store

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// PrefsStore 文件型偏好存储。
//
// 文件不存在 → 返回默认值；解析失败 → 返回错误并保留旧文件备份。
// 每次写入采用 tmp + rename 原子替换，避免崩溃时半截文件。
type PrefsStore struct {
	path string

	mu      sync.RWMutex
	cached  models.Prefs
	loaded  bool
}

// NewPrefsStore 创建存储（不立即读盘）。
func NewPrefsStore(path string) *PrefsStore {
	return &PrefsStore{path: path}
}

// load 读取并解析文件到内存缓存。
// 文件不存在 → 返回默认值。
// 解析失败 → 备份坏文件并返回默认值（不返回错误，确保服务可用）。
func (s *PrefsStore) load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			s.cached = models.DefaultPrefs()
			s.loaded = true
			return nil
		}
		return err
	}
	p := models.DefaultPrefs()
	if err := json.Unmarshal(data, &p); err != nil {
		_ = os.Rename(s.path, s.path+".corrupt."+time.Now().Format("20060102150405"))
		s.cached = models.DefaultPrefs()
		s.loaded = true
		return nil
	}
	s.cached = normalize(p)
	s.loaded = true
	return nil
}

func normalize(p models.Prefs) models.Prefs {
	d := models.DefaultPrefs()
	if p.Favorites == nil {
		p.Favorites = d.Favorites
	}
	if p.History == nil {
		p.History = d.History
	}
	if p.ReadingProgress == nil {
		p.ReadingProgress = d.ReadingProgress
	}
	if p.MaxRecent <= 0 {
		p.MaxRecent = d.MaxRecent
	}
	if p.Theme == "" {
		p.Theme = d.Theme
	}
	return p
}

// Get 返回当前偏好（首次访问时自动加载）。
func (s *PrefsStore) Get() (models.Prefs, error) {
	s.mu.RLock()
	if s.loaded {
		p := s.cached
		s.mu.RUnlock()
		return p, nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.loaded {
		if err := s.load(); err != nil {
			return models.DefaultPrefs(), err
		}
	}
	return s.cached, nil
}

// Update 全量覆盖（用于 PATCH）。
func (s *PrefsStore) Update(p models.Prefs) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.cached = normalize(p)
	return s.flushLocked()
}

// AddFavorite 添加收藏（幂等）。返回更新后的列表。
func (s *PrefsStore) AddFavorite(path string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	for _, f := range s.cached.Favorites {
		if f == path {
			return s.cached.Favorites, nil
		}
	}
	s.cached.Favorites = append(s.cached.Favorites, path)
	// 软上限：收藏超过 maxFavorites 时丢弃最旧的，避免无限增长。
	// 用户可通过 PruneInvalidFavorites / DELETE 主动清理。
	const maxFavorites = 500
	if len(s.cached.Favorites) > maxFavorites {
		s.cached.Favorites = s.cached.Favorites[len(s.cached.Favorites)-maxFavorites:]
	}
	if err := s.flushLocked(); err != nil {
		return nil, err
	}
	return s.cached.Favorites, nil
}

// RemoveFavorite 移除收藏。
func (s *PrefsStore) RemoveFavorite(path string) ([]string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	out := s.cached.Favorites[:0]
	for _, f := range s.cached.Favorites {
		if f != path {
			out = append(out, f)
		}
	}
	s.cached.Favorites = out
	if err := s.flushLocked(); err != nil {
		return nil, err
	}
	return s.cached.Favorites, nil
}

// PruneInvalidFavorites 移除磁盘上已不存在的路径。
func (s *PrefsStore) PruneInvalidFavorites() (removed []string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	out := s.cached.Favorites[:0]
	for _, f := range s.cached.Favorites {
		if _, statErr := os.Stat(f); statErr == nil {
			out = append(out, f)
		} else {
			removed = append(removed, f)
		}
	}
	s.cached.Favorites = out
	if len(removed) == 0 {
		return nil, nil
	}
	if err := s.flushLocked(); err != nil {
		return removed, err
	}
	return removed, nil
}

// AddHistory 添加一条历史记录（LRU 去重 + 上限裁剪）。
func (s *PrefsStore) AddHistory(entry models.HistoryEntry) ([]models.HistoryEntry, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}

	// 去重（最新优先）
	out := []models.HistoryEntry{entry}
	for _, h := range s.cached.History {
		if h.Path == entry.Path {
			continue
		}
		out = append(out, h)
	}
	// 按时间倒序
	sort.SliceStable(out, func(i, j int) bool {
		return out[i].OpenedAt.After(out[j].OpenedAt)
	})
	// 裁剪
	if len(out) > s.cached.MaxRecent {
		out = out[:s.cached.MaxRecent]
	}
	s.cached.History = out
	if err := s.flushLocked(); err != nil {
		return nil, err
	}
	return s.cached.History, nil
}

// ClearHistory 清空历史。
func (s *PrefsStore) ClearHistory() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.cached.History = []models.HistoryEntry{}
	return s.flushLocked()
}

// SetReadingProgress 记录某相册的阅读进度（LRU，去重）。
func (s *PrefsStore) SetReadingProgress(entry models.ReadingProgress) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	out := []models.ReadingProgress{entry}
	for _, r := range s.cached.ReadingProgress {
		if r.Path == entry.Path {
			continue
		}
		out = append(out, r)
	}
	// 上限 50 条，防止无限增长
	const maxRP = 50
	if len(out) > maxRP {
		out = out[:maxRP]
	}
	s.cached.ReadingProgress = out
	return s.flushLocked()
}

// GetReadingProgress 读取某相册的阅读进度。
func (s *PrefsStore) GetReadingProgress(path string) (models.ReadingProgress, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, r := range s.cached.ReadingProgress {
		if r.Path == path {
			return r, true
		}
	}
	return models.ReadingProgress{}, false
}

// DeleteReadingProgress 删除某相册的阅读进度。
// 用于首页「继续阅读」移除单项：用户看了几页后想从列表里移出，不想再被记录。
// 返回 (true) 表示该 path 原本存在并被删除；(false) 表示原本就不存在，幂等。
func (s *PrefsStore) DeleteReadingProgress(path string) (bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return false, err
	}
	before := len(s.cached.ReadingProgress)
	out := s.cached.ReadingProgress[:0]
	for _, r := range s.cached.ReadingProgress {
		if r.Path == path {
			continue
		}
		out = append(out, r)
	}
	s.cached.ReadingProgress = out
	if len(out) == before {
		return false, nil
	}
	if err := s.flushLocked(); err != nil {
		return true, err
	}
	return true, nil
}

// ClearAllReadingProgress 清空所有阅读进度。
// 用于首页「继续阅读」一键清空：用户已经看完或不想再被旧进度打扰。
// 返回删除的条数。
func (s *PrefsStore) ClearAllReadingProgress() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.ensureLoaded(); err != nil {
		return 0, err
	}
	n := len(s.cached.ReadingProgress)
	s.cached.ReadingProgress = nil
	if n == 0 {
		return 0, nil
	}
	if err := s.flushLocked(); err != nil {
		return n, err
	}
	return n, nil
}

// GetReadingProgressBatch 一次性读取多个路径的阅读进度。
// 返回 map[path]progress，缺失项不出现在 map 中。
// 一次加锁，避免 N 路并发 GET /api/progress?path=... 的锁竞争。
func (s *PrefsStore) GetReadingProgressBatch(paths []string) map[string]models.ReadingProgress {
	out := make(map[string]models.ReadingProgress, len(paths))
	if len(paths) == 0 {
		return out
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, path := range paths {
		for _, r := range s.cached.ReadingProgress {
			if r.Path == path {
				out[path] = r
				break
			}
		}
	}
	return out
}

// ---- 内部 ----

// ensureLoaded 必须在已持锁时调用。
func (s *PrefsStore) ensureLoaded() error {
	if s.loaded {
		return nil
	}
	return s.load()
}

// flushLocked 必须在已持锁时调用。原子写入。
func (s *PrefsStore) flushLocked() error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(s.cached, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		return fmt.Errorf("rename %s -> %s: %w", tmp, s.path, err)
	}
	return nil
}
