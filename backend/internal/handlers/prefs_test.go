package handlers

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/store"
)

func TestPrefsAppModeRoundTrip(t *testing.T) {
	prefs := store.NewPrefsStore(filepath.Join(t.TempDir(), "web_settings.json"))
	app := fiber.New()
	app.Get("/api/prefs", PrefsGetHandler(prefs))
	app.Patch("/api/prefs", PrefsPatchHandler(prefs))

	get := func() map[string]any {
		t.Helper()
		resp, err := app.Test(httptest.NewRequest("GET", "/api/prefs", nil))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != fiber.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("status=%d body=%s", resp.StatusCode, body)
		}
		var payload map[string]any
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload
	}

	if mode := get()["appMode"]; mode != "photo" {
		t.Fatalf("default appMode=%v, want photo", mode)
	}

	resp, err := app.Test(patchReq(`{"appMode":"comic"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("patch status=%d body=%s", resp.StatusCode, body)
	}
	if mode := get()["appMode"]; mode != "comic" {
		t.Fatalf("appMode=%v, want comic", mode)
	}

	// 非法值必须被拒绝，不能写进偏好。
	resp, err = app.Test(patchReq(`{"appMode":"manga"}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid appMode status=%d, want 400", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "invalid_app_mode") {
		t.Fatalf("body=%s", body)
	}
	// 错误文案只列真实存在的取值：「全部」这一档已经不存在了。
	if !strings.Contains(string(body), "appMode must be photo or comic") {
		t.Fatalf("错误文案应只列 photo / comic, body=%s", body)
	}
	if strings.Contains(string(body), "all") {
		t.Fatalf("错误文案不应再提「全部」, body=%s", body)
	}
	if mode := get()["appMode"]; mode != "comic" {
		t.Fatalf("appMode=%v after rejected patch, want comic", mode)
	}
}

// patchReq 构造一个带 JSON 内容类型的 PATCH 请求。
func patchReq(body string) *http.Request {
	req := httptest.NewRequest("PATCH", "/api/prefs", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	return req
}

// 偏好响应里不再带收藏与最近访问：它们各有独立接口与独立缓存。
// 但偏好文件本身仍然带着这两项 —— 备份要是一个完整快照。
func TestPrefsResponseOmitsFavoritesAndHistory(t *testing.T) {
	path := filepath.Join(t.TempDir(), "web_settings.json")
	prefs := store.NewPrefsStore(path)
	app := fiber.New()
	app.Get("/api/prefs", PrefsGetHandler(prefs))
	app.Patch("/api/prefs", PrefsPatchHandler(prefs))
	app.Get("/api/favorites", FavoritesListHandler(prefs))

	resp, err := app.Test(httptest.NewRequest("GET", "/api/prefs", nil))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status=%d body=%s", resp.StatusCode, body)
	}
	var payload map[string]any
	if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"favorites", "history"} {
		if _, ok := payload[key]; ok {
			t.Fatalf("偏好响应不应带 %s, payload=%v", key, payload)
		}
	}

	// 收藏走自己的接口，数据仍在。
	if _, err := prefs.AddFavorite("a_0000000000000000000001"); err != nil {
		t.Fatal(err)
	}
	resp, err = app.Test(httptest.NewRequest("GET", "/api/favorites", nil))
	if err != nil {
		t.Fatal(err)
	}
	var favs struct {
		Favorites []string `json:"favorites"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&favs); err != nil {
		t.Fatal(err)
	}
	if len(favs.Favorites) != 1 {
		t.Fatalf("favorites=%v, want 1 entry", favs.Favorites)
	}

	// 落盘的偏好文件仍然带着收藏：备份要能还原。
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var disk map[string]any
	if err := json.Unmarshal(data, &disk); err != nil {
		t.Fatal(err)
	}
	if _, ok := disk["favorites"]; !ok {
		t.Fatalf("偏好文件应带 favorites, disk=%v", disk)
	}
}

// 侧栏的隐藏清单：默认全部显示，改动后整份写回，非法 key 被拒绝。
func TestPrefsHiddenNavItemsRoundTrip(t *testing.T) {
	prefs := store.NewPrefsStore(filepath.Join(t.TempDir(), "web_settings.json"))
	app := fiber.New()
	app.Get("/api/prefs", PrefsGetHandler(prefs))
	app.Patch("/api/prefs", PrefsPatchHandler(prefs))

	get := func() []string {
		t.Helper()
		resp, err := app.Test(httptest.NewRequest("GET", "/api/prefs", nil))
		if err != nil {
			t.Fatal(err)
		}
		if resp.StatusCode != fiber.StatusOK {
			body, _ := io.ReadAll(resp.Body)
			t.Fatalf("status=%d body=%s", resp.StatusCode, body)
		}
		var payload struct {
			HiddenNavItems []string `json:"hiddenNavItems"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&payload); err != nil {
			t.Fatal(err)
		}
		return payload.HiddenNavItems
	}

	hidden := get()
	want := []string{}
	if len(hidden) != len(want) {
		t.Fatalf("default hiddenNavItems=%v, want %v", hidden, want)
	}
	for i, key := range want {
		if hidden[i] != key {
			t.Fatalf("default hiddenNavItems=%v, want %v", hidden, want)
		}
	}

	resp, err := app.Test(patchReq(`{"hiddenNavItems":["photo.travels"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("patch status=%d body=%s", resp.StatusCode, body)
	}
	if got := get(); len(got) != 1 || got[0] != "photo.travels" {
		t.Fatalf("hiddenNavItems=%v, want [photo.travels]", got)
	}

	// 空清单表示全部显示，与默认的三项收起不同，必须原样存下来。
	resp, err = app.Test(patchReq(`{"hiddenNavItems":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("patch status=%d body=%s", resp.StatusCode, body)
	}
	if got := get(); len(got) != 0 {
		t.Fatalf("hiddenNavItems=%v, want empty", got)
	}

	// 非法 key 不得写进偏好。
	resp, err = app.Test(patchReq(`{"hiddenNavItems":["Photo Recents"]}`))
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid nav item status=%d, want 400", resp.StatusCode)
	}
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "invalid_nav_item") {
		t.Fatalf("body=%s", body)
	}
	if got := get(); len(got) != 0 {
		t.Fatalf("hiddenNavItems=%v after rejected patch, want empty", got)
	}
}
