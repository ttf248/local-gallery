package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

type comicHandlerFixture struct {
	app                        *fiber.App
	work, photo, file, outside string
}

func comicHTTP(t *testing.T) comicHandlerFixture {
	t.Helper()
	root := t.TempDir()
	photo := t.TempDir()
	work := filepath.Join(root, "作品")
	p := filepath.Join(work, "第1话")
	os.MkdirAll(p, 0755)
	file := filepath.Join(p, "1.png")
	os.WriteFile(file, []byte("page"), 0600)
	outside := filepath.Join(photo, "outside.png")
	os.WriteFile(outside, []byte("image"), 0600)
	c := services.NewResourceCatalog()
	roots := []string{root, photo}
	safety, v := middleware.PathSafetyMiddleware(roots, c)
	c.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: "comic"}, {Path: photo, Kind: "photo"}}))
	layout, err := services.EnsureCacheLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s, err := services.OpenComicMetaService(services.ComicMetaServiceOptions{Catalog: c, Layout: layout, ValidatePath: v.Validate})
	if err != nil {
		t.Fatal(err)
	}
	c.Publish(&models.ScanResult{Collections: []models.Collection{{SourceRoot: root, Path: work, Name: "作品", Albums: []models.Album{{SourceRoot: root, Name: "第1话", Path: p, ImageFiles: []string{file}, ImageCount: 1, CoverImage: file}}}}, Albums: []models.Album{{Path: photo, Name: "照片", ImageFiles: []string{outside}, ImageCount: 1}}}, roots)
	cfg := config.Default()
	cfg.AccessMode = config.AccessModeLAN
	cfg.AccessToken = strings.Repeat("t", 40)
	app := fiber.New()
	api := app.Group("/api", middleware.NewAccessGate(func() *config.Config { return cfg }).Middleware(), safety)
	api.Get("/library/overview", LibraryQueryHandler(c, store.NewPrefsStore(layout.PreferencesPath), store.NewActivityStore(layout.ActivityPath)))
	handler := ComicMetaHandler(s, v)
	api.All("/comics/:id/meta", handler)
	api.Post("/comics/:id/meta/refresh", handler)
	api.All("/collections/:id/cover", CollectionCoverHandler(c, nil, services.NewCoverOverrideStore(layout.CoverOverridesPath), v))
	return comicHandlerFixture{app, c.ExternalID(work, services.ResourceCollection), c.ExternalID(photo, services.ResourceAlbum), c.ExternalID(file, services.ResourceFile), c.ExternalID(outside, services.ResourceFile)}
}
func (f comicHandlerFixture) call(t *testing.T, method, path, body string, auth bool, want int) map[string]any {
	t.Helper()
	req := httptest.NewRequest(method, "http://localhost/api/"+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	if auth {
		req.Header.Set("Authorization", "Bearer "+strings.Repeat("t", 40))
	}
	r, err := f.app.Test(req, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer r.Body.Close()
	var value map[string]any
	json.NewDecoder(r.Body).Decode(&value)
	if r.StatusCode != want {
		t.Fatalf("%s %s: %d %+v", method, path, r.StatusCode, value)
	}
	return value
}
func TestComicMetaHTTP(t *testing.T) {
	f := comicHTTP(t)
	path := "comics/" + f.work + "/meta"
	f.call(t, "GET", path, "", false, 401)
	f.call(t, "GET", "comics/stale/meta", "", true, 404)
	f.call(t, "GET", "comics/"+f.photo+"/meta", "", true, 400)
	f.call(t, "PUT", path, `{"unexpected":true}`, true, 400)
	v := f.call(t, "PUT", path, `{"synopsis":"人工大纲","locked":true}`, true, 200)
	if v["meta"].(map[string]any)["fullSynopsis"] != "人工大纲" {
		t.Fatal(v)
	}
	f.call(t, "POST", path+"/refresh", `{"allowOnline":true}`, true, 403)
	f.call(t, "DELETE", path, "", true, 200)
}
func TestCollectionCoverHTTP(t *testing.T) {
	f := comicHTTP(t)
	path := "collections/" + f.work + "/cover"
	f.call(t, "PUT", path+"?file="+f.outside, "", true, 400)
	f.call(t, "PUT", path+"?file="+f.file, "", true, 200)
	f.call(t, "DELETE", path, "", true, 200)
}

func TestLibraryQueryComic(t *testing.T) {
	f := comicHTTP(t)
	f.call(t, "PUT", "comics/"+f.work+"/meta", `{"title":"新版书名","author":"新作者"}`, true, 200)
	for _, q := range []string{"新作者", "作品", "新版书名"} {
		page := f.call(t, "GET", "library/overview?kind=comic&q="+q, "", true, 200)["page"].(map[string]any)
		if page["total"] != float64(1) {
			t.Fatal(page)
		}
	}
	page := f.call(t, "GET", "library/overview?kind=comic&episodeType=extra&parent="+f.work, "", true, 200)["page"].(map[string]any)
	if page["total"] != float64(0) {
		t.Fatal(page)
	}
}
