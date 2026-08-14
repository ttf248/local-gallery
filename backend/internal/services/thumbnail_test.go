package services

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// makeTestImage 生成指定尺寸的 RGBA 测试图片并保存为 JPEG。
func makeTestImage(t *testing.T, dir, name string, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	// 用简单渐变填充，避免空图被某些编码器压缩为 0 字节
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(x % 256), uint8(y % 256), 128, 255})
		}
	}
	path := filepath.Join(dir, name)
	f, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	if err := jpeg.Encode(f, img, &jpeg.Options{Quality: 85}); err != nil {
		t.Fatal(err)
	}
	return path
}

func newTestService(t *testing.T) *ThumbnailService {
	t.Helper()
	svc, err := NewThumbnailService(ThumbnailOptions{
		CacheDir:   t.TempDir(),
		Width:      320,
		Height:     350,
		MaxAgeDays: 30,
		LRUSize:    100,
	})
	if err != nil {
		t.Fatalf("NewThumbnailService: %v", err)
	}
	return svc
}

func TestCacheKey_StableAndUnique(t *testing.T) {
	now := time.Now()
	k1 := CacheKey("/a/b.jpg", now, 123)
	k2 := CacheKey("/a/b.jpg", now, 123)
	if k1 != k2 {
		t.Errorf("key should be stable, got %s vs %s", k1, k2)
	}
	if CacheKey("/a/b.jpg", now, 124) == k1 {
		t.Errorf("key should differ by size")
	}
	if CacheKey("/a/c.jpg", now, 123) == k1 {
		t.Errorf("key should differ by path")
	}
	if CacheKey("/a/b.jpg", now.Add(time.Second), 123) == k1 {
		t.Errorf("key should differ by mtime")
	}
}

func TestGetOrCreate_GeneratesAndCaches(t *testing.T) {
	svc := newTestService(t)
	src := makeTestImage(t, t.TempDir(), "test.jpg", 800, 600)

	// 第一次：生成
	data1, err := svc.GetOrCreate(src)
	if err != nil {
		t.Fatalf("first GetOrCreate: %v", err)
	}
	if len(data1) == 0 {
		t.Fatal("empty thumbnail data")
	}
	if !isPNG(data1) {
		t.Error("output should be valid PNG")
	}

	// 第二次：命中（内存或磁盘），返回相同数据
	data2, err := svc.GetOrCreate(src)
	if err != nil {
		t.Fatalf("second GetOrCreate: %v", err)
	}
	if !bytes.Equal(data1, data2) {
		t.Error("second call should return cached bytes")
	}

	// 磁盘文件存在
	entries, _ := os.ReadDir(svc.cacheDir)
	if len(entries) != 1 {
		t.Errorf("expected 1 disk file, got %d", len(entries))
	}

	// 解码验证尺寸
	img, err := png.Decode(bytes.NewReader(data1))
	if err != nil {
		t.Fatal(err)
	}
	if img.Bounds().Dx() > 320 || img.Bounds().Dy() > 350 {
		t.Errorf("thumbnail too large: %dx%d", img.Bounds().Dx(), img.Bounds().Dy())
	}
}

func TestGetOrCreate_MissingSource(t *testing.T) {
	svc := newTestService(t)
	_, err := svc.GetOrCreate(filepath.Join(t.TempDir(), "nope.jpg"))
	if err != ErrSourceMissing {
		t.Errorf("expected ErrSourceMissing, got %v", err)
	}
}

func TestGetOrCreate_UnsupportedFormat(t *testing.T) {
	svc := newTestService(t)
	// 写一个 .png 后缀但内容是文本
	path := filepath.Join(t.TempDir(), "fake.png")
	os.WriteFile(path, []byte("not an image"), 0o644)
	_, err := svc.GetOrCreate(path)
	if err == nil {
		t.Fatal("expected error for unsupported format")
	}
	if !strings.Contains(err.Error(), "unsupported") &&
		!strings.Contains(err.Error(), "format") {
		t.Errorf("expected format-related error, got: %v", err)
	}
}

func TestGetOrCreate_KeyChangesWithMtime(t *testing.T) {
	svc := newTestService(t)
	src := makeTestImage(t, t.TempDir(), "test.jpg", 400, 300)

	_, err := svc.GetOrCreate(src)
	if err != nil {
		t.Fatal(err)
	}

	// 修改 mtime（模拟文件被覆盖）
	future := time.Now().Add(time.Hour)
	os.Chtimes(src, future, future)

	_, err = svc.GetOrCreate(src)
	if err != nil {
		t.Fatal(err)
	}

	// 磁盘上应该有 2 个不同的缓存文件
	entries, _ := os.ReadDir(svc.cacheDir)
	if len(entries) != 2 {
		t.Errorf("expected 2 disk files after mtime change, got %d", len(entries))
	}
}

func TestCleanup_RemovesOldFiles(t *testing.T) {
	cacheDir := t.TempDir()
	svc, err := NewThumbnailService(ThumbnailOptions{
		CacheDir:   cacheDir,
		MaxAgeDays: 30,
	})
	if err != nil {
		t.Fatal(err)
	}

	// 写入一个"旧"文件
	oldFile := filepath.Join(cacheDir, "old.png")
	os.WriteFile(oldFile, []byte("x"), 0o644)
	past := time.Now().AddDate(0, 0, -60) // 60 天前
	os.Chtimes(oldFile, past, past)

	// 一个新的
	newFile := filepath.Join(cacheDir, "new.png")
	os.WriteFile(newFile, []byte("x"), 0o644)

	n, err := svc.Cleanup()
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("expected to delete 1 file, deleted %d", n)
	}
	if _, err := os.Stat(oldFile); !os.IsNotExist(err) {
		t.Error("old file should be removed")
	}
	if _, err := os.Stat(newFile); err != nil {
		t.Error("new file should remain")
	}
}

func TestStats(t *testing.T) {
	svc := newTestService(t)
	src := makeTestImage(t, t.TempDir(), "test.jpg", 400, 300)
	svc.GetOrCreate(src)

	stats := svc.Stats()
	if stats.MemoryItems < 1 {
		t.Errorf("expected memory items >= 1, got %d", stats.MemoryItems)
	}
	if stats.DiskFiles < 1 {
		t.Errorf("expected disk files >= 1, got %d", stats.DiskFiles)
	}
	if stats.CacheDir == "" {
		t.Error("CacheDir should be set")
	}
}

// isPNG 快速校验：PNG 头 8 字节为 89 50 4E 47 0D 0A 1A 0A。
func isPNG(data []byte) bool {
	return len(data) >= 8 && binary.BigEndian.Uint64(data[:8]) == 0x89504E470D0A1A0A
}
