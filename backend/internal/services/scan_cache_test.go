package services

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func TestScanResultCache_AsyncFlushDebounce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)
	root := t.TempDir()
	r := &models.ScanResult{Root: root, Roots: []string{root}, ScannedAt: time.Now(), AlbumCount: 1}

	// 连写三次：debounce 应该只触发一次落盘
	for i := 0; i < 3; i++ {
		c.Set(r)
	}

	// 等待超过 debounce 窗口
	time.Sleep(flushDebounce + 200*time.Millisecond)

	// 文件应已存在
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("expected cache file to exist: %v", err)
	}

	// 读回应该 round-trip
	got := c.Get()
	if got == nil || got.AlbumCount != 1 {
		t.Fatalf("Get returned wrong result: %+v", got)
	}
}

func TestScanResultCache_LoadFromDisk(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)
	root := t.TempDir()
	r := &models.ScanResult{Root: root, Roots: []string{root}, ScannedAt: time.Now(), AlbumCount: 42}
	c.Set(r)
	// 强制立即落盘，避免依赖 timer
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	// 重新打开
	c2 := NewScanResultCache(path)
	if _, err := c2.LoadWithRoots([]string{root}); err != nil {
		t.Fatalf("LoadWithRoots: %v", err)
	}
	got := c2.Get()
	if got == nil || got.AlbumCount != 42 {
		t.Fatalf("loaded cache wrong: %+v", got)
	}
}

func TestScanResultCache_NoUnnecessaryWriteWhenClean(t *testing.T) {
	// 没 Set 过，flush 应该 no-op；磁盘文件不应被创建
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("Flush on empty cache should not create file")
	}
}

// 守护：flushDebounce 不应过大 / 过小
func TestScanResultCache_DebounceReasonable(t *testing.T) {
	if flushDebounce < 100*time.Millisecond || flushDebounce > 5*time.Second {
		t.Fatalf("flushDebounce out of range: %v", flushDebounce)
	}
}

// 缓存里的根目录与当前配置的根目录一致 → 正常加载
func TestScanResultCache_LoadWithRoots_Match(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	c := NewScanResultCache(path)
	r := &models.ScanResult{
		Root:       root,
		Roots:      []string{root},
		ScannedAt:  time.Now(),
		AlbumCount: 7,
	}
	c.Set(r)
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	c2 := NewScanResultCache(path)
	mismatch, err := c2.LoadWithRoots([]string{root})
	if err != nil {
		t.Fatalf("LoadWithRoots: %v", err)
	}
	if mismatch {
		t.Fatal("expected roots to match")
	}
	if got := c2.Get(); got == nil || got.AlbumCount != 7 {
		t.Fatalf("expected cache to be loaded, got %+v", got)
	}
}

// 缓存里的根目录与当前配置不一致 → 清空并报告 mismatch
func TestScanResultCache_LoadWithRoots_Mismatch(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	oldRoot := t.TempDir()
	newRoot := t.TempDir()

	c := NewScanResultCache(path)
	c.Set(&models.ScanResult{
		Root:       oldRoot,
		Roots:      []string{oldRoot},
		ScannedAt:  time.Now(),
		AlbumCount: 9,
	})
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	c2 := NewScanResultCache(path)
	mismatch, err := c2.LoadWithRoots([]string{newRoot})
	if err != nil {
		t.Fatalf("LoadWithRoots: %v", err)
	}
	if !mismatch {
		t.Fatal("expected rootsMismatch=true")
	}
	if got := c2.Get(); got != nil {
		t.Fatalf("expected cache to be cleared, got %+v", got)
	}
	// 磁盘文件应该被删除（下次启动按"无缓存"处理）
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatalf("expected cache file to be removed, stat err: %v", err)
	}
}

func TestScanResultCache_LoadWithRoots_RequiresRoots(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)
	root := t.TempDir()
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}, AlbumCount: 3})
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	c2 := NewScanResultCache(path)
	if _, err := c2.LoadWithRoots(nil); err == nil {
		t.Fatal("expected missing current roots to be rejected")
	}
	if got := c2.Get(); got != nil {
		t.Fatalf("cache should remain empty, got %+v", got)
	}
}

func TestScanResultCache_PersistsRelativeReferencesOnly(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	albumPath := filepath.Join(root, "private-album")
	filePath := filepath.Join(albumPath, "page.jpg")
	c := NewScanResultCache(path)
	c.Set(&models.ScanResult{
		Root:  root,
		Roots: []string{root},
		Albums: []models.Album{{
			Path:        albumPath,
			SourceRoot:  root,
			CoverImage:  filePath,
			ImageFiles:  []string{filePath},
			VideoFiles:  []string{},
			ImageCount:  1,
			DisplayName: "private-album",
		}},
	})
	if err := c.Flush(); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	escapedRoot, _ := json.Marshal(root)
	if strings.Contains(string(data), strings.Trim(string(escapedRoot), `"`)) {
		t.Fatalf("cache file leaked absolute root: %s", data)
	}
	if !strings.Contains(string(data), `"schemaVersion": 2`) {
		t.Fatalf("cache schema version missing: %s", data)
	}

	loaded := NewScanResultCache(path)
	if mismatch, err := loaded.LoadWithRoots([]string{root}); err != nil || mismatch {
		t.Fatalf("LoadWithRoots=(%v,%v)", mismatch, err)
	}
	got := loaded.Get()
	if got == nil || got.Albums[0].Path != albumPath || got.Albums[0].ImageFiles[0] != filePath {
		t.Fatalf("decoded cache mismatch: %+v", got)
	}
}

