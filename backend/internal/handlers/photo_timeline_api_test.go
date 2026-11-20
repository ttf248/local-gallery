package handlers

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

func TestPhotoTimelineAPIKeepsUnknownCountsAndDatePrecisionAcrossFilters(t *testing.T) {
	root := t.TempDir()
	knownPath := filepath.Join(root, "2024")
	unknownPath := filepath.Join(root, "untimed")
	for _, path := range []string{knownPath, unknownPath} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	write := func(path string) {
		t.Helper()
		if err := os.WriteFile(path, []byte("media"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	knownImages := []string{
		filepath.Join(knownPath, "IMG_20240305_101500.jpg"),
		filepath.Join(knownPath, "IMG_20240406_101500.jpg"),
		filepath.Join(knownPath, "year-only.jpg"),
	}
	unknownImages := []string{filepath.Join(unknownPath, "plain.jpg")}
	unknownVideos := []string{
		filepath.Join(unknownPath, "VID_20240308_101500.mp4"),
		filepath.Join(unknownPath, "untimed.mp4"),
	}
	for _, path := range append(append([]string{}, knownImages...), unknownImages...) {
		write(path)
	}
	for _, path := range unknownVideos {
		write(path)
	}
	modified := time.Date(2025, 6, 7, 8, 9, 10, 0, time.UTC)
	knownAlbum := models.Album{
		Type: "album", Path: knownPath, Name: "2024", SourceRoot: root,
		ImageFiles: knownImages, ImageModTimes: []time.Time{modified, modified, modified},
		ImageCount: len(knownImages), ContentKind: string(models.ContentKindPhoto),
	}
	unknownAlbum := models.Album{
		Type: "album", Path: unknownPath, Name: "untimed", SourceRoot: root,
		ImageFiles: unknownImages, ImageModTimes: []time.Time{modified}, ImageCount: len(unknownImages),
		VideoFiles: unknownVideos, VideoModTimes: []time.Time{modified, modified}, VideoCount: len(unknownVideos),
		ContentKind: string(models.ContentKindPhoto),
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{
		Path: root, Kind: models.ContentKindPhoto,
	}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, Albums: []models.Album{knownAlbum, unknownAlbum}, AlbumCount: 2,
	}, []string{root})
	app := fiber.New()
	app.Get("/api/library/media-feed", LibraryMediaFeedHandler(
		catalog, nil, nil, services.NewPhotoTimelineService(nil),
	))

	request := func(query string) services.PhotoTimelinePage {
		t.Helper()
		response, err := app.Test(httptest.NewRequest("GET", "/api/library/media-feed?kind=photo&scope=timeline&"+query, nil))
		if err != nil {
			t.Fatal(err)
		}
		defer response.Body.Close()
		if response.StatusCode != fiber.StatusOK {
			var body map[string]any
			_ = json.NewDecoder(response.Body).Decode(&body)
			t.Fatalf("timeline API status = %d, response = %v", response.StatusCode, body)
		}
		var body struct {
			OK   bool                       `json:"ok"`
			Page services.PhotoTimelinePage `json:"page"`
		}
		if err := json.NewDecoder(response.Body).Decode(&body); err != nil {
			t.Fatal(err)
		}
		if !body.OK {
			t.Fatal("timeline API returned ok=false")
		}
		return body.Page
	}

	first := request("limit=2")
	if first.Total != 6 || first.Unknown != 2 {
		t.Fatalf("all timeline total/unknown = %d/%d, want 6/2", first.Total, first.Unknown)
	}
	counts := map[string]int{}
	for _, album := range first.Albums {
		counts[album.Name] = album.Count
	}
	if counts["2024"] != 3 || counts["untimed"] != 3 {
		t.Fatalf("source album counts = %v, want 2024=3 and untimed=3", counts)
	}
	if first.NextCursor == "" {
		t.Fatal("first API page has no next cursor")
	}
	next := request("limit=2&cursor=" + url.QueryEscape(first.NextCursor))
	if next.Total != first.Total || len(next.Items) != 2 {
		t.Fatalf("second page total/items = %d/%d", next.Total, len(next.Items))
	}
	for _, album := range next.Albums {
		if counts[album.Name] != album.Count {
			t.Errorf("cross-page count for %q changed from %d to %d", album.Name, counts[album.Name], album.Count)
		}
	}
	var sawYearOnly bool
	for _, item := range append(first.Items, next.Items...) {
		if item.Name == "year-only.jpg" {
			sawYearOnly = true
			if item.DateSource != services.TimelineDateFolder || item.DatePrecision != services.TimelinePrecisionYear || item.DateValue != "2024" || item.CapturedAt != "" {
				t.Errorf("year-only API item = %+v", item)
			}
		}
	}
	if !sawYearOnly {
		t.Fatal("year-only item missing from paged response")
	}

	filters := []struct {
		name           string
		query          string
		wantTotal      int
		wantUnknown    int
		wantModified   int
		wantPrecision  string
		wantPrecisions int
	}{
		{name: "year", query: "year=2024", wantTotal: 4, wantUnknown: 2, wantPrecision: "day", wantPrecisions: 3},
		{name: "month", query: "year=2024&month=3", wantTotal: 2, wantUnknown: 2, wantPrecision: "day", wantPrecisions: 2},
		{name: "photos", query: "year=2024&media=photo", wantTotal: 3, wantUnknown: 1, wantPrecision: "year", wantPrecisions: 1},
		{name: "videos", query: "year=2024&media=video", wantTotal: 1, wantUnknown: 1, wantPrecision: "day", wantPrecisions: 1},
		{name: "unknown photos", query: "year=unknown&media=photo", wantTotal: 1, wantUnknown: 1, wantModified: 1, wantPrecision: "unknown", wantPrecisions: 1},
		{name: "unknown videos", query: "year=unknown&media=video", wantTotal: 1, wantUnknown: 1, wantModified: 1, wantPrecision: "unknown", wantPrecisions: 1},
	}
	for _, filter := range filters {
		t.Run(filter.name, func(t *testing.T) {
			page := request(filter.query)
			if page.Total != filter.wantTotal || page.Unknown != filter.wantUnknown {
				t.Errorf("total/unknown = %d/%d, want %d/%d", page.Total, page.Unknown, filter.wantTotal, filter.wantUnknown)
			}
			if page.DateSources[services.TimelineDateModified] != filter.wantModified {
				t.Errorf("modified source count = %d, want %d; all sources: %v", page.DateSources[services.TimelineDateModified], filter.wantModified, page.DateSources)
			}
			if page.DatePrecisions[filter.wantPrecision] != filter.wantPrecisions {
				t.Errorf("%s precision count = %d, want %d; all precisions: %v", filter.wantPrecision, page.DatePrecisions[filter.wantPrecision], filter.wantPrecisions, page.DatePrecisions)
			}
		})
	}
}
