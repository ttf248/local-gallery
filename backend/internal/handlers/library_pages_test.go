package handlers

import (
	"encoding/json"
	"io"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

func TestLibraryPageHandlersCursorStatusAndResponseShape(t *testing.T) {
	root := t.TempDir()
	album1Path := filepath.Join(root, "album1")
	album2Path := filepath.Join(root, "album2")
	file1 := filepath.Join(album1Path, "1.jpg")
	file2 := filepath.Join(album2Path, "2.mp4")
	result := &models.ScanResult{
		Root: root, Roots: []string{root}, AlbumCount: 2,
		Albums: []models.Album{
			{Type: "album", Path: album1Path, Name: "album1", ImageFiles: []string{file1}, ImageCount: 1, CoverImage: file1, CoverKind: "image"},
			{Type: "album", Path: album2Path, Name: "album2", VideoFiles: []string{file2}, VideoCount: 1, CoverImage: file2, CoverKind: "video"},
		},
		SmartCollections: []models.SmartCollection{{
			Type: "smartCollection", Tag: "收藏", Author: "收藏", AlbumCount: 2,
			Albums: []models.Album{
				{Type: "album", Path: album1Path, Name: "album1", ImageFiles: []string{file1}, ImageCount: 1, CoverImage: file1},
				{Type: "album", Path: album2Path, Name: "album2", VideoFiles: []string{file2}, VideoCount: 1, CoverImage: file2},
			}, CoverImage: file1,
		}},
	}
	catalog := services.NewResourceCatalog()
	catalog.Publish(result, []string{root})
	rootID := catalog.ExternalID(root, services.ResourceRoot)
	albumID := catalog.ExternalID(album1Path, services.ResourceAlbum)

	app := fiber.New()
	app.Get("/api/library/manifest", LibraryManifestHandler(catalog))
	app.Get("/api/library/:id/children", LibraryChildrenPageHandler(catalog))
	app.Post("/api/library/nodes/query", LibraryNodesQueryHandler(catalog))
	app.Get("/api/albums", LibraryAlbumsPageHandler(catalog))
	app.Get("/api/albums/:id/media", AlbumMediaPageHandler(catalog))
	app.Get("/api/tags", LibraryTagsPageHandler(catalog))
	app.Get("/api/tags/:tag/albums", TagAlbumsPageHandler(catalog))

	manifestResp, err := app.Test(httptest.NewRequest("GET", "/api/library/manifest", nil))
	if err != nil {
		t.Fatal(err)
	}
	if manifestResp.StatusCode != fiber.StatusOK || manifestResp.Header.Get(fiber.HeaderETag) == "" {
		t.Fatalf("manifest status=%d etag=%q", manifestResp.StatusCode, manifestResp.Header.Get(fiber.HeaderETag))
	}
	assertHandlerBodyHasNoAbsolutePath(t, manifestResp.Body)

	firstResp, err := app.Test(httptest.NewRequest("GET", "/api/library/"+rootID+"/children?limit=1", nil))
	if err != nil {
		t.Fatal(err)
	}
	var first struct {
		Page struct {
			NextCursor string `json:"nextCursor"`
			Items      []struct {
				ID string `json:"id"`
			} `json:"items"`
		} `json:"page"`
	}
	if err := json.NewDecoder(firstResp.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}
	_ = firstResp.Body.Close()
	if len(first.Page.Items) != 1 || first.Page.NextCursor == "" {
		t.Fatalf("first page=%+v", first.Page)
	}

	mediaResp, err := app.Test(httptest.NewRequest("GET", "/api/albums/"+albumID+"/media", nil))
	if err != nil {
		t.Fatal(err)
	}
	if mediaResp.StatusCode != fiber.StatusOK {
		t.Fatalf("media status=%d", mediaResp.StatusCode)
	}
	assertHandlerBodyHasNoAbsolutePath(t, mediaResp.Body)

	albumsResp, err := app.Test(httptest.NewRequest("GET", "/api/albums?limit=1", nil))
	if err != nil {
		t.Fatal(err)
	}
	if albumsResp.StatusCode != fiber.StatusOK {
		t.Fatalf("albums status=%d", albumsResp.StatusCode)
	}
	assertHandlerBodyHasNoAbsolutePath(t, albumsResp.Body)

	queryRequest := httptest.NewRequest("POST", "/api/library/nodes/query", strings.NewReader(`{"ids":["`+albumID+`","a_missing"]}`))
	queryRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	queryResp, err := app.Test(queryRequest)
	if err != nil {
		t.Fatal(err)
	}
	if queryResp.StatusCode != fiber.StatusOK {
		t.Fatalf("query status=%d", queryResp.StatusCode)
	}
	var queryBody struct {
		Result struct {
			Items   []services.LibraryNodeSummary `json:"items"`
			Missing []string                      `json:"missing"`
		} `json:"result"`
	}
	if err := json.NewDecoder(queryResp.Body).Decode(&queryBody); err != nil {
		t.Fatal(err)
	}
	_ = queryResp.Body.Close()
	if len(queryBody.Result.Items) != 1 || len(queryBody.Result.Missing) != 1 {
		t.Fatalf("node query=%+v", queryBody.Result)
	}

	invalidResp, err := app.Test(httptest.NewRequest("GET", "/api/tags?cursor=not-a-cursor", nil))
	if err != nil {
		t.Fatal(err)
	}
	if invalidResp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid cursor status=%d, want 400", invalidResp.StatusCode)
	}
	var invalidBody map[string]any
	if err := json.NewDecoder(invalidResp.Body).Decode(&invalidBody); err != nil {
		t.Fatal(err)
	}
	_ = invalidResp.Body.Close()
	if invalidBody["code"] != "invalid_cursor" {
		t.Fatalf("invalid cursor body=%+v", invalidBody)
	}

	// 资源已从新 revision 消失时，也必须先识别旧游标并返回 409；因此
	// 这两条纯目录读取路由不应挂 ResourceParam 文件系统中间件。
	catalog.Publish(&models.ScanResult{Root: root, Roots: []string{root}}, []string{root})
	staleResp, err := app.Test(httptest.NewRequest("GET", "/api/library/"+rootID+"/children?limit=1&cursor="+first.Page.NextCursor, nil))
	if err != nil {
		t.Fatal(err)
	}
	if staleResp.StatusCode != fiber.StatusConflict {
		t.Fatalf("stale cursor status=%d, want 409", staleResp.StatusCode)
	}
	var staleBody map[string]any
	if err := json.NewDecoder(staleResp.Body).Decode(&staleBody); err != nil {
		t.Fatal(err)
	}
	_ = staleResp.Body.Close()
	if staleBody["code"] != "stale_cursor" {
		t.Fatalf("stale cursor body=%+v", staleBody)
	}

	badLimitResp, err := app.Test(httptest.NewRequest("GET", "/api/tags?limit=nope", nil))
	if err != nil {
		t.Fatal(err)
	}
	if badLimitResp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("bad limit status=%d, want 400", badLimitResp.StatusCode)
	}
}

func assertHandlerBodyHasNoAbsolutePath(t *testing.T, body io.ReadCloser) {
	t.Helper()
	defer body.Close()
	var decoded any
	if err := json.NewDecoder(body).Decode(&decoded); err != nil {
		t.Fatal(err)
	}
	var visit func(any)
	visit = func(value any) {
		switch typed := value.(type) {
		case string:
			if filepath.IsAbs(typed) {
				t.Fatalf("handler response exposed absolute path %q", typed)
			}
		case []any:
			for _, item := range typed {
				visit(item)
			}
		case map[string]any:
			for _, item := range typed {
				visit(item)
			}
		}
	}
	visit(decoded)
}
