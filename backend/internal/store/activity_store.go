// Package store 提供活动记录的持久化与原子读写。
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

const activityFileVersion = 1

type activityFile struct {
	Version    int               `json:"version"`
	Activities []models.Activity `json:"activities"`
}

// ActivityStore 将高频阅读/播放活动与低频偏好文件分离，避免
// GET /prefs 携带不受限的活动列表。内存中按不透明 ID 组合键索引。
type ActivityStore struct {
	path            string
	legacyPrefsPath string

	mu     sync.RWMutex
	items  map[string]models.Activity
	loaded bool
}

// NewActivityStore 创建活动存储。legacyPrefsPath 仅用于首次升级时
// 迁移旧 readingProgress；新文件一旦存在就不再读取旧字段。
func NewActivityStore(path, legacyPrefsPath string) *ActivityStore {
	return &ActivityStore{path: path, legacyPrefsPath: legacyPrefsPath}
}

// Load 提前加载活动文件并完成旧 readingProgress 迁移。服务启动时应在任何
// PrefsStore 写入之前调用，避免旧偏好首次保存时先丢弃尚未迁移的字段。
func (s *ActivityStore) Load() error {
	return s.ensureLoaded()
}

// Get 按精确标识查询单条活动。
func (s *ActivityStore) Get(identity models.ActivityIdentity) (models.Activity, bool, error) {
	key, ok := identity.Key()
	if !ok {
		return models.Activity{}, false, errors.New("invalid activity identity")
	}
	if err := s.ensureLoaded(); err != nil {
		return models.Activity{}, false, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	activity, exists := s.items[key]
	return activity, exists, nil
}

// Query 按请求顺序返回已存在的精确活动，缺失项不占位。
func (s *ActivityStore) Query(identities []models.ActivityIdentity) ([]models.Activity, error) {
	if len(identities) == 0 {
		return []models.Activity{}, nil
	}
	keys := make([]string, len(identities))
	for i, identity := range identities {
		key, ok := identity.Key()
		if !ok {
			return nil, errors.New("invalid activity identity")
		}
		keys[i] = key
	}
	if err := s.ensureLoaded(); err != nil {
		return nil, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]models.Activity, 0, len(keys))
	seen := make(map[string]struct{}, len(keys))
	for _, key := range keys {
		if _, duplicate := seen[key]; duplicate {
			continue
		}
		seen[key] = struct{}{}
		if activity, exists := s.items[key]; exists {
			out = append(out, activity)
		}
	}
	return out, nil
}

// Set 新增或覆盖单条活动。
func (s *ActivityStore) Set(activity models.Activity) error {
	return s.SetBatch([]models.Activity{activity})
}

// SetBatch 先校验整批数据，再仅执行一次原子落盘。
func (s *ActivityStore) SetBatch(activities []models.Activity) error {
	if len(activities) == 0 {
		return nil
	}
	normalized := make([]models.Activity, len(activities))
	for i, activity := range activities {
		item, err := models.NormalizeActivity(activity)
		if err != nil {
			return err
		}
		if item.Updated.IsZero() {
			item.Updated = time.Now().UTC()
		}
		normalized[i] = item
	}
	if err := s.ensureLoaded(); err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	next := cloneActivityMap(s.items)
	for _, activity := range normalized {
		key, _ := activity.Identity().Key()
		if current, exists := next[key]; exists && current.Updated.After(activity.Updated) {
			continue
		}
		next[key] = activity
	}
	return s.commitLocked(next)
}

