package services

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
)

func TestComicLocalMeta(t *testing.T) {
	dir := t.TempDir()
	_, v := middleware.PathSafetyMiddleware([]string{dir})
	file := filepath.Join(dir, "ComicInfo.xml")
	for _, tc := range []struct{ data, title string }{{"<ComicInfo><Series>新书</Series><Summary>大纲</Summary></ComicInfo>", "新书"}, {"<ComicInfo>", ""}, {strings.Repeat("x", 65537), ""}} {
		if err := os.WriteFile(file, []byte(tc.data), 0600); err != nil {
			t.Fatal(err)
		}
		if m := readComicLocalMeta(dir, true, v.Validate); m.Title != tc.title {
			t.Errorf("%+v", m)
		}
	}
	if err := os.Remove(file); err != nil {
		t.Fatal(err)
	}
	other := filepath.Join(t.TempDir(), "info.json")
	if err := os.WriteFile(other, []byte(`{"title":"目录外"}`), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(other, filepath.Join(dir, "series.json")); err == nil && readComicLocalMeta(dir, true, v.Validate).Title != "" {
		t.Error("读取了链接")
	}
}
