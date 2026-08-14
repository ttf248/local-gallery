package services

import (
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

func TestGetImageInfo(t *testing.T) {
	dir := t.TempDir()
	p := filepath.Join(dir, "test.png")
	mustWritePNG(t, p, 100, 50, color.RGBA{255, 0, 0, 255})

	info, err := GetImageInfo(p)
	if err != nil {
		t.Fatalf("GetImageInfo: %v", err)
	}
	if info.Width != 100 || info.Height != 50 {
		t.Errorf("size = %dx%d, want 100x50", info.Width, info.Height)
	}
	if info.Format != "png" {
		t.Errorf("format = %q, want png", info.Format)
	}
	if info.Size <= 0 {
		t.Errorf("size = %d, want > 0", info.Size)
	}
	if info.Checksum == "" {
		t.Error("checksum empty")
	}
	if info.Name != "test.png" {
		t.Errorf("name = %q", info.Name)
	}
	if filepath.Base(info.Dir) != filepath.Base(dir) {
		t.Errorf("dir = %q", info.Dir)
	}
}

func TestGetImageInfo_NotFound(t *testing.T) {
	_, err := GetImageInfo(filepath.Join(t.TempDir(), "nope.png"))
	if err == nil {
		t.Fatal("want error for non-existent file")
	}
}

func TestGetImageInfo_Directory(t *testing.T) {
	dir := t.TempDir()
	_, err := GetImageInfo(dir)
	if err == nil {
		t.Fatal("want error for directory")
	}
}

func TestGetImageInfo_Garbage(t *testing.T) {
	p := filepath.Join(t.TempDir(), "bad.png")
	if err := os.WriteFile(p, []byte("not an image"), 0644); err != nil {
		t.Fatal(err)
	}
	_, err := GetImageInfo(p)
	if err == nil {
		t.Fatal("want decode error")
	}
}

func mustWritePNG(t *testing.T, p string, w, h int, c color.Color) {
	t.Helper()
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, c)
		}
	}
	if err := png.Encode(f, img); err != nil {
		t.Fatal(err)
	}
}