package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// newAlbumFilterApp 建一个带照片墙筛选接口的最小服务。
func newAlbumFilterApp(t *testing.T) (*fiber.App, *services.ResourceCatalog, string, []string) {
	t.Helper()
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := make([]string, 0, 3)
	for index := 0; index < 3; index++ {
		path := filepath.Join(albumPath, string(rune('a'+index))+".jpg")
		if err := os.WriteFile(path, []byte("photo"), 0o600); err != nil {
			t.Fatal(err)
		}
		files = append(files, path)
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})
	albumID := catalog.ExternalID(albumPath, services.ResourceAlbum)
	picks := store.NewPickStore(filepath.Join(root, "state", "picks.json"))
	engine := services.NewAlbumFilterEngine(catalog, nil, nil, picks, nil)
	app := fiber.New()
	app.Get("/api/albums/:id/media", AlbumMediaPageHandler(catalog, nil, picks, engine))
	app.Get("/api/albums/:id/filters", AlbumFiltersHandler(catalog, engine))
	return app, catalog, albumID, files
}

func albumFilterGet(t *testing.T, app *fiber.App, path string) (int, map[string]any) {
	t.Helper()
	response, err := app.Test(httptest.NewRequest("GET", path, nil))
	if err != nil {
		t.Fatal(err)
	}
	body := map[string]any{}
	if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
	return response.StatusCode, body
}

func TestAlbumMediaPageRejectsInvalidFilter(t *testing.T) {
	app, _, albumID, _ := newAlbumFilterApp(t)
	for _, query := range []string{"from=2024-13", "to=2024", "adcode=abc", "picks=maybe", "scene=nope", "collapse=perhaps"} {
		status, body := albumFilterGet(t, app, "/api/albums/"+albumID+"/media?"+query)
		if status != fiber.StatusBadRequest {
			t.Fatalf("%s status=%d body=%v", query, status, body)
		}
		if code, _ := body["code"].(string); code != "invalid_album_filter" {
			t.Fatalf("%s code=%v", query, body["code"])
		}
	}
}

func TestAlbumMediaPageRejectsReversedTimeRange(t *testing.T) {
	app, _, albumID, _ := newAlbumFilterApp(t)
	status, _ := albumFilterGet(t, app, "/api/albums/"+albumID+"/media?from=2024-08&to=2024-06")
	if status != fiber.StatusBadRequest {
		t.Fatalf("status=%d", status)
	}
}

func TestAlbumFiltersEndpointReportsFacets(t *testing.T) {
	app, _, albumID, _ := newAlbumFilterApp(t)
	status, body := albumFilterGet(t, app, "/api/albums/"+albumID+"/filters")
	if status != fiber.StatusOK {
		t.Fatalf("status=%d body=%v", status, body)
	}
	facets, ok := body["facets"].(map[string]any)
	if !ok {
		t.Fatalf("body=%v", body)
	}
	timeFacet, ok := facets["time"].(map[string]any)
	if !ok {
		t.Fatalf("time facet=%v", facets["time"])
	}
	if available, _ := timeFacet["available"].(bool); available {
		t.Fatalf("time facet should not be available without analysis: %v", timeFacet)
	}
	if reason, _ := timeFacet["reason"].(string); !strings.Contains(reason, "EXIF") {
		t.Fatalf("time facet reason=%q", reason)
	}
}

func TestAlbumMediaPageCountsVideosSeparately(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(albumPath, "a.jpg")
	videoPath := filepath.Join(albumPath, "b.mp4")
	for _, path := range []string{imagePath, videoPath} {
		if err := os.WriteFile(path, []byte("media"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: []string{imagePath}, VideoFiles: []string{videoPath},
			ImageCount: 1, VideoCount: 1,
		}},
	}, []string{root})
	albumID := catalog.ExternalID(albumPath, services.ResourceAlbum)
	picks := store.NewPickStore(filepath.Join(root, "state", "picks.json"))
	engine := services.NewAlbumFilterEngine(catalog, nil, nil, picks, nil)
	app := fiber.New()
	app.Get("/api/albums/:id/media", AlbumMediaPageHandler(catalog, nil, picks, engine))

	status, body := albumFilterGet(t, app, "/api/albums/"+albumID+"/media")
	if status != fiber.StatusOK {
		t.Fatalf("status=%d body=%v", status, body)
	}
	page, ok := body["page"].(map[string]any)
	if !ok {
		t.Fatalf("body=%v", body)
	}
	if total, _ := page["total"].(float64); total != 2 {
		t.Fatalf("total=%v", page["total"])
	}
	if videos, _ := page["videoTotal"].(float64); videos != 1 {
		t.Fatalf("videoTotal=%v", page["videoTotal"])
	}
}
