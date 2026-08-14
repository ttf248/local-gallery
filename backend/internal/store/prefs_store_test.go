package store

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/comic-reader/internal/models"
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

	if _, err := s.AddFavorite("/a/b"); err != nil {
		t.Fatal(err)
	}

	// 重新打开同一文件
	s2 := NewPrefsStore(path)
	p, err := s2.Get()
	if err != nil {
		t.Fatal(err)
	}
	if len(p.Favorites) != 1 || p.Favorites[0] != "/a/b" {
		t.Errorf("favorites not persisted: %+v", p.Favorites)
	}
}

func TestPrefsStore_AddFavoriteIdempotent(t *testing.T) {
	s := tempStore(t)
	s.AddFavorite("/x")
	s.AddFavorite("/x")
	p, _ := s.Get()
	if len(p.Favorites) != 1 {
		t.Errorf("expected 1 favorite, got %d", len(p.Favorites))
	}
}

func TestPrefsStore_RemoveFavorite(t *testing.T) {
	s := tempStore(t)
	s.AddFavorite("/a")
	s.AddFavorite("/b")
	out, _ := s.RemoveFavorite("/a")
	if len(out) != 1 || out[0] != "/b" {
		t.Errorf("remove failed: %v", out)
	}
}

func TestPrefsStore_PruneInvalidFavorites(t *testing.T) {
	s := tempStore(t)
	dir := t.TempDir()
	existing := filepath.Join(dir, "exists")
	os.MkdirAll(existing, 0o755)

	s.AddFavorite(existing)
	s.AddFavorite(filepath.Join(dir, "missing"))

	removed, err := s.PruneInvalidFavorites()
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
	s.AddHistory(models.HistoryEntry{Path: "/a", Name: "A", OpenedAt: now})
	s.AddHistory(models.HistoryEntry{Path: "/b", Name: "B", OpenedAt: now.Add(time.Second)})
	s.AddHistory(models.HistoryEntry{Path: "/c", Name: "C", OpenedAt: now.Add(2 * time.Second)})
	s.AddHistory(models.HistoryEntry{Path: "/d", Name: "D", OpenedAt: now.Add(3 * time.Second)})

	p, _ := s.Get()
	if len(p.History) != 3 {
		t.Fatalf("expected 3 history entries (max), got %d", len(p.History))
	}
	// 最新优先
	if p.History[0].Path != "/d" {
		t.Errorf("expected /d first, got %s", p.History[0].Path)
	}
	if p.History[2].Path != "/b" {
		t.Errorf("expected /b last (oldest kept), got %s", p.History[2].Path)
	}
}

func TestPrefsStore_AddHistoryDedup(t *testing.T) {
	s := tempStore(t)
	s.AddHistory(models.HistoryEntry{Path: "/a", OpenedAt: time.Now()})
	s.AddHistory(models.HistoryEntry{Path: "/b", OpenedAt: time.Now()})
	s.AddHistory(models.HistoryEntry{Path: "/a", OpenedAt: time.Now().Add(time.Minute)})

	p, _ := s.Get()
	if len(p.History) != 2 {
		t.Errorf("expected dedup to 2 entries, got %d", len(p.History))
	}
	// /a 应该是最新的
	if p.History[0].Path != "/a" {
		t.Errorf("expected /a first, got %s", p.History[0].Path)
	}
}

func TestPrefsStore_ClearHistory(t *testing.T) {
	s := tempStore(t)
	s.AddHistory(models.HistoryEntry{Path: "/a", OpenedAt: time.Now()})
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
	s.AddFavorite("/x")

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

func contains(s, substr string) bool {
	for i := 0; i+len(substr) <= len(s); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}
