package handlers

import (
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

func TestSearchHandlerPagesMoreThanOneHundredHits(t *testing.T) {
	root := t.TempDir()
	albums := make([]models.Album, 105)
	for i := range albums {
		name := fmt.Sprintf("zz-search-load-more-%03d", i+1)
		albumPath := filepath.Join(root, name)
		image := filepath.Join(albumPath, "page.jpg")
		albums[i] = models.Album{
			Type:        "album",
			Path:        albumPath,
			Name:        name,
			DisplayName: name,
			SourceRoot:  root,
			ImageFiles:  []string{image},
			ImageCount:  1,
			CoverImage:  image,
			CoverKind:   "image",
		}
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots:      []string{root},
		Albums:     albums,
		AlbumCount: len(albums),
	}, []string{root})

	app := fiber.New()
	app.Get("/api/search", SearchHandler(catalog))
	firstResponse, err := app.Test(httptest.NewRequest(
		"GET",
		"/api/search?q=zz-search-load-more&kind=photo&limit=100",
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	defer firstResponse.Body.Close()
	if firstResponse.StatusCode != fiber.StatusOK {
		t.Fatalf("first status=%d", firstResponse.StatusCode)
	}
	var first struct {
		Count      int                         `json:"count"`
		NextCursor string                      `json:"nextCursor"`
		Results    []services.LibrarySearchHit `json:"results"`
	}
	if err := json.NewDecoder(firstResponse.Body).Decode(&first); err != nil {
		t.Fatal(err)
	}
	if first.Count != 105 || len(first.Results) != 100 || first.NextCursor == "" {
		t.Fatalf("first page count=%d results=%d next=%q", first.Count, len(first.Results), first.NextCursor)
	}
	if first.Results[0].Name != "zz-search-load-more-001" || first.Results[99].Name != "zz-search-load-more-100" {
		t.Fatalf("first page order=%q..%q", first.Results[0].Name, first.Results[99].Name)
	}

	secondResponse, err := app.Test(httptest.NewRequest(
		"GET",
		"/api/search?q=zz-search-load-more&kind=photo&limit=100&cursor="+first.NextCursor,
		nil,
	))
	if err != nil {
		t.Fatal(err)
	}
	defer secondResponse.Body.Close()
	if secondResponse.StatusCode != fiber.StatusOK {
		t.Fatalf("second status=%d", secondResponse.StatusCode)
	}
	var second struct {
		Count      int                         `json:"count"`
		NextCursor string                      `json:"nextCursor"`
		Results    []services.LibrarySearchHit `json:"results"`
	}
	if err := json.NewDecoder(secondResponse.Body).Decode(&second); err != nil {
		t.Fatal(err)
	}
	if second.Count != 105 || len(second.Results) != 5 || second.NextCursor != "" {
		t.Fatalf("second page count=%d results=%d next=%q", second.Count, len(second.Results), second.NextCursor)
	}
	if second.Results[0].Name != "zz-search-load-more-101" || second.Results[4].Name != "zz-search-load-more-105" {
		t.Fatalf("second page order=%q..%q", second.Results[0].Name, second.Results[4].Name)
	}
}
