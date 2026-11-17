package integration_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/handlers"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

type integrationSelectableFaceAnalyzer struct{}

func (integrationSelectableFaceAnalyzer) Type() string    { return services.AIJobTypeFace }
func (integrationSelectableFaceAnalyzer) Version() string { return services.FaceAnalyzerVersion }
func (integrationSelectableFaceAnalyzer) VersionForModel(model string) (string, bool) {
	return services.FaceAnalyzerVersionForModel(model)
}
func (integrationSelectableFaceAnalyzer) Available() (bool, string) { return true, "" }
func (integrationSelectableFaceAnalyzer) AvailableForModel(model string) (bool, string) {
	_, valid := services.FaceAnalyzerVersionForModel(model)
	return valid, ""
}
func (integrationSelectableFaceAnalyzer) Ready(context.Context) error { return nil }
func (integrationSelectableFaceAnalyzer) ReadyForModel(context.Context, string) error {
	return nil
}
func (integrationSelectableFaceAnalyzer) Analyze(context.Context, io.ReadSeeker) (services.AIAnalysisOutput, error) {
	embedding := make([]float32, 512)
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
		return services.AIAnalysisOutput{}, err
	}
	return services.AIAnalysisOutput{
		Status: "faces_found", Data: data, Fields: []string{services.AIFieldFaces},
	}, nil
}

// 通过任务模型 API 切到 Buffalo_m 后启动分析，验证任务版本与人物索引使用同一特征空间。
func TestFaceModelSelectionFlowsThroughJobAndPeopleIndex(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "photos")
	photo := filepath.Join(albumPath, "photo.png")
	writePNG(t, photo, 200, 300)
	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: albumPath, SourceRoot: root,
			ImageFiles: []string{photo}, ImageCount: 1,
		}},
	}, []string{root})

	cache := t.TempDir()
	people, err := services.OpenPeopleService(
		filepath.Join(cache, "state", "people.json"),
		filepath.Join(cache, "derived", "people-index.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	callbackErrors := make(chan error, 1)
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:   filepath.Join(cache, "state", "ai_jobs.json"),
		MetadataDir: filepath.Join(cache, "derived", "metadata"),
		Catalog:     catalog,
		ValidatePath: func(path string) (string, error) {
			return path, nil
		},
		Analyzers: []services.AIAnalyzer{
			services.MetadataAnalyzer{}, integrationSelectableFaceAnalyzer{},
		},
		OnRecordsCommitted: func(records []services.AIAnalysisRecord) {
			if err := people.ApplyRecords(records); err != nil {
				callbackErrors <- err
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := jobs.Shutdown(ctx); err != nil {
			t.Errorf("shutdown AI jobs: %v", err)
		}
	})
	if _, err := jobs.SetPeopleEnabled(true); err != nil {
		t.Fatal(err)
	}
	if _, err := jobs.SetGPUEnabled(false); err != nil {
		t.Fatal(err)
	}

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Put("/api/ai/jobs/face-model", handlers.AIJobFaceModelHandler(jobs, people))
	app.Post("/api/ai/jobs", handlers.AIJobStartHandler(jobs))
	app.Post("/api/people/matches/retain", handlers.PeopleMatchRetentionHandler(people))
	modelRequest := httptest.NewRequest(http.MethodPut, "/api/ai/jobs/face-model", strings.NewReader(`{"model":"buffalo_m"}`))
	modelRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	modelResponse, err := app.Test(modelRequest, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer modelResponse.Body.Close()
	if modelResponse.StatusCode != http.StatusOK || jobs.FaceModel() != services.FaceModelBuffaloM {
		body, _ := io.ReadAll(modelResponse.Body)
		t.Fatalf("model selection response = %d %s; selected model = %q", modelResponse.StatusCode, body, jobs.FaceModel())
	}

	startRequest := httptest.NewRequest(http.MethodPost, "/api/ai/jobs", strings.NewReader(`{"type":"face","mode":"full"}`))
	startRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	startResponse, err := app.Test(startRequest, -1)
	if err != nil {
		t.Fatal(err)
	}
	var started struct {
		OK  bool           `json:"ok"`
		Job services.AIJob `json:"job"`
	}
	if err := json.NewDecoder(startResponse.Body).Decode(&started); err != nil {
		startResponse.Body.Close()
		t.Fatal(err)
	}
	startResponse.Body.Close()
	if startResponse.StatusCode != http.StatusOK || !started.OK ||
		started.Job.FaceModel != services.FaceModelBuffaloM ||
		started.Job.ModuleVersion != services.FaceAnalyzerBuffaloMVersion {
		t.Fatalf("started face job did not capture Buffalo_m: status=%d job=%+v", startResponse.StatusCode, started.Job)
	}

	deadline := time.Now().Add(5 * time.Second)
	for {
		current, exists := jobs.Get(started.Job.ID)
		if !exists {
			t.Fatal("face job disappeared")
		}
		if current.Status == services.AIJobStatusCompleted {
			break
		}
		if current.Status == services.AIJobStatusFailed || time.Now().After(deadline) {
			t.Fatalf("Buffalo_m integration job did not complete: %+v", current)
		}
		time.Sleep(10 * time.Millisecond)
	}
	select {
	case err := <-callbackErrors:
		t.Fatalf("publish Buffalo_m people index: %v", err)
	default:
	}

	resourceID := catalog.ExternalID(photo, services.ResourceFile)
	record, exists := jobs.Record(services.AIJobTypeFace, resourceID)
	if !exists || record.ModuleVersion != services.FaceAnalyzerBuffaloMVersion {
		t.Fatalf("stored face record = %+v, exists=%v", record, exists)
	}
	groups := people.Groups(false)
	if len(groups) != 1 || groups[0].FaceCount != 1 || groups[0].PhotoCount != 1 {
		t.Fatalf("Buffalo_m people index = %+v", groups)
	}
	retainRequest := httptest.NewRequest(http.MethodPost, "/api/people/matches/retain", strings.NewReader(`{"personId":"`+groups[0].ID+`"}`))
	retainRequest.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	retainResponse, err := app.Test(retainRequest, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer retainResponse.Body.Close()
	if retainResponse.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(retainResponse.Body)
		t.Fatalf("retain person response = %d %s", retainResponse.StatusCode, body)
	}
	reopenedPeople, err := services.OpenPeopleService(
		filepath.Join(cache, "state", "people.json"),
		filepath.Join(cache, "derived", "people-index.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := reopenedPeople.SetFaceAnalyzerVersion(services.FaceAnalyzerBuffaloMVersion); err != nil {
		t.Fatal(err)
	}
	if err := reopenedPeople.Sync([]services.AIAnalysisRecord{record}); err != nil {
		t.Fatal(err)
	}
	reopenedGroups := reopenedPeople.Groups(false)
	if len(reopenedGroups) != 1 || !reopenedGroups[0].Confirmed || reopenedGroups[0].ID != groups[0].ID {
		t.Fatalf("retained Buffalo_m correction was not durable: %+v", reopenedGroups)
	}
}
