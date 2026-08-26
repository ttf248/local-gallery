package store

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func tempStore(t *testing.T) *PrefsStore {
	t.Helper()
	return NewPrefsStore(filepath.Join(t.TempDir(), "prefs.json"))
}

func TestPrefsStore_GetDefaultsWhenMissing(t *testing.T) {
	s := tempStore(t)
	p, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if p.MaxRecent != 10 || p.Theme != "system" {
		t.Errorf("defaults wrong: %+v", p)
	}
	if len(p.Favorites) != 0 || len(p.History) != 0 {
		t.Error("favorites/history should be empty")
	}
}

func TestPrefsStore_Persistence(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	s := NewPrefsStore(path)

	id := testAlbumID(1)
	if _, err := s.AddFavorite(id); err != nil {
		t.Fatal(err)
	}

	// 重新打开同一文件
	s2 := NewPrefsStore(path)
	p, err := s2.Get()
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Favorites) != 1 || p.Favorites[0] != id {
		t.Errorf("favorites not persisted: %+v", p.Favorites)
	}
}

func TestPrefsStore_AddFavoriteIdempotent(t *testing.T) {
	s := tempStore(t)
	s.AddFavorite(testAlbumID(1))
	s.AddFavorite(testAlbumID(1))
	p, _ := s.Get()
	if len(p.Favorites) != 1 {
		t.Errorf("expected 1 favorite, got %d", len(p.Favorites))
	}
}

func TestPrefsStore_RemoveFavorite(t *testing.T) {
	s := tempStore(t)
	s.AddFavorite(testAlbumID(1))
	s.AddFavorite(testAlbumID(2))
	out, _ := s.RemoveFavorite(testAlbumID(1))
	if len(out) != 1 || out[0] != testAlbumID(2) {
		t.Errorf("remove failed: %v", out)
	}
}

func TestPrefsStore_PruneInvalidFavorites(t *testing.T) {
	s := tempStore(t)
	existing := testAlbumID(1)
	missing := testAlbumID(2)
	s.AddFavorite(existing)
	s.AddFavorite(missing)

	removed, err := s.PruneInvalidFavorites(func(id string) bool { return id == existing })
	if err != nil {
		t.Fatal(err)
	}
	if len(removed) != 1 {
		t.Errorf("expected 1 removed, got %d", len(removed))
	}
	p, _ := s.Get()
	if len(p.Favorites) != 1 || p.Favorites[0] != existing {
		t.Errorf("expected only existing favorite, got %v", p.Favorites)
	}
}

func TestPrefsStore_AddHistoryLRU(t *testing.T) {
	s := tempStore(t)
	// 限制为 3 条
	cur, _ := s.Get()
	cur.MaxRecent = 3
	s.Update(cur)

	now := time.Now()
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(1), Name: "A", OpenedAt: now})
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(2), Name: "B", OpenedAt: now.Add(time.Second)})
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(3), Name: "C", OpenedAt: now.Add(2 * time.Second)})
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(4), Name: "D", OpenedAt: now.Add(3 * time.Second)})

	p, _ := s.Get()
	if len(p.History) != 3 {
		t.Fatalf("expected 3 history entries (max), got %d", len(p.History))
	}
	// 最新优先
	if p.History[0].AlbumID != testAlbumID(4) {
		t.Errorf("expected newest first, got %s", p.History[0].AlbumID)
	}
	if p.History[2].AlbumID != testAlbumID(2) {
		t.Errorf("expected oldest retained item last, got %s", p.History[2].AlbumID)
	}
}

func TestPrefsStore_AddHistoryDedup(t *testing.T) {
	s := tempStore(t)
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(1), OpenedAt: time.Now()})
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(2), OpenedAt: time.Now()})
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(1), OpenedAt: time.Now().Add(time.Minute)})

	p, _ := s.Get()
	if len(p.History) != 2 {
		t.Errorf("expected dedup to 2 entries, got %d", len(p.History))
	}
	// /a 应该是最新的
	if p.History[0].AlbumID != testAlbumID(1) {
		t.Errorf("expected latest duplicate first, got %s", p.History[0].AlbumID)
	}
}

func TestPrefsStore_ClearHistory(t *testing.T) {
	s := tempStore(t)
	s.AddHistory(models.HistoryEntry{AlbumID: testAlbumID(1), OpenedAt: time.Now()})
	if err := s.ClearHistory(); err != nil {
		t.Fatal(err)
	}
	p, _ := s.Get()
	if len(p.History) != 0 {
		t.Errorf("expected empty history, got %d", len(p.History))
	}
}

