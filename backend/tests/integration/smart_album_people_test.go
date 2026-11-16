package integration_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/handlers"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

const integrationFaceEmbeddingDimension = 128

type integrationFaceAnalyzer struct {
	data json.RawMessage
}

func (a integrationFaceAnalyzer) Type() string    { return services.AIJobTypeFace }
func (a integrationFaceAnalyzer) Version() string { return services.FaceAnalyzerVersion }

func (a integrationFaceAnalyzer) Analyze(context.Context, io.ReadSeeker) (services.AIAnalysisOutput, error) {
	return services.AIAnalysisOutput{
		Status: "faces_found", Data: a.data, Fields: []string{services.AIFieldFaces},
	}, nil
}

// 人物分析写入结果后，智能分组接口仍能读取人物快照并返回可分页的照片。
func TestSmartAlbumPeopleGroupMediaAfterFaceIndexUpdate(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "photos")
	files := make([]string, 12)
	for index := range files {
		files[index] = filepath.Join(albumPath, fmt.Sprintf("photo-%02d.png", index))
		writePNG(t, files[index], 200, 300)
	}

	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})

	safetyMiddleware, safetyState := middleware.PathSafetyMiddleware([]string{root})
	cacheDir := t.TempDir()
	people, err := services.OpenPeopleService(
		filepath.Join(cacheDir, "state", "people.json"),
		filepath.Join(cacheDir, "derived", "people-index.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	var callbackErr error
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:   filepath.Join(cacheDir, "state", "jobs.json"),
		MetadataDir: filepath.Join(cacheDir, "derived", "metadata"),
		Catalog:     catalog, ValidatePath: safetyState.Validate, WorkerCount: 1,
		Analyzers: []services.AIAnalyzer{
			services.MetadataAnalyzer{}, integrationFaceAnalyzer{data: integrationFaceData(t)},
		},
		OnRecordsCommitted: func(records []services.AIAnalysisRecord) {
			callbackErr = people.ApplyRecords(records)
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := jobs.Shutdown(context.Background()); err != nil {
			t.Errorf("shutdown AI jobs: %v", err)
		}
	})
	if _, err := jobs.SetPeopleEnabled(true); err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.SetGPUEnabled(false); err != nil {
		t.Fatal(err)
	}
	albumID := catalog.ExternalID(albumPath, services.ResourceAlbum)
	job, _, err := jobs.Start(services.AIJobTypeFace, services.AIJobModeFull, albumID)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(10 * time.Second)
	for {
		current, exists := jobs.Get(job.ID)
		if !exists {
			t.Fatal("face analysis job disappeared")
		}
		if current.Status == services.AIJobStatusCompleted {
			break
		}
		if current.Status == services.AIJobStatusFailed {
			t.Fatalf("face analysis job failed: %+v", current)
		}
		if time.Now().After(deadline) {
			t.Fatalf("face analysis job did not complete: %+v", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
	if callbackErr != nil {
		t.Fatalf("publish face index: %v", callbackErr)
	}

	smartAlbums, err := services.OpenSmartAlbumService(services.SmartAlbumServiceOptions{
		StatePath: filepath.Join(cacheDir, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(cacheDir, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, People: people, ValidatePath: safetyState.Validate,
	})
	if err != nil {
		t.Fatal(err)
	}
	dimensions, err := services.NewMediaDimensionService(filepath.Join(cacheDir, "derived", "dimensions.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	picks := store.NewPickStore(filepath.Join(cacheDir, "state", "picks.json"))
	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(safetyMiddleware)
	api := app.Group("/api")
	resourceParam := middleware.ResourceParam(catalog, safetyState)
	api.Get("/albums/:id/smart-groups", resourceParam, handlers.SmartAlbumGroupsHandler(smartAlbums, false))
	api.Get("/albums/:id/smart-groups/:groupId/media", resourceParam,
		handlers.SmartAlbumGroupMediaHandler(smartAlbums, catalog, dimensions, picks))

	response, err := app.Test(httptest.NewRequest(http.MethodGet,
		"/api/albums/"+albumID+"/smart-groups?dimension=people", nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var summary struct {
		OK      bool `json:"ok"`
		Summary struct {
			SnapshotKey string `json:"snapshotKey"`
			Groups      []struct {
				ID         string `json:"id"`
				PhotoCount int    `json:"photoCount"`
			} `json:"groups"`
		} `json:"summary"`
	}
	if err := json.NewDecoder(response.Body).Decode(&summary); err != nil {
		t.Fatal(err)
	}
	if response.StatusCode != http.StatusOK || !summary.OK || len(summary.Summary.Groups) != 1 {
		t.Fatalf("people group summary status=%d payload=%+v", response.StatusCode, summary)
	}
	group := summary.Summary.Groups[0]
	if group.PhotoCount != len(files) {
		t.Fatalf("group photo count=%d, want %d", group.PhotoCount, len(files))
	}

	mediaURL := fmt.Sprintf("/api/albums/%s/smart-groups/%s/media?dimension=people&snapshot=%s&limit=200",
		albumID, group.ID, summary.Summary.SnapshotKey)
	mediaResponse, err := app.Test(httptest.NewRequest(http.MethodGet, mediaURL, nil), -1)
	if err != nil {
		t.Fatal(err)
	}
	defer mediaResponse.Body.Close()
	var media struct {
		OK   bool `json:"ok"`
		Page struct {
			Total int `json:"total"`
			Items []struct {
				ID string `json:"id"`
			} `json:"items"`
		} `json:"page"`
	}
	if err := json.NewDecoder(mediaResponse.Body).Decode(&media); err != nil {
		t.Fatal(err)
	}
	if mediaResponse.StatusCode != http.StatusOK || !media.OK || media.Page.Total != len(files) || len(media.Page.Items) != len(files) {
		t.Fatalf("people group media status=%d total=%d items=%d", mediaResponse.StatusCode, media.Page.Total, len(media.Page.Items))
	}
}

func integrationFaceData(t *testing.T) json.RawMessage {
	t.Helper()
	embedding := make([]float32, integrationFaceEmbeddingDimension)
	embedding[0] = 1
	data, err := json.Marshal(struct {
		Faces []struct {
			Box       []float32 `json:"box"`
			Score     float32   `json:"score"`
			Embedding []float32 `json:"embedding"`
		} `json:"faces"`
	}{Faces: []struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}{{Box: []float32{10, 12, 40, 42}, Score: .95, Embedding: embedding}}})
	if err != nil {
		t.Fatal(err)
	}
	return data
}
