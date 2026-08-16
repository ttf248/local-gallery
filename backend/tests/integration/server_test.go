// Package integration_test 跑真实 HTTP 端到端流程：构造临时漫画根目录，启动
// Fiber app，对全部公开 REST 端点发送请求并验证响应。
package integration_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/handlers"
	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/services"
	"github.com/tianlongxiang/comic-reader/internal/store"
)

type harness struct {
	app   *fiber.App
	root  string
	cache string
	prefs string
	mgr   *config.Manager
}

func newHarness(t *testing.T) *harness {
	t.Helper()
	// 使用自定义可清理的临时目录，避开 fasthttp 文件句柄延迟释放导致的
	// t.TempDir 清理失败（仅 Windows）。
	rootDir, err := os.MkdirTemp("", "comic-reader-it-")
	if err != nil {
		t.Fatal(err)
	}
	root := rootDir
	t.Cleanup(func() {
		// 多次重试，规避 Windows 文件句柄延迟
		for i := 0; i < 5; i++ {
			if err := os.RemoveAll(root); err == nil {
				return
			}
			time.Sleep(100 * time.Millisecond)
		}
		// 最终失败不阻塞测试
		_ = os.RemoveAll(root)
	})
	cache, err := os.MkdirTemp("", "comic-cache-")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(cache) })
	prefsDir, _ := os.MkdirTemp("", "comic-prefs-")
	prefs := filepath.Join(prefsDir, "settings.json")
	t.Cleanup(func() { os.RemoveAll(prefsDir) })

	// 准备 2 卷、3 张图：[作者A] vol1/page1.png, page2.png / vol2/page3.png
	writePNG(t, filepath.Join(root, "[作者A] vol1", "page1.png"), 200, 300)
	writePNG(t, filepath.Join(root, "[作者A] vol1", "page2.png"), 200, 300)
	writePNG(t, filepath.Join(root, "[作者A] vol2", "page3.png"), 200, 300)

	// config.Manager 持有根路径，便于 handler 拿到动态根
	mgr := config.NewManagerWith(&config.Config{
		MediaRoot:       root,
		Host:            "127.0.0.1",
		Port:            8080,
		AllowOsOpen:     false,
		CacheDir:        cache,
		ThumbSizeW:      64,
		ThumbSizeH:      64,
		ThumbCacheSize:  100,
		CacheMaxAgeDays: 30,
		StaticDir:       "",
	}, "")

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(middleware.Logger())
	app.Use(middleware.Recover())
	safetyMw, _ := middleware.PathSafetyMiddleware(root)
	app.Use(safetyMw)

	scanner := services.NewScanner()
	thumbs, err := services.NewThumbnailService(services.ThumbnailOptions{
		CacheDir:   cache,
		Width:      64,
		Height:     64,
		MaxAgeDays: 30,
	})
	if err != nil {
		t.Fatalf("thumbnail: %v", err)
	}
	runner := services.NewAsyncScanRunner()
	prefsStore := store.NewPrefsStore(prefs)

	api := app.Group("/api")
	api.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(map[string]interface{}{
			"status":    "ok",
			"comicRoot": root,
			"version":   "test",
		})
	})
	api.Post("/scan", handlers.ScanHandler(scanner, mgr))
	api.Post("/scan/start", handlers.AsyncScanStartHandler(runner, mgr))
	api.Get("/scan/:id/events", handlers.AsyncScanEventsHandler(runner))
	api.Get("/scan/:id/result", handlers.AsyncScanResultHandler(runner))
	api.Delete("/scan/:id", handlers.AsyncScanCancelHandler(runner))
	api.Get("/thumbs", handlers.ThumbHandler(thumbs))
	api.Get("/thumbs/stats", handlers.ThumbStatsHandler(thumbs))
	api.Post("/thumbs/cleanup", handlers.ThumbCleanupHandler(thumbs))
	api.Get("/images", handlers.ImageHandler())
	api.Get("/images/info", handlers.ImageInfoHandler())
	api.Get("/prefs", handlers.PrefsGetHandler(prefsStore))
	api.Patch("/prefs", handlers.PrefsPatchHandler(prefsStore))
	api.Get("/favorites", handlers.FavoritesListHandler(prefsStore))
	api.Post("/favorites", handlers.FavoriteAddHandler(prefsStore))
	api.Delete("/favorites", handlers.FavoriteRemoveHandler(prefsStore))
	api.Post("/favorites/prune", handlers.FavoritesPruneHandler(prefsStore))
	api.Get("/history", handlers.HistoryListHandler(prefsStore))
	api.Post("/history", handlers.HistoryAddHandler(prefsStore))
	api.Delete("/history", handlers.HistoryClearHandler(prefsStore))
	api.Get("/config", handlers.ConfigGetHandler(mgr))
	api.Put("/config", handlers.ConfigUpdateHandler(mgr, nil))

	return &harness{app, root, cache, prefs, mgr}
}