func TestScanResultCache_GetAndSetUseDeepCopies(t *testing.T) {
	root := t.TempDir()
	filePath := filepath.Join(root, "album", "page.jpg")
	original := &models.ScanResult{
		Root: root, Roots: []string{root},
		Albums: []models.Album{{Path: filepath.Dir(filePath), ImageFiles: []string{filePath}}},
	}
	c := NewScanResultCache(filepath.Join(t.TempDir(), "scan_cache.json"))
	c.Set(original)
	original.Albums[0].ImageFiles[0] = "mutated-before-get"
	first := c.Get()
	first.Albums[0].ImageFiles[0] = "mutated-after-get"
	second := c.Get()
	if second.Albums[0].ImageFiles[0] != filePath {
		t.Fatalf("cache was mutated through an external slice: %+v", second.Albums[0].ImageFiles)
	}
}

func TestScanResultCache_ClearRemovesPersistedSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	c := NewScanResultCache(path)
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}})
	if err := c.Flush(); err != nil {
		t.Fatal(err)
	}
	if err := c.Clear(); err != nil {
		t.Fatal(err)
	}
	if c.Get() != nil {
		t.Fatal("memory snapshot should be empty")
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("persisted snapshot should be removed: %v", err)
	}
}

func TestScanResultCache_FlushReplacesExistingSnapshot(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	c := NewScanResultCache(path)
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}, AlbumCount: 1})
	if err := c.Flush(); err != nil {
		t.Fatal(err)
	}
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}, AlbumCount: 2})
	if err := c.Flush(); err != nil {
		t.Fatal(err)
	}

	loaded := NewScanResultCache(path)
	if _, err := loaded.LoadWithRoots([]string{root}); err != nil {
		t.Fatal(err)
	}
	if got := loaded.Get(); got == nil || got.AlbumCount != 2 {
		t.Fatalf("latest snapshot was not persisted: %+v", got)
	}
}

func TestScanResultCache_ConcurrentSetGetFlush(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	c := NewScanResultCache(path)
	var wg sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		wg.Add(1)
		go func(offset int) {
			defer wg.Done()
			for i := 0; i < 25; i++ {
				c.Set(&models.ScanResult{
					Root: root, Roots: []string{root}, AlbumCount: offset*100 + i,
				})
				_ = c.Get()
				if err := c.Flush(); err != nil {
					t.Errorf("Flush: %v", err)
					return
				}
			}
		}(worker)
	}
	wg.Wait()
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}, AlbumCount: 999})
	if err := c.Flush(); err != nil {
		t.Fatal(err)
	}
	loaded := NewScanResultCache(path)
	if _, err := loaded.LoadWithRoots([]string{root}); err != nil {
		t.Fatal(err)
	}
	if got := loaded.Get(); got == nil || got.AlbumCount != 999 {
		t.Fatalf("final snapshot mismatch: %+v", got)
	}
}

func TestScanResultCache_InvalidatesLegacySchema(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	root := t.TempDir()
	legacy, err := json.Marshal(&models.ScanResult{Root: root, Roots: []string{root}})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, legacy, 0o600); err != nil {
		t.Fatal(err)
	}
	c := NewScanResultCache(path)
	mismatch, err := c.LoadWithRoots([]string{root})
	if err != nil || !mismatch {
		t.Fatalf("LoadWithRoots=(%v,%v), want legacy invalidation", mismatch, err)
	}
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy file should be removed: %v", err)
	}
}

// 多根集合顺序无关性：cache 是 [A,B]，current 是 [B,A] → 视为相同
func TestScanResultCache_LoadWithRoots_MultiRootsOrderInsensitive(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	a := t.TempDir()
	b := t.TempDir()
	c := NewScanResultCache(path)
	c.Set(&models.ScanResult{
		Root:       a,
		Roots:      []string{a, b},
		ScannedAt:  time.Now(),
		AlbumCount: 5,
	})
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	c2 := NewScanResultCache(path)
	mismatch, err := c2.LoadWithRoots([]string{b, a})
	if err != nil {
		t.Fatalf("LoadWithRoots: %v", err)
	}
	if mismatch {
		t.Fatal("expected roots to match regardless of order")
	}
	if got := c2.Get(); got == nil || got.AlbumCount != 5 {
		t.Fatalf("expected cache to be loaded, got %+v", got)
	}
}

// sameRootSet 工具函数的直接单元测试
func TestSameRootSet(t *testing.T) {
	cases := []struct {
		name string
		a, b []string
		want bool
	}{
		{"both empty", nil, nil, true},
		{"one empty", []string{"a"}, nil, false},
		{"same single", []string{"a"}, []string{"a"}, true},
		{"diff single", []string{"a"}, []string{"b"}, false},
		{"order independent", []string{"a", "b"}, []string{"b", "a"}, true},
		{"multi mismatch", []string{"a", "b"}, []string{"a", "c"}, false},
		{"trailing slash normalized", []string{filepath.Join("a", "")}, []string{"a"}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := sameRootSet(tc.a, tc.b); got != tc.want {
				t.Fatalf("sameRootSet(%v, %v) = %v, want %v", tc.a, tc.b, got, tc.want)
			}
		})
	}
}