// Delete 删除单条活动，不存在时保持幂等。
func (s *ActivityStore) Delete(identity models.ActivityIdentity) (bool, error) {
	key, ok := identity.Key()
	if !ok {
		return false, errors.New("invalid activity identity")
	}
	if err := s.ensureLoaded(); err != nil {
		return false, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, exists := s.items[key]; !exists {
		return false, nil
	}
	next := cloneActivityMap(s.items)
	delete(next, key)
	if err := s.commitLocked(next); err != nil {
		return false, err
	}
	return true, nil
}

// Clear 清空所有图片与视频活动。
func (s *ActivityStore) Clear() (int, error) {
	if err := s.ensureLoaded(); err != nil {
		return 0, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	count := len(s.items)
	if count == 0 {
		return 0, nil
	}
	if err := s.commitLocked(map[string]models.Activity{}); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *ActivityStore) ensureLoaded() error {
	s.mu.RLock()
	if s.loaded {
		s.mu.RUnlock()
		return nil
	}
	s.mu.RUnlock()

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.loaded {
		return nil
	}
	return s.loadLocked()
}

func (s *ActivityStore) loadLocked() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if !errors.Is(err, os.ErrNotExist) {
			return err
		}
		s.items = s.loadLegacyActivities()
		if len(s.items) == 0 {
			s.loaded = true
			return nil
		}
		return s.commitLocked(s.items)
	}
	var disk activityFile
	if err := json.Unmarshal(data, &disk); err != nil {
		now := time.Now()
		stamp := now.Format("20060102150405") + "-" + fmt.Sprintf("%d", now.UnixNano()%1_000_000)
		if renameErr := os.Rename(s.path, s.path+".corrupt."+stamp); renameErr != nil {
			return fmt.Errorf("backup corrupt activity store: %w", renameErr)
		}
		s.items = map[string]models.Activity{}
		s.loaded = true
		return nil
	}
	if disk.Version != activityFileVersion {
		return fmt.Errorf("unsupported activity store version %d", disk.Version)
	}
	s.items = make(map[string]models.Activity, len(disk.Activities))
	for _, activity := range disk.Activities {
		normalized, normalizeErr := models.NormalizeActivity(activity)
		if normalizeErr != nil {
			continue
		}
		key, _ := normalized.Identity().Key()
		if current, exists := s.items[key]; !exists || normalized.Updated.After(current.Updated) {
			s.items[key] = normalized
		}
	}
	s.loaded = true
	return nil
}

// loadLegacyActivities 只识别旧偏好文件中以 albumId 存储的有效记录。
// path 形式的历史数据可能含绝对路径，严禁迁移或暴露。
func (s *ActivityStore) loadLegacyActivities() map[string]models.Activity {
	out := map[string]models.Activity{}
	if s.legacyPrefsPath == "" {
		return out
	}
	data, err := os.ReadFile(s.legacyPrefsPath)
	if err != nil {
		return out
	}
	var legacy struct {
		ReadingProgress []struct {
			AlbumID string    `json:"albumId"`
			Index   int       `json:"index"`
			Total   int       `json:"total"`
			Updated time.Time `json:"updated"`
		} `json:"readingProgress"`
	}
	if json.Unmarshal(data, &legacy) != nil {
		return out
	}
	for _, old := range legacy.ReadingProgress {
		if !models.IsAlbumID(old.AlbumID) || old.Total <= 0 || old.Index < 0 {
			continue
		}
		index := min(old.Index, old.Total-1)
		activity, err := models.NormalizeActivity(models.Activity{
			AlbumID:   old.AlbumID,
			MediaKind: models.MediaKindImage,
			PageIndex: index,
			PageCount: old.Total,
			Updated:   old.Updated,
		})
		if err != nil {
			continue
		}
		if activity.Updated.IsZero() {
			activity.Updated = time.Now().UTC()
		}
		key, _ := activity.Identity().Key()
		if current, exists := out[key]; !exists || activity.Updated.After(current.Updated) {
			out[key] = activity
		}
	}
	return out
}

func (s *ActivityStore) commitLocked(items map[string]models.Activity) error {
	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	activities := make([]models.Activity, 0, len(items))
	for _, activity := range items {
		activities = append(activities, activity)
	}
	sort.Slice(activities, func(i, j int) bool {
		if activities[i].Updated.Equal(activities[j].Updated) {
			left, _ := activities[i].Identity().Key()
			right, _ := activities[j].Identity().Key()
			return left < right
		}
		return activities[i].Updated.After(activities[j].Updated)
	})
	data, err := json.MarshalIndent(activityFile{Version: activityFileVersion, Activities: activities}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	f, err := os.OpenFile(tmp, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Sync(); err != nil {
		_ = f.Close()
		_ = os.Remove(tmp)
		return err
	}
	if err := f.Close(); err != nil {
		_ = os.Remove(tmp)
		return err
	}
	if err := os.Rename(tmp, s.path); err != nil {
		_ = os.Remove(tmp)
		return fmt.Errorf("replace activity store: %w", err)
	}
	s.items = items
	s.loaded = true
	return nil
}

func cloneActivityMap(source map[string]models.Activity) map[string]models.Activity {
	out := make(map[string]models.Activity, len(source))
	for key, activity := range source {
		out[key] = activity
	}
	return out
}
