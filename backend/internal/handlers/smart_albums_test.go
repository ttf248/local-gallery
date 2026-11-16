package handlers

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

func TestSmartAlbumGroupsHandlerBuildsAlbumScopedSummary(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "summer-trip")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := make([]string, 3)
	for index := range files {
		files[index] = filepath.Join(albumPath, fmt.Sprintf("%d.jpg", index))
		if err := os.WriteFile(files[index], []byte("image"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "summer-trip", Path: albumPath,
			SourceRoot: root, ImageFiles: files, ImageCount: len(files), CoverImage: files[0],
		}},
	}, []string{root})
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:   filepath.Join(root, "state", "jobs.json"),
		MetadataDir: filepath.Join(root, "derived", "metadata"), Catalog: catalog,
		ValidatePath: func(path string) (string, error) { return path, nil },
		Analyzers:    []services.AIAnalyzer{services.MetadataAnalyzer{}}, WorkerCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer jobs.Shutdown(context.Background())
	smartAlbums, err := services.OpenSmartAlbumService(services.SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs,
		ValidatePath: func(path string) (string, error) { return path, nil },
	})
	if err != nil {
		t.Fatal(err)
	}
	albumID := catalog.ExternalID(albumPath, services.ResourceAlbum)
	app := fiber.New()
	app.Get("/api/smart-albums", SmartAlbumDirectoryHandler(smartAlbums))
	app.Get("/api/albums/:id/smart-groups", SmartAlbumGroupsHandler(smartAlbums, false))
	app.Post("/api/albums/:id/smart-groups/rebuild", SmartAlbumGroupsHandler(smartAlbums, true))
	response, err := app.Test(httptest.NewRequest("GET", "/api/smart-albums", nil))
	if err != nil {
		t.Fatal(err)
	}
	var defaultDirectory struct {
		OK   bool                                                   `json:"ok"`
		Page services.LibraryPage[services.SmartAlbumDirectoryItem] `json:"page"`
	}
	if err := json.NewDecoder(response.Body).Decode(&defaultDirectory); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusOK || !defaultDirectory.OK || defaultDirectory.Page.Total != 0 {
		t.Fatalf("default recommendation directory status=%d payload=%+v", response.StatusCode, defaultDirectory)
	}
	response, err = app.Test(httptest.NewRequest("GET", "/api/albums/"+albumID+"/smart-groups?dimension=time", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("GET status=%d", response.StatusCode)
	}
	var payload struct {
		OK      bool                       `json:"ok"`
		Summary services.SmartAlbumSummary `json:"summary"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || payload.Summary.AlbumID != albumID || payload.Summary.TotalPhotos != 3 || payload.Summary.Dimension != services.SmartAlbumDimensionTime {
		t.Fatalf("summary response=%+v", payload)
	}
	response, err = app.Test(httptest.NewRequest("GET", "/api/smart-albums?dimension=time&limit=1", nil))
	if err != nil {
		t.Fatal(err)
	}
	var directoryPayload struct {
		OK   bool                                                   `json:"ok"`
		Page services.LibraryPage[services.SmartAlbumDirectoryItem] `json:"page"`
	}
	if err := json.NewDecoder(response.Body).Decode(&directoryPayload); err != nil {
		response.Body.Close()
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusOK || !directoryPayload.OK || directoryPayload.Page.Revision == 0 || directoryPayload.Page.Total != 0 {
		t.Fatalf("directory response status=%d payload=%+v", response.StatusCode, directoryPayload)
	}
	request := httptest.NewRequest("POST", "/api/albums/"+albumID+"/smart-groups/rebuild?dimension=time", nil)
	response, err = app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("POST rebuild status=%d", response.StatusCode)
	}
	response, err = app.Test(httptest.NewRequest("GET", "/api/albums/"+albumID+"/smart-groups?dimension=all", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid dimension status=%d", response.StatusCode)
	}
}

func TestAIJobSequenceHandlerAcceptsAlbumIDScope(t *testing.T) {
	root := t.TempDir()
	albums := []struct {
		name  string
		files []string
	}{
		{name: "first", files: make([]string, 3)},
		{name: "second", files: make([]string, 2)},
	}
	result := &models.ScanResult{Roots: []string{root}, AlbumCount: len(albums)}
	for albumIndex := range albums {
		albumPath := filepath.Join(root, albums[albumIndex].name)
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
		for imageIndex := range albums[albumIndex].files {
			path := filepath.Join(albumPath, fmt.Sprintf("%d.jpg", imageIndex))
			if err := os.WriteFile(path, []byte{0xff, 0xd8, 0xff, 0xd9}, 0o600); err != nil {
				t.Fatal(err)
			}
			albums[albumIndex].files[imageIndex] = path
		}
		result.Albums = append(result.Albums, models.Album{
			Type: "album", Name: albums[albumIndex].name, Path: albumPath,
			SourceRoot: root, ImageFiles: albums[albumIndex].files, ImageCount: len(albums[albumIndex].files),
		})
	}
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(result, []string{root})
	_, safetyState := middleware.PathSafetyMiddleware([]string{root}, catalog)
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:   filepath.Join(root, "state", "jobs.json"),
		MetadataDir: filepath.Join(root, "derived", "metadata"), Catalog: catalog,
		ValidatePath: safetyState.Validate,
		Analyzers:    []services.AIAnalyzer{services.MetadataAnalyzer{}}, WorkerCount: 1,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer jobs.Shutdown(context.Background())
	albumID := catalog.ExternalID(filepath.Join(root, "first"), services.ResourceAlbum)
	app := fiber.New()
	app.Post("/api/ai/jobs/sequence", AIJobSequenceStartHandler(jobs))
	request := httptest.NewRequest("POST", "/api/ai/jobs/sequence", strings.NewReader(fmt.Sprintf(`{"mode":"full","albumId":%q}`, albumID)))
	request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("sequence status=%d", response.StatusCode)
	}
	var payload struct {
		Jobs []services.AIJob `json:"jobs"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if len(payload.Jobs) != 1 || payload.Jobs[0].Type != services.AIJobTypeMetadata || payload.Jobs[0].AlbumID != albumID {
		t.Fatalf("scoped sequence response=%+v", payload)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		job, ok := jobs.Get(payload.Jobs[0].ID)
		if ok && (job.Status == services.AIJobStatusCompleted || job.Status == services.AIJobStatusFailed) {
			if job.Status != services.AIJobStatusCompleted || job.Total != len(albums[0].files) {
				t.Fatalf("scoped sequence result=%+v", job)
			}
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatal("scoped sequence job did not finish")
}
