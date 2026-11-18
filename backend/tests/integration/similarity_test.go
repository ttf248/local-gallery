package integration_test

import (
	"bytes"
	"context"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
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

// 相似照片整理的 HTTP 主链路：
// 跑一次本地特征分析 → 拿到分组 → 改人工决定 → 重启后决定仍在。

// integrationSimilarityPattern 造一张有结构的测试图。
func integrationSimilarityPattern(width, height, seed int) image.Image {
	img := image.NewNRGBA(image.Rect(0, 0, width, height))
	for y := 0; y < height; y++ {
		for x := 0; x < width; x++ {
			block := ((x / 23) + (y / 19) + seed) % 6
			value := uint8(30 + block*34)
			if (x+y+seed)%5 == 0 {
				value += 70
			}
			img.SetNRGBA(x, y, color.NRGBA{R: value, G: value/3 + 40, B: 255 - value, A: 255})
		}
	}
	return img
}

// integrationSimilarityJPEG 把测试图写成 JPEG 文件。
func integrationSimilarityJPEG(t *testing.T, path string, img image.Image) {
	t.Helper()
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, img, &jpeg.Options{Quality: 92}); err != nil {
		t.Fatalf("encode %s: %v", path, err)
	}
	if err := os.WriteFile(path, buffer.Bytes(), 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func TestSimilarityGroupsAndDecisionsSurviveRestart(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "photos")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	// 两张内容完全一致的照片，加上一张完全不同的照片。
	original := integrationSimilarityPattern(320, 240, 0)
	duplicate := filepath.Join(albumPath, "a.jpg")
	integrationSimilarityJPEG(t, duplicate, original)
	integrationSimilarityJPEG(t, filepath.Join(albumPath, "b.jpg"), original)
	integrationSimilarityJPEG(t, filepath.Join(albumPath, "c.jpg"), integrationSimilarityPattern(320, 240, 5))

	catalog := services.NewResourceCatalog()
	catalog.SetContentKindPolicy(services.NewContentKindPolicy([]services.RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: albumPath, SourceRoot: root,
			ImageFiles: []string{
				filepath.Join(albumPath, "a.jpg"),
				filepath.Join(albumPath, "b.jpg"),
				filepath.Join(albumPath, "c.jpg"),
			},
			ImageCount: 3,
		}},
	}, []string{root})

	cacheDir := t.TempDir()
	safetyMiddleware, safetyState := middleware.PathSafetyMiddleware([]string{root})
	var similarity *services.SimilarityService
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:   filepath.Join(cacheDir, "state", "jobs.json"),
		MetadataDir: filepath.Join(cacheDir, "derived", "metadata"),
		Catalog:     catalog, ValidatePath: safetyState.Validate, WorkerCount: 1,
		Analyzers: []services.AIAnalyzer{services.MetadataAnalyzer{}, services.SimilarityAnalyzer{}},
		OnRecordsCommitted: func(records []services.AIAnalysisRecord) {
			if similarity != nil {
				similarity.ApplyRecords(records)
			}
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
	picks := store.NewPickStore(filepath.Join(cacheDir, "state", "picks.json"))
	similarity, err = services.OpenSimilarityService(services.SimilarityServiceOptions{
		StatePath:   filepath.Join(cacheDir, "state", "similarity.json"),
		DerivedPath: filepath.Join(cacheDir, "derived", "similarity", "groups.json"),
		Catalog:     catalog, Jobs: jobs, Picks: picks,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(similarity.Close)

	app := fiber.New(fiber.Config{DisableStartupMessage: true})
	app.Use(safetyMiddleware)
	api := app.Group("/api")
	api.Get("/similarity/status", handlers.SimilarityStatusHandler(similarity))
	api.Get("/similarity/groups", handlers.SimilarityGroupsHandler(similarity))
	api.Put("/similarity/groups/:id", handlers.SimilarityGroupUpdateHandler(similarity))
	api.Post("/similarity/batch", handlers.SimilarityBatchHandler(similarity))

	// 跑一次特征分析：这一模块是纯 Go 的，不需要本机 AI 环境。
	job, _, err := jobs.Start(services.AIJobTypeSimilarity, services.AIJobModeFull)
	if err != nil {
		t.Fatal(err)
	}
	waitForIntegrationJob(t, jobs, job.ID)

	// 分组是后台算的，等它落盘。
	deadline := time.Now().Add(10 * time.Second)
	var page similarityGroupPage
	for {
		page = readSimilarityGroups(t, app, "")
		if page.Page.Total > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("similarity groups were never produced")
		}
		time.Sleep(20 * time.Millisecond)
	}

	var exact similarityGroup
	for _, group := range page.Page.Groups {
		if group.Kind == "exact" {
			exact = group
		}
	}
	if exact.ID == "" {
		t.Fatalf("expected an exact duplicate group, got %+v", page.Page.Groups)
	}
	if len(exact.Members) != 2 {
		t.Fatalf("exact group should hold 2 members, got %d", len(exact.Members))
	}
	if exact.Recommended == "" {
		t.Fatal("the group should carry a recommended representative")
	}
	if exact.Folder == "" {
		t.Fatal("the group should carry a folder label")
	}

	// 手动换代表 + 标记已看过。
	other := ""
	for _, member := range exact.Members {
		if member.ResourceID != exact.Recommended {
			other = member.ResourceID
		}
	}
	updateSimilarityGroup(t, app, exact.ID, map[string]any{"representative": other, "reviewed": true})

	// 批量加入精选：代表照片应当进入现有的照片级精选。
	changed := postSimilarityBatch(t, app, "pick", []string{exact.ID})
	if changed != 1 {
		t.Fatalf("pick action should add one photo, got %d", changed)
	}
	if len(picks.Get()) != 1 {
		t.Fatalf("picks should hold one photo, got %d", len(picks.Get()))
	}

	// 重启服务：人工决定必须还在。
	reopened, err := services.OpenSimilarityService(services.SimilarityServiceOptions{
		StatePath:   filepath.Join(cacheDir, "state", "similarity.json"),
		DerivedPath: filepath.Join(cacheDir, "derived", "similarity", "groups.json"),
		Catalog:     catalog, Jobs: jobs, Picks: picks,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	restored := reopened.Groups(services.SimilarityGroupFilter{Kind: "exact"})
	if restored.Total != 1 {
		t.Fatalf("expected 1 restored group, got %d", restored.Total)
	}
	if restored.Groups[0].Status != services.SimilarityStatusReviewed {
		t.Fatalf("group status = %q, want reviewed", restored.Groups[0].Status)
	}
	if restored.Groups[0].Representative != other {
		t.Fatalf("group representative = %q, want %q", restored.Groups[0].Representative, other)
	}
	if !restored.Groups[0].RepresentativeIsManual {
		t.Fatal("the restored representative should be marked as manually chosen")
	}
}

// similarityGroupPage 是分组接口的返回结构。
type similarityGroupPage struct {
	OK   bool `json:"ok"`
	Page struct {
		Total  int               `json:"total"`
		Groups []similarityGroup `json:"groups"`
	} `json:"page"`
}

type similarityGroup struct {
	ID                     string `json:"id"`
	Kind                   string `json:"kind"`
	Folder                 string `json:"folder"`
	Recommended            string `json:"recommended"`
	Representative         string `json:"representative"`
	RepresentativeIsManual bool   `json:"representativeIsManual"`
	Status                 string `json:"status"`
	Members                []struct {
		ResourceID string `json:"resourceId"`
	} `json:"members"`
}

func readSimilarityGroups(t *testing.T, app *fiber.App, query string) similarityGroupPage {
	t.Helper()
	request := httptest.NewRequest(http.MethodGet, "/api/similarity/groups"+query, nil)
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	var page similarityGroupPage
	if err := json.NewDecoder(response.Body).Decode(&page); err != nil {
		t.Fatal(err)
	}
	return page
}

func updateSimilarityGroup(t *testing.T, app *fiber.App, id string, body map[string]any) {
	t.Helper()
	payload, err := json.Marshal(body)
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/similarity/groups/"+id, bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
}

func postSimilarityBatch(t *testing.T, app *fiber.App, action string, ids []string) int {
	t.Helper()
	payload, err := json.Marshal(map[string]any{"action": action, "groupIds": ids})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/similarity/batch", bytes.NewReader(payload))
	request.Header.Set("Content-Type", "application/json")
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(response.Body)
		t.Fatalf("status = %d, body = %s", response.StatusCode, body)
	}
	var result struct {
		Changed int `json:"changed"`
	}
	if err := json.NewDecoder(response.Body).Decode(&result); err != nil {
		t.Fatal(err)
	}
	return result.Changed
}

func waitForIntegrationJob(t *testing.T, jobs *services.AIJobService, id string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for {
		current, exists := jobs.Get(id)
		if !exists {
			t.Fatal("analysis job disappeared")
		}
		switch current.Status {
		case services.AIJobStatusCompleted:
			return
		case services.AIJobStatusFailed, services.AIJobStatusCancelled:
			t.Fatalf("analysis job ended as %s: %+v", current.Status, current)
		}
		if time.Now().After(deadline) {
			t.Fatalf("analysis job did not finish: %+v", current)
		}
		time.Sleep(20 * time.Millisecond)
	}
}
