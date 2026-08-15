package models

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestIsImageFile(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		// 正例
		{"a.jpg", true},
		{"a.JPG", true},
		{"a.jpeg", true},
		{"a.png", true},
		{"a.PNG", true},
		{"a.gif", true},
		{"a.bmp", true},
		{"a.webp", true},
		{"a.tiff", true},
		{"a.tif", true},
		{"page-001.jpg", true},
		// 反例
		{"a.txt", false},
		{"a", false},
		{".jpg", false},
		{"", false},
		{"noext", false},
		{"a.tar.gz", false},
		{"a.mp4", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsImageFile(tc.name); got != tc.want {
				t.Errorf("IsImageFile(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestLowerExt(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"a.JPG", ".jpg"},
		{"page.Png", ".png"},
		{"no.ext.here", ".here"},
		{"noext", ""},
	}
	for _, tc := range cases {
		if got := lowerExt(tc.in); got != tc.want {
			t.Errorf("lowerExt(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// TestAlbumMarshalJSON_AliasKeys 验证 Album 同时输出 imageFiles+files、
// imageCount+fileCount 两组键，便于新旧客户端共存。
func TestAlbumMarshalJSON_AliasKeys(t *testing.T) {
	a := Album{
		Type:       "album",
		Path:       "E:/p/a",
		Name:       "a",
		ImageFiles: []string{"E:/p/a/1.jpg", "E:/p/a/2.jpg"},
		ImageCount: 2,
		ModTime:    time.Now(),
	}
	raw, err := json.Marshal(a)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(raw)
	for _, key := range []string{`"imageFiles"`, `"files"`, `"imageCount"`, `"fileCount"`} {
		if !strings.Contains(s, key) {
			t.Errorf("Album JSON 缺少键 %s：%s", key, s)
		}
	}
	// files 与 imageFiles 值应相同
	if !strings.Contains(s, `"E:/p/a/1.jpg"`) || !strings.Contains(s, `"E:/p/a/2.jpg"`) {
		t.Errorf("Album JSON 未正确输出文件列表：%s", s)
	}
}

// TestScanResultMarshalJSON_AliasKeys 验证 ScanResult 同时输出 albums+folders、
// albumCount+folderCount 两组键。
func TestScanResultMarshalJSON_AliasKeys(t *testing.T) {
	r := ScanResult{
		Root:            "E:/p",
		Albums:          []Album{{Type: "album", Path: "E:/p/a", Name: "a", ImageCount: 3}},
		AlbumCount:      1,
		CollectionCount: 0,
		ScannedAt:       time.Now(),
	}
	raw, err := json.Marshal(r)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	s := string(raw)
	for _, key := range []string{`"albums"`, `"folders"`, `"albumCount"`, `"folderCount"`} {
		if !strings.Contains(s, key) {
			t.Errorf("ScanResult JSON 缺少键 %s：%s", key, s)
		}
	}
}
