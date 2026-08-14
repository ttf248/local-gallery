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

	"github.com/tianlongxiang/comic-reader/internal/models"
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