func TestPrefsStore_CorruptFileRecovers(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	os.WriteFile(path, []byte("{not json"), 0o644)

	s := NewPrefsStore(path)
	p, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if p.MaxRecent != 10 {
		t.Errorf("corrupt file should fall back to defaults, got %+v", p)
	}

	// 损坏文件应被备份
	entries, _ := os.ReadDir(filepath.Dir(path))
	foundBackup := false
	for _, e := range entries {
		if filepath.Ext(e.Name()) != "" && contains(e.Name(), ".corrupt.") {
			foundBackup = true
			break
		}
	}
	if !foundBackup {
		t.Error("expected corrupt backup file")
	}
}

func TestPrefsStore_AtomicWrite(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	s := NewPrefsStore(path)
	s.AddFavorite(testAlbumID(1))

	// 验证文件可被 JSON 解析
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var p models.Prefs
	if err := json.Unmarshal(data, &p); err != nil {
		t.Fatal(err)
	}
	if len(p.Favorites) != 1 {
		t.Errorf("persisted favorites: %v", p.Favorites)
	}
}

func TestPrefsStore_UpdatePartial(t *testing.T) {
	s := tempStore(t)
	cur, _ := s.Get()
	cur.Theme = "dark"
	s.Update(cur)

	// 通过 Update 全量替换
	cur2, _ := s.Get()
	cur2.AutoSwitchAlbum = false
	s.Update(cur2)

	p, _ := s.Get()
	if p.Theme != "dark" {
		t.Errorf("theme should be dark, got %s", p.Theme)
	}
	if p.AutoSwitchAlbum != false {
		t.Error("autoSwitch should be false")
	}
}

func TestPrefsStore_AddFavoriteCappedAtMaxFavorites(t *testing.T) {
	s := tempStore(t)
	// 加入 600 条，超过 500 软上限
	for i := 0; i < 600; i++ {
		s.AddFavorite(testAlbumID(i))
	}
	p, _ := s.Get()
	if len(p.Favorites) != 500 {
		t.Fatalf("expected 500 favorites after cap, got %d", len(p.Favorites))
	}
	// 最旧的前 100 条应该被丢弃，最新的 500 条应保留
	if p.Favorites[0] != testAlbumID(100) || p.Favorites[len(p.Favorites)-1] != testAlbumID(599) {
		t.Errorf("oldest/newest not as expected: first=%s last=%s",
			p.Favorites[0], p.Favorites[len(p.Favorites)-1])
	}
}

func TestPrefsStore_ReadingProgressBatch(t *testing.T) {
	s := tempStore(t)
	for i := 0; i < 5; i++ {
		if err := s.SetReadingProgress(models.ReadingProgress{
			AlbumID: testAlbumID(i), Index: i, Total: 10, Updated: time.Now(),
		}); err != nil {
			t.Fatal(err)
		}
	}

	// 请求 3 个存在的 + 2 个不存在的
	got, err := s.GetReadingProgressBatch([]string{
		testAlbumID(1), testAlbumID(3), testAlbumID(999), testAlbumID(0), testAlbumID(404),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 entries, got %d", len(got))
	}
	if got[testAlbumID(1)].Index != 1 || got[testAlbumID(3)].Index != 3 || got[testAlbumID(0)].Index != 0 {
		t.Errorf("wrong index in batch result: %+v", got)
	}
	if _, ok := got[testAlbumID(999)]; ok {
		t.Error("non-existent path should not be in result")
	}

	// 空入参返回空 map
	if m, err := s.GetReadingProgressBatch(nil); err != nil || len(m) != 0 {
		t.Error("empty paths should return empty map")
	}
}

func TestPrefsStore_ReadingProgressBatchLoadsBeforeFirstRead(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	id := testAlbumID(7)
	writer := NewPrefsStore(path)
	if err := writer.SetReadingProgress(models.ReadingProgress{
		AlbumID: id,
		Index:   4,
		Total:   10,
		Updated: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}

	reader := NewPrefsStore(path)
	got, err := reader.GetReadingProgressBatch([]string{id})
	if err != nil {
		t.Fatal(err)
	}
	if got[id].Index != 4 {
		t.Fatalf("first batch read did not load disk state: %+v", got)
	}
}

func TestPrefsStore_SetReadingProgressBatchIsAtomicAndUnbounded(t *testing.T) {
	s := tempStore(t)
	entries := make([]models.ReadingProgress, 120)
	for i := range entries {
		entries[i] = models.ReadingProgress{
			AlbumID: testAlbumID(i),
			Index:   i,
			Total:   200,
			Updated: time.Now(),
		}
	}
	if err := s.SetReadingProgressBatch(entries); err != nil {
		t.Fatal(err)
	}
	prefs, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if len(prefs.ReadingProgress) != len(entries) {
		t.Fatalf("progress was truncated: got %d, want %d", len(prefs.ReadingProgress), len(entries))
	}

	invalid := append([]models.ReadingProgress(nil), entries[:2]...)
	invalid[1].AlbumID = `C:\\Users\\reader\\secret`
	if err := s.SetReadingProgressBatch(invalid); err == nil {
		t.Fatal("invalid batch was accepted")
	}
	after, _ := s.Get()
	if len(after.ReadingProgress) != len(entries) || after.ReadingProgress[0].Index != entries[0].Index {
		t.Fatal("invalid batch partially changed preferences")
	}
}

func TestPrefsStore_GetReturnsDeepCopyAndDropsLegacyPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "prefs.json")
	legacy := `{
  "favorites": ["C:\\\\Users\\\\reader\\\\secret", "a_0000000000000000000001"],
  "history": [{"path": "C:\\\\secret", "name": "legacy"}],
  "readingProgress": [{"path": "C:\\\\secret", "index": 1, "total": 2}],
  "maxRecent": 10,
  "theme": "system"
}`
	if err := os.WriteFile(path, []byte(legacy), 0o644); err != nil {
		t.Fatal(err)
	}
	s := NewPrefsStore(path)
	prefs, err := s.Get()
	if err != nil {
		t.Fatal(err)
	}
	if len(prefs.Favorites) != 1 || len(prefs.History) != 0 || len(prefs.ReadingProgress) != 0 {
		t.Fatalf("legacy paths were not filtered: %+v", prefs)
	}
	prefs.Favorites[0] = testAlbumID(99)
	again, _ := s.Get()
	if again.Favorites[0] != testAlbumID(1) {
		t.Fatal("Get returned mutable store backing data")
	}
}

