package handlers

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// TestVideoETagQuoted 验证 videoETag 派生出的 ETag 用双引号包裹。
//
// 背景：浏览器回传的 If-None-Match 一定带双引号，如果 server 发的 ETag
// 不带引号，string 永远不匹配，304 协商就废了。这是历史上与
// ThumbHandler 行为不一致的 bug；本测试守住「带引号」这条契约。
func TestVideoETagQuoted(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fake.mp4")
	if err := os.WriteFile(path, []byte("hello"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	etag := videoETag(info)
	if !strings.HasPrefix(etag, `"`) || !strings.HasSuffix(etag, `"`) {
		t.Fatalf("videoETag must be wrapped in double quotes, got %q", etag)
	}
	if etag == `""` {
		t.Fatalf("videoETag must not be empty quoted string, got %q", etag)
	}
}

// TestVideoETagStable 验证同文件两次调用结果一致（不同时钟漂移）。
func TestVideoETagStable(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "fake.mp4")
	if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	a := videoETag(info)
	b := videoETag(info)
	if a != b {
		t.Fatalf("videoETag not stable for same FileInfo: %q vs %q", a, b)
	}
}

// TestVideoETagChanges 验证 mtime / size 变化时 ETag 也变。
//
// 304 协商的核心就是「内容变了 ETag 必须变」，否则会发回陈旧字节。
func TestVideoETagChanges(t *testing.T) {
	dir := t.TempDir()
	a := filepath.Join(dir, "a.mp4")
	b := filepath.Join(dir, "b.mp4")
	if err := os.WriteFile(a, []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 强制 b 的 mtime 晚于 a 至少 1ns
	if err := os.WriteFile(b, []byte("12345"), 0o644); err != nil {
		t.Fatal(err)
	}
	future := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(b, future, future); err != nil {
		t.Fatal(err)
	}
	ia, _ := os.Stat(a)
	ib, _ := os.Stat(b)
	if videoETag(ia) == videoETag(ib) {
		t.Fatalf("expected different ETag for different mtime, both = %q", videoETag(ia))
	}

	// size 不同
	c := filepath.Join(dir, "c.mp4")
	if err := os.WriteFile(c, []byte("1234567"), 0o644); err != nil {
		t.Fatal(err)
	}
	ic, _ := os.Stat(c)
	if videoETag(ia) == videoETag(ic) {
		t.Fatalf("expected different ETag for different size, both = %q", videoETag(ia))
	}
}
