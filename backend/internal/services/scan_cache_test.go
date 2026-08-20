package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

func TestScanResultCache_AsyncFlushDebounce(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)

	r := &models.ScanResult{Root: "x", ScannedAt: time.Now(), AlbumCount: 1}

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
	r := &models.ScanResult{Root: "y", ScannedAt: time.Now(), AlbumCount: 42}
	c.Set(r)
	// 强制立即落盘，避免依赖 timer
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	// 重新打开
	c2 := NewScanResultCache(path)
	if err := c2.Load(); err != nil {
		t.Fatalf("Load: %v", err)
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
		Root:      root,
		Roots:     []string{root},
		ScannedAt: time.Now(),
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
		Root:      oldRoot,
		Roots:     []string{oldRoot},
		ScannedAt: time.Now(),
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

// currentRoots 为 nil → 跳过校验，按原样加载（向后兼容）
func TestScanResultCache_LoadWithRoots_NilRootsSkip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "scan_cache.json")
	c := NewScanResultCache(path)
	root := t.TempDir()
	c.Set(&models.ScanResult{Root: root, Roots: []string{root}, AlbumCount: 3})
	if err := c.Flush(); err != nil {
		t.Fatalf("Flush: %v", err)
	}

	c2 := NewScanResultCache(path)
	mismatch, err := c2.LoadWithRoots(nil)
	if err != nil {
		t.Fatalf("LoadWithRoots: %v", err)
	}
	if mismatch {
		t.Fatal("expected nil roots to skip comparison")
	}
	if got := c2.Get(); got == nil || got.AlbumCount != 3 {
		t.Fatalf("expected cache to be loaded, got %+v", got)
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