func TestPrefsStore_DeleteReadingProgress(t *testing.T) {
	s := tempStore(t)
	// 准备 3 条
	for i := 0; i < 3; i++ {
		if err := s.SetReadingProgress(models.ReadingProgress{
			AlbumID: testAlbumID(i), Index: i, Total: 10, Updated: time.Now(),
		}); err != nil {
			t.Fatal(err)
		}
	}

	// 删除中间那条
	removed, err := s.DeleteReadingProgress(testAlbumID(1))
	if err != nil {
		t.Fatal(err)
	}
	if !removed {
		t.Error("expected removed=true for existing path")
	}

	// 校验只剩 2 条，且 1 确实没了
	all, err := s.GetReadingProgressBatch([]string{testAlbumID(0), testAlbumID(1), testAlbumID(2)})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 2 {
		t.Fatalf("expected 2 entries after delete, got %d", len(all))
	}
	if _, ok := all[testAlbumID(1)]; ok {
		t.Error("/p/1 should be deleted")
	}
	if all[testAlbumID(0)].Index != 0 || all[testAlbumID(2)].Index != 2 {
		t.Errorf("other entries corrupted: %+v", all)
	}

	// 幂等：删第二次返回 false，但不出错
	removed, err = s.DeleteReadingProgress(testAlbumID(1))
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Error("second delete should be idempotent (removed=false)")
	}

	// 删不存在的 path 也是幂等
	removed, err = s.DeleteReadingProgress(testAlbumID(999))
	if err != nil {
		t.Fatal(err)
	}
	if removed {
		t.Error("deleting never-existed path should be removed=false")
	}
}

func TestPrefsStore_ClearAllReadingProgress(t *testing.T) {
	s := tempStore(t)
	// 空 store：清空返回 0
	n, err := s.ClearAllReadingProgress()
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("empty clear should return 0, got %d", n)
	}

	// 准备 4 条
	for i := 0; i < 4; i++ {
		if err := s.SetReadingProgress(models.ReadingProgress{
			AlbumID: testAlbumID(i), Index: i, Total: 10, Updated: time.Now(),
		}); err != nil {
			t.Fatal(err)
		}
	}

	// 清空
	n, err = s.ClearAllReadingProgress()
	if err != nil {
		t.Fatal(err)
	}
	if n != 4 {
		t.Errorf("expected 4 removed, got %d", n)
	}

	// 再清空应该返回 0
	n, err = s.ClearAllReadingProgress()
	if err != nil {
		t.Fatal(err)
	}
	if n != 0 {
		t.Errorf("second clear should return 0, got %d", n)
	}

	// 校验 GetReadingProgressBatch 也空了
	all, err := s.GetReadingProgressBatch([]string{
		testAlbumID(0), testAlbumID(1), testAlbumID(2), testAlbumID(3),
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(all) != 0 {
		t.Errorf("expected 0 after clear, got %d", len(all))
	}
}

func testAlbumID(n int) string {
	return fmt.Sprintf("a_%022d", n)
}

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
