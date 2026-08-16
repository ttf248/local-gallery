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