func (h *harness) do(t *testing.T, method, path string, body interface{}) (*http.Response, []byte) {
	t.Helper()
	var rdr io.Reader
	if body != nil {
		buf, _ := json.Marshal(body)
		rdr = bytes.NewReader(buf)
	}
	req := httptest.NewRequest(method, path, rdr)
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	res, err := h.app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	rb, _ := io.ReadAll(res.Body)
	return res, rb
}

// releaseFile 触发 Windows 上文件句柄的延迟释放，给 t.TempDir 清理留时间窗。
func releaseFile() {
	// 触发 GC 让 fasthttp 内部缓冲释放
	for i := 0; i < 3; i++ {
		runtime.Gosched()
	}
}

func TestHealth(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "GET", "/api/health", nil)
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	var got map[string]interface{}
	json.Unmarshal(body, &got)
	if got["status"] != "ok" {
		t.Errorf("status=%v want ok", got["status"])
	}
}

func TestSyncScan(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "POST", "/api/scan", nil)
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	var resp struct {
		OK     bool `json:"ok"`
		Result struct {
			Albums []struct {
				Name       string `json:"name"`
				Author     string `json:"author"`
				ImageCount int    `json:"imageCount"`
			} `json:"albums"`
			SmartCollections []struct {
				Author     string `json:"author"`
				AlbumCount int    `json:"albumCount"`
			} `json:"smartCollections"`
		} `json:"result"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		t.Fatal(err)
	}
	if !resp.OK {
		t.Fatal("ok != true")
	}
	if len(resp.Result.Albums) != 2 {
		t.Errorf("albums=%d want 2", len(resp.Result.Albums))
	}
	if len(resp.Result.SmartCollections) != 1 {
		t.Errorf("smart=%d want 1", len(resp.Result.SmartCollections))
	}
	if resp.Result.SmartCollections[0].Author != "作者A" {
		t.Errorf("smart author=%q", resp.Result.SmartCollections[0].Author)
	}
}

func TestAsyncScanAndSSE(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "POST", "/api/scan/start", nil)
	if res.StatusCode != 200 {
		t.Fatalf("start status=%d", res.StatusCode)
	}
	var sr struct {
		ScanID string `json:"scanId"`
	}
	json.Unmarshal(body, &sr)
	if sr.ScanID == "" {
		t.Fatalf("empty scanId, body=%s", body)
	}

	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		er, eb := h.do(t, "GET", "/api/scan/"+sr.ScanID+"/events", nil)
		if er.StatusCode != 200 {
			t.Fatalf("events status=%d", er.StatusCode)
		}
		stream := string(eb)
		if strings.Contains(stream, "event: complete") {
			return
		}
		if strings.Contains(stream, "event: error") {
			t.Fatalf("scan error: %s", stream)
		}
		time.Sleep(150 * time.Millisecond)
	}
	t.Fatal("scan did not complete in 3s")
}

func TestImageAndInfo(t *testing.T) {
	h := newHarness(t)
	img := filepath.Join(h.root, "[作者A] vol1", "page1.png")
	res, body := h.do(t, "GET", "/api/images?path="+escape(img), nil)
	if res.StatusCode != 200 {
		t.Fatalf("image status=%d body=%s", res.StatusCode, body)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if cfg.Width != 200 || cfg.Height != 300 {
		t.Errorf("size=%dx%d", cfg.Width, cfg.Height)
	}

	ir, ib := h.do(t, "GET", "/api/images/info?path="+escape(img), nil)
	if ir.StatusCode != 200 {
		t.Fatalf("info status=%d body=%s", ir.StatusCode, ib)
	}
	var info map[string]interface{}
	json.Unmarshal(ib, &info)
	if info["width"].(float64) != 200 {
		t.Errorf("info width=%v", info["width"])
	}
	if info["checksum"] == "" || info["checksum"] == nil {
		t.Error("checksum missing")
	}

	// 让 fasthttp 内部缓冲释放，避免 Windows 上 t.TempDir 清理时的 file lock
	releaseFile()
}

func TestThumb(t *testing.T) {
	h := newHarness(t)
	img := filepath.Join(h.root, "[作者A] vol1", "page1.png")
	// 缩略图尺寸由服务端配置决定（64×64），宽高比应保持一致
	res, body := h.do(t, "GET", "/api/thumbs?path="+escape(img), nil)
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("thumb decode: %v", err)
	}
	// 测试用例中创建的是 200×300，缩略图应保持宽高比：max(W,H)=64, 比例 2:3 → 42×64
	if cfg.Width != 42 || cfg.Height != 64 {
		t.Errorf("thumb size=%dx%d, want 42x64 (proportional to 200x300)", cfg.Width, cfg.Height)
	}
}

func TestFavorites(t *testing.T) {
	h := newHarness(t)
	path := "/some/album"

	res, _ := h.do(t, "POST", "/api/favorites", map[string]string{"path": path})
	if res.StatusCode != 200 {
		t.Fatalf("add status=%d", res.StatusCode)
	}
	_, body := h.do(t, "GET", "/api/favorites", nil)
	var got struct {
		Favorites []string `json:"favorites"`
	}
	json.Unmarshal(body, &got)
	if len(got.Favorites) != 1 || got.Favorites[0] != path {
		t.Errorf("favorites=%v", got.Favorites)
	}

	// DELETE handler expects JSON body, not query
	res, _ = h.do(t, "DELETE", "/api/favorites", map[string]string{"path": path})
	if res.StatusCode != 200 {
		t.Fatalf("del status=%d", res.StatusCode)
	}
	_, body = h.do(t, "GET", "/api/favorites", nil)
	json.Unmarshal(body, &got)
	if len(got.Favorites) != 0 {
		t.Errorf("after remove favorites=%v", got.Favorites)
	}
}

func TestPrefs(t *testing.T) {
	h := newHarness(t)
	res, _ := h.do(t, "PATCH", "/api/prefs", map[string]interface{}{"autoSwitchAlbum": true})
	if res.StatusCode != 200 {
		t.Fatalf("patch status=%d", res.StatusCode)
	}
	_, body := h.do(t, "GET", "/api/prefs", nil)
	var p map[string]interface{}
	json.Unmarshal(body, &p)
	if p["autoSwitchAlbum"] != true {
		t.Errorf("autoSwitchAlbum=%v", p["autoSwitchAlbum"])
	}
}

func TestPathSafetyRejectsEscape(t *testing.T) {
	h := newHarness(t)
	bad := "/etc/passwd"
	if _, err := os.Stat(bad); err == nil {
		res, _ := h.do(t, "GET", "/api/images/info?path="+escape(bad), nil)
		if res.StatusCode == 200 {
			t.Errorf("path safety failed: escape succeeded")
		}
	}
}

func TestHistory(t *testing.T) {
	h := newHarness(t)
	h.do(t, "POST", "/api/history", map[string]interface{}{"path": "/x", "name": "X", "imageCount": 5})
	h.do(t, "POST", "/api/history", map[string]interface{}{"path": "/y", "name": "Y", "imageCount": 3})
	_, body := h.do(t, "GET", "/api/history", nil)
	var got struct {
		History []map[string]interface{} `json:"history"`
	}
	json.Unmarshal(body, &got)
	if len(got.History) != 2 {
		t.Errorf("history=%d", len(got.History))
	}
}

func TestConfig_Get(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "GET", "/api/config", nil)
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	var got map[string]interface{}
	json.Unmarshal(body, &got)
	if got["mediaRoot"] != h.root {
		t.Errorf("mediaRoot=%v want %q", got["mediaRoot"], h.root)
	}
	if got["allowOsOpen"] != false {
		t.Errorf("allowOsOpen=%v", got["allowOsOpen"])
	}
}

func TestConfig_Patch_AllowOsOpen(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "PUT", "/api/config", map[string]interface{}{
		"allowOsOpen": true,
	})
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	var resp struct {
		OK     bool `json:"ok"`
		Config struct {
			AllowOsOpen bool `json:"allowOsOpen"`
		} `json:"config"`
		RequiresRestart []string `json:"requiresRestart"`
	}
	json.Unmarshal(body, &resp)
	if !resp.OK {
		t.Fatal("ok should be true")
	}
	if !resp.Config.AllowOsOpen {
		t.Error("allowOsOpen should be true after PATCH")
	}
	if len(resp.RequiresRestart) != 0 {
		t.Errorf("requiresRestart=%v should be empty for allowOsOpen", resp.RequiresRestart)
	}
	if !h.mgr.Get().AllowOsOpen {
		t.Error("manager should reflect new state")
	}
}

func TestConfig_Patch_Invalid(t *testing.T) {
	h := newHarness(t)
	res, _ := h.do(t, "PUT", "/api/config", map[string]interface{}{
		"port": 70000,
	})
	if res.StatusCode != 400 {
		t.Errorf("status=%d want 400", res.StatusCode)
	}
}

func TestConfig_Patch_PortRequiresRestart(t *testing.T) {
	h := newHarness(t)
	res, body := h.do(t, "PUT", "/api/config", map[string]interface{}{
		"port": 9090,
	})
	if res.StatusCode != 200 {
		t.Fatalf("status=%d body=%s", res.StatusCode, body)
	}
	var resp struct {
		RequiresRestart []string `json:"requiresRestart"`
	}
	json.Unmarshal(body, &resp)
	if len(resp.RequiresRestart) != 1 || resp.RequiresRestart[0] != "port" {
		t.Errorf("requiresRestart=%v want [port]", resp.RequiresRestart)
	}
}

// ---- helpers ----

func escape(s string) string {
	var b strings.Builder
	for _, r := range s {
		// r 是 UTF-8 rune；按字节编码
		buf := []byte(string(r))
		for _, c := range buf {
			if (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c == '-' || c == '_' || c == '.' || c == '~' {
				b.WriteByte(c)
			} else {
				b.WriteString(fmt.Sprintf("%%%02X", c))
			}
		}
	}
	return b.String()
}

func writePNG(t *testing.T, p string, w, h int) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(p), 0755); err != nil {
		t.Fatal(err)
	}
	f, err := os.Create(p)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{byte(x), byte(y), 100, 255})
		}
	}
	png.Encode(f, img)
}