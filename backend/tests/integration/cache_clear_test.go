package integration_test

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

// TestCacheClear_InvalidScope scope 非法时返回 400,且不做任何删盘动作。
func TestCacheClear_InvalidScope(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "POST", "/api/cache/clear?scope=bogus", nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("invalid scope: expected 400, got %d body=%s", res.StatusCode, body)
	}
}

// TestCacheClear_MissingScope 缺 scope 也走 400 分支;避免静默"全清"歧义。
func TestCacheClear_MissingScope(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "POST", "/api/cache/clear", nil)
	if res.StatusCode != http.StatusBadRequest {
		t.Fatalf("missing scope: expected 400, got %d body=%s", res.StatusCode, body)
	}
}

// TestCacheClear_ThumbsScope scope=thumbs 只删 derived/thumbnails，不动状态。
//
// harness 没有 ffmpeg(faststart/transcode 传 nil),所以 scope=faststart 或
// transcode 走 nil 兜底,刚好验证"service 不可用"时不会崩。
func TestCacheClear_ThumbsScope(t *testing.T) {
	h := newHarness(t)
	layout := services.ResolveCacheLayout(h.cache)
	dummy := filepath.Join(layout.ThumbnailDir, "deadbeefdeadbeefdeadbeefdeadbeef.jpg")
	if err := os.WriteFile(dummy, make([]byte, 1234), 0o644); err != nil {
		t.Fatal(err)
	}
	// faststart/transcode 子目录同样塞一个文件,scope=thumbs 不该动它们
	fsDir := filepath.Join(layout.DerivedDir, "video-faststart")
	if err := os.MkdirAll(fsDir, 0o755); err != nil {
		t.Fatal(err)
	}
	fsFile := filepath.Join(fsDir, "cafebabe.mp4")
	if err := os.WriteFile(fsFile, make([]byte, 5678), 0o644); err != nil {
		t.Fatal(err)
	}
	stateFiles := []string{layout.PreferencesPath, layout.ScanCachePath, layout.CoverOverridesPath}
	for _, stateFile := range stateFiles {
		if err := os.WriteFile(stateFile, []byte("{}"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	res, body := h.do(t, "POST", "/api/cache/clear?scope=thumbs", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("scope=thumbs: expected 200, got %d body=%s", res.StatusCode, body)
	}
	var resp struct {
		Scope  string `json:"scope"`
		Thumbs *struct {
			Deleted    int   `json:"deleted"`
			FreedBytes int64 `json:"freedBytes"`
		} `json:"thumbs,omitempty"`
		Faststart       *struct{} `json:"faststart,omitempty"`
		Transcode       *struct{} `json:"transcode,omitempty"`
		TotalDeleted    int       `json:"totalDeleted"`
		TotalFreedBytes int64     `json:"totalFreedBytes"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if resp.Scope != "thumbs" {
		t.Errorf("scope: got %q want thumbs", resp.Scope)
	}
	if resp.Thumbs == nil || resp.Thumbs.Deleted == 0 {
		t.Errorf("thumbs result missing/zero: %+v", resp.Thumbs)
	}
	if resp.Faststart != nil {
		t.Errorf("faststart should be nil for scope=thumbs, got %+v", resp.Faststart)
	}
	if resp.Transcode != nil {
		t.Errorf("transcode should be nil for scope=thumbs, got %+v", resp.Transcode)
	}
	// 缩略图文件应被删
	if _, err := os.Stat(dummy); !os.IsNotExist(err) {
		t.Errorf("thumbs file should be gone, stat err=%v", err)
	}
	// faststart/transcode 目录里的文件应保留
	if _, err := os.Stat(fsFile); err != nil {
		t.Errorf("faststart file should be preserved, stat err=%v", err)
	}
	for _, stateFile := range stateFiles {
		if _, err := os.Stat(stateFile); err != nil {
			t.Errorf("state file should be preserved: %v", err)
		}
	}
}

// TestCacheClear_AllScope scope=all:thumbs 真清;faststart/transcode service 为
// nil,hander 内部 if nil 兜底,响应里这俩字段应保持 nil(不影响响应结构)。
func TestCacheClear_AllScope(t *testing.T) {
	h := newHarness(t)
	layout := services.ResolveCacheLayout(h.cache)
	thumb := filepath.Join(layout.ThumbnailDir, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg")
	if err := os.WriteFile(thumb, make([]byte, 100), 0o644); err != nil {
		t.Fatal(err)
	}

	res, body := h.do(t, "POST", "/api/cache/clear?scope=all", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("scope=all: expected 200, got %d body=%s", res.StatusCode, body)
	}
	var resp struct {
		Scope           string                 `json:"scope"`
		Thumbs          *struct{ Deleted int } `json:"thumbs,omitempty"`
		Faststart       *struct{ Deleted int } `json:"faststart,omitempty"`
		Transcode       *struct{ Deleted int } `json:"transcode,omitempty"`
		TotalDeleted    int                    `json:"totalDeleted"`
		TotalFreedBytes int64                  `json:"totalFreedBytes"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatalf("unmarshal: %v body=%s", err, body)
	}
	if resp.Scope != "all" {
		t.Errorf("scope: got %q want all", resp.Scope)
	}
	if resp.Thumbs == nil {
		t.Error("thumbs should be present for scope=all")
	}
	if resp.Faststart != nil {
		t.Errorf("faststart service is nil, response should be nil, got %+v", resp.Faststart)
	}
	if resp.Transcode != nil {
		t.Errorf("transcode service is nil, response should be nil, got %+v", resp.Transcode)
	}
	// 顶层 thumbs 文件应被删
	entries, _ := os.ReadDir(layout.ThumbnailDir)
	for _, e := range entries {
		if e.Name() == filepath.Base(thumb) {
			t.Error("thumbs dummy should be gone")
		}
	}
}

// TestCacheClear_InvalidatesCacheStats 清空后,cache/stats 应能立即反映新占用,
// 而非继续返回 30s 内的旧值(回归用例:cacheStats.Invalidate 必须在 handler 内调用)。
func TestCacheClear_InvalidatesCacheStats(t *testing.T) {
	h := newHarness(t)
	layout := services.ResolveCacheLayout(h.cache)
	if err := os.WriteFile(filepath.Join(layout.ThumbnailDir, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg"), make([]byte, 2048), 0o644); err != nil {
		t.Fatal(err)
	}

	// 第一次拿 stats(填充 cacheStats 内部 50ms TTL)
	res, body := h.do(t, "GET", "/api/cache/stats", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stats: expected 200, got %d body=%s", res.StatusCode, body)
	}
	var stats struct {
		TotalBytes int64 `json:"totalBytes"`
		FileCount  int   `json:"fileCount"`
	}
	if err := json.Unmarshal(body, &stats); err != nil {
		t.Fatalf("stats unmarshal: %v", err)
	}
	if stats.TotalBytes < 2048 {
		t.Fatalf("stats before clear should include our 2KB, got %d", stats.TotalBytes)
	}

	// 清 thumbs
	res, body = h.do(t, "POST", "/api/cache/clear?scope=thumbs", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("clear: expected 200, got %d body=%s", res.StatusCode, body)
	}

	// 立即再查 stats —— 如果 Invalidate 没生效,会拿到旧值 2048
	res, body = h.do(t, "GET", "/api/cache/stats", nil)
	if res.StatusCode != http.StatusOK {
		t.Fatalf("stats after: expected 200, got %d", res.StatusCode)
	}
	if err := json.Unmarshal(body, &stats); err != nil {
		t.Fatalf("stats after unmarshal: %v", err)
	}
	if stats.TotalBytes >= 2048 {
		t.Errorf("stats after clear should be < 2048, got %d (Invalidate not called?)", stats.TotalBytes)
	}
}
