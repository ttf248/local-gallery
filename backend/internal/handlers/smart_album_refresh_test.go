package handlers

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

// blockingSweeper 卡在扫描里，让任务停在运行中，方便测复用与取消。
type blockingSweeper struct {
	entered chan struct{}
	release chan struct{}
}

func (s *blockingSweeper) SweepSmartAlbums(
	ctx context.Context,
	force bool,
	progress func(services.SmartAlbumSweepProgress),
) error {
	select {
	case s.entered <- struct{}{}:
	default:
	}
	select {
	case <-s.release:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func newSmartAlbumRefreshApp(sweeper services.SmartAlbumSweeper) *fiber.App {
	service := services.NewSmartAlbumRefreshService(sweeper)
	app := fiber.New()
	app.Post("/api/smart-albums/refresh", SmartAlbumRefreshStartHandler(service))
	app.Get("/api/smart-albums/refresh/active", SmartAlbumRefreshActiveHandler(service))
	app.Get("/api/smart-albums/refresh/:id", SmartAlbumRefreshStatusHandler(service))
	app.Delete("/api/smart-albums/refresh/:id", SmartAlbumRefreshCancelHandler(service))
	return app
}

func TestSmartAlbumRefreshStartHandlerRunsBackgroundTask(t *testing.T) {
	sweeper := &blockingSweeper{entered: make(chan struct{}, 1), release: make(chan struct{})}
	app := newSmartAlbumRefreshApp(sweeper)

	response, err := app.Test(httptest.NewRequest("POST", "/api/smart-albums/refresh", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("POST status=%d", response.StatusCode)
	}
	var payload struct {
		OK     bool   `json:"ok"`
		JobID  string `json:"jobId"`
		Reused bool   `json:"reused"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || payload.JobID == "" || payload.Reused {
		t.Fatalf("POST payload = %+v", payload)
	}
	select {
	case <-sweeper.entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the refresh task never started")
	}

	// 再点一次：复用正在跑的任务，不并发重建。
	second, err := app.Test(httptest.NewRequest("POST", "/api/smart-albums/refresh", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer second.Body.Close()
	var secondPayload struct {
		JobID  string `json:"jobId"`
		Reused bool   `json:"reused"`
	}
	if err := json.NewDecoder(second.Body).Decode(&secondPayload); err != nil {
		t.Fatal(err)
	}
	if !secondPayload.Reused || secondPayload.JobID != payload.JobID {
		t.Fatalf("second POST payload = %+v", secondPayload)
	}

	// 当前任务可以被查到。
	active, err := app.Test(httptest.NewRequest("GET", "/api/smart-albums/refresh/active", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer active.Body.Close()
	if active.StatusCode != fiber.StatusOK {
		t.Fatalf("GET active status=%d", active.StatusCode)
	}
	var activePayload struct {
		OK   bool                               `json:"ok"`
		Task services.SmartAlbumRefreshProgress `json:"task"`
	}
	if err := json.NewDecoder(active.Body).Decode(&activePayload); err != nil {
		t.Fatal(err)
	}
	if !activePayload.OK || activePayload.Task.JobID != payload.JobID {
		t.Fatalf("active payload = %+v", activePayload)
	}

	// 取消后任务结束。
	cancel, err := app.Test(httptest.NewRequest("DELETE", "/api/smart-albums/refresh/"+payload.JobID, nil))
	if err != nil {
		t.Fatal(err)
	}
	defer cancel.Body.Close()
	if cancel.StatusCode != fiber.StatusOK {
		t.Fatalf("DELETE status=%d", cancel.StatusCode)
	}
}

func TestSmartAlbumRefreshStatusHandlerRejectsUnknownTask(t *testing.T) {
	app := newSmartAlbumRefreshApp(&blockingSweeper{entered: make(chan struct{}, 1), release: make(chan struct{})})
	response, err := app.Test(httptest.NewRequest("GET", "/api/smart-albums/refresh/missing", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusNotFound {
		t.Fatalf("GET status=%d, want 404", response.StatusCode)
	}
}

func TestSmartAlbumRefreshActiveHandlerWithoutTask(t *testing.T) {
	app := newSmartAlbumRefreshApp(&blockingSweeper{entered: make(chan struct{}, 1), release: make(chan struct{})})
	response, err := app.Test(httptest.NewRequest("GET", "/api/smart-albums/refresh/active", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		t.Fatalf("GET status=%d, want 200", response.StatusCode)
	}
	var payload struct {
		OK   bool                                `json:"ok"`
		Task *services.SmartAlbumRefreshProgress `json:"task"`
	}
	if err := json.NewDecoder(response.Body).Decode(&payload); err != nil {
		t.Fatal(err)
	}
	if !payload.OK || payload.Task != nil {
		t.Fatalf("payload = %+v", payload)
	}
}

func TestSmartAlbumRefreshStartHandlerRejectsBrokenBody(t *testing.T) {
	app := newSmartAlbumRefreshApp(&blockingSweeper{entered: make(chan struct{}, 1), release: make(chan struct{})})
	request := httptest.NewRequest("POST", "/api/smart-albums/refresh", strings.NewReader("{"))
	response, err := app.Test(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("POST status=%d, want 400", response.StatusCode)
	}
}
