package handlers

import (
	"encoding/json"
	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
)

func TestActivityWorkMarkReadAndUndo(t *testing.T) {
	root, photo := t.TempDir(), t.TempDir()
	albums := []models.Album{}
	dir := filepath.Join(root, "作品")
	for _, name := range []string{"一", "二"} {
		path := filepath.Join(dir, name)
		albums = append(albums, models.Album{Type: "album", SourceRoot: root, Path: path, Name: name, ImageCount: 2, ImageFiles: []string{filepath.Join(path, "1.jpg"), filepath.Join(path, "2.jpg")}})
	}
	photos := filepath.Join(photo, "照片")
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: models.ContentKindComic}, {Path: photo, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{Roots: []string{root, photo}, Collections: []models.Collection{{Type: "collection", SourceRoot: root, Path: dir, Name: "作品", Albums: albums, AlbumCount: 2}, {Type: "collection", SourceRoot: photo, Path: photos, Name: "照片"}}}, []string{root, photo})
	activities := store.NewActivityStore(filepath.Join(t.TempDir(), "activity.json"))
	app := fiber.New()
	app.Post("/works/:id", ActivityWorkMarkReadHandler(catalog, activities))
	app.Delete("/activity", ActivityBatchDeleteHandler(activities))
	id := catalog.ExternalID(dir, services.ResourceCollection)
	existing := catalog.ExternalID(albums[0].Path, services.ResourceAlbum)
	fresh := catalog.ExternalID(albums[1].Path, services.ResourceAlbum)
	old := models.Activity{AlbumID: existing, MediaKind: models.MediaKindImage, PageIndex: 0, PageCount: 2}
	if err := activities.Set(old); err != nil {
		t.Fatal(err)
	}
	call := func(method, path, body string, want int) []string {
		t.Helper()
		req := httptest.NewRequest(method, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
		res, err := app.Test(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("%s status=%d want %d", path, res.StatusCode, want)
		}
		var out struct{ AffectedAlbums []string }
		if err = json.NewDecoder(res.Body).Decode(&out); err != nil {
			t.Fatal(err)
		}
		return out.AffectedAlbums
	}
	changed := call("POST", "/works/"+id, "{}", 200)
	if len(changed) != 1 || changed[0] != fresh {
		t.Fatalf("affected %v", changed)
	}
	if n := len(call("POST", "/works/"+id, "{}", 200)); n != 0 {
		t.Fatal("not idempotent")
	}
	call("DELETE", "/activity", `{"albumIds":["`+fresh+`"]}`, 200)
	if a, ok, err := activities.Get(old.Identity()); err != nil || !ok || a.PageIndex != 0 {
		t.Fatalf("previous progress lost: %+v %v", a, err)
	}
	if _, ok, _ := activities.Get(models.ActivityIdentity{AlbumID: fresh, MediaKind: models.MediaKindImage}); ok {
		t.Fatal("undo left progress")
	}
	call("POST", "/works/"+catalog.ExternalID(photos, services.ResourceCollection), "{}", 400)
	call("POST", "/works/not-a-resource", "{}", 404)
}
