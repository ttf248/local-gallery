package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func writeValidYAML(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	// 准备一个真实存在的 mediaRoot（避免 Validate 失败）
	root := filepath.Join(dir, "media")
	if err := os.MkdirAll(root, 0o755); err != nil {
		t.Fatal(err)
	}
	// 用 filepath.Join 替换占位符，使 root 一定存在
	content = "mediaRoot: \"" + filepath.ToSlash(root) + "\"\n" + content
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestNewManager_LoadFromFile(t *testing.T) {
	path := writeValidYAML(t, "port: 9999\n")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	cfg := mgr.Get()
	if cfg.Port != 9999 {
		t.Errorf("port=%d want 9999", cfg.Port)
	}
	if mgr.Path() != path {
		t.Errorf("path=%q want %q", mgr.Path(), path)
	}
}

func TestManager_Update_Persists(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}

	restart, err := mgr.Update(ConfigPatch{
		Port:        8888,
		PortSet:     true,
		AllowOsOpen: true,
		AllowOsOpenSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(restart) != 1 || restart[0] != "port" {
		t.Errorf("requiresRestart=%v want [port]", restart)
	}

	cfg := mgr.Get()
	if cfg.Port != 8888 {
		t.Errorf("port=%d", cfg.Port)
	}
	if !cfg.AllowOsOpen {
		t.Errorf("allowOsOpen should be true")
	}

	// 文件应已落盘
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !contains(data, "port: 8888") {
		t.Errorf("file should contain port: 8888, got: %s", data)
	}
	if !contains(data, "allowOsOpen: true") {
		t.Errorf("file should contain allowOsOpen: true, got: %s", data)
	}
}

func TestManager_Update_AllowOsOpenFalse(t *testing.T) {
	path := writeValidYAML(t, "allowOsOpen: true\n")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	if !mgr.Get().AllowOsOpen {
		t.Fatal("setup: should be true")
	}

	_, err = mgr.Update(ConfigPatch{
		AllowOsOpen:    false,
		AllowOsOpenSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if mgr.Get().AllowOsOpen {
		t.Error("allowOsOpen should be false after explicit PATCH false")
	}
}

func TestManager_Update_RejectsInvalid(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	// 把 Port 改成非法值
	_, err = mgr.Update(ConfigPatch{
		Port:    70000,
		PortSet: true,
	})
	if err == nil {
		t.Error("expected validation error")
	}
	// 内存应未变
	if mgr.Get().Port == 70000 {
		t.Error("port should not be applied on validation failure")
	}
}

func TestManager_Update_MediaRootClearsLegacy(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	mgr.mu.Lock()
	mgr.current.LegacyComicRoot = "D:\\old"
	mgr.mu.Unlock()

	newRoot := filepath.Join(t.TempDir(), "new")
	if err := os.MkdirAll(newRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	_, err = mgr.Update(ConfigPatch{
		MediaRoots:    []string{newRoot},
		MediaRootsSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	cfg := mgr.Get()
	if cfg.MediaRoot != newRoot {
		t.Errorf("mediaRoot=%q want %q", cfg.MediaRoot, newRoot)
	}
	if cfg.LegacyComicRoot != "" {
		t.Errorf("LegacyComicRoot should be cleared, got %q", cfg.LegacyComicRoot)
	}
}

// 多根 PATCH：传入数组应整体替换，LegacyComicRoot 清空。
func TestManager_Update_MediaRootsMulti(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	root1 := filepath.Join(t.TempDir(), "r1")
	root2 := filepath.Join(t.TempDir(), "r2")
	for _, r := range []string{root1, root2} {
		if err := os.MkdirAll(r, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	_, err = mgr.Update(ConfigPatch{
		MediaRoots:    []string{root1, root2},
		MediaRootsSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	roots := mgr.Roots()
	if len(roots) != 2 {
		t.Fatalf("expected 2 roots, got %d (%v)", len(roots), roots)
	}
	if roots[0] != root1 || roots[1] != root2 {
		t.Errorf("roots order: %v", roots)
	}
	if mgr.Get().LegacyComicRoot != "" {
		t.Errorf("legacy should be cleared")
	}
}

func TestManager_Update_NotifiesSubscribers(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	var (
		mu      sync.Mutex
		calls   int
		lastCfg *Config
	)
	_ = mgr.OnChange("test", func(s *Config) {
		mu.Lock()
		defer mu.Unlock()
		calls++
		lastCfg = s
	})

	_, err = mgr.Update(ConfigPatch{
		ThumbSizeW:    200,
		ThumbSizeWSet: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	mu.Lock()
	defer mu.Unlock()
	if calls != 1 {
		t.Errorf("calls=%d want 1", calls)
	}
	if lastCfg == nil || lastCfg.ThumbSizeW != 200 {
		t.Errorf("lastCfg.ThumbSizeW=%v", lastCfg)
	}
}

func TestManager_Update_Unsubscribe(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, err := NewManager(path)
	if err != nil {
		t.Fatal(err)
	}
	calls := 0
	cancel := mgr.OnChange("u", func(s *Config) { calls++ })
	cancel()

	if _, err := mgr.Update(ConfigPatch{Port: 7777, PortSet: true}); err != nil {
		t.Fatal(err)
	}
	if calls != 0 {
		t.Errorf("calls=%d want 0 after unsubscribe", calls)
	}
}

func TestManager_GetReturnsCopy(t *testing.T) {
	path := writeValidYAML(t, "")
	mgr, _ := NewManager(path)
	a := mgr.Get()
	a.Port = 1234
	b := mgr.Get()
	if b.Port == 1234 {
		t.Error("Get() should return a copy")
	}
}

func TestConfigPatch_UnmarshalJSON(t *testing.T) {
	// 显式 false
	var p ConfigPatch
	if err := json.Unmarshal([]byte(`{"allowOsOpen":false}`), &p); err != nil {
		t.Fatal(err)
	}
	if !p.AllowOsOpenSet {
		t.Error("AllowOsOpenSet should be true")
	}
	if p.AllowOsOpen {
		t.Error("AllowOsOpen should be false")
	}

	// 完全不提供
	p = ConfigPatch{}
	if err := json.Unmarshal([]byte(`{"port":1234}`), &p); err != nil {
		t.Fatal(err)
	}
	if p.AllowOsOpenSet {
		t.Error("AllowOsOpenSet should be false when field not in JSON")
	}
	if !p.PortSet || p.Port != 1234 {
		t.Error("port not picked up")
	}
}

func contains(haystack []byte, needle string) bool {
	return len(haystack) == 0 && needle == "" ||
		(len(haystack) >= len(needle) && indexOf(haystack, needle) >= 0)
}

func indexOf(b []byte, s string) int {
	n := len(s)
	for i := 0; i+n <= len(b); i++ {
		if string(b[i:i+n]) == s {
			return i
		}
	}
	return -1
}
