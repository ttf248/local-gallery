package services

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeSweeper 是可控的分组扫描替身：任务本身（进度、取消、状态）与
// 分组算法分开测。
type fakeSweeper struct {
	mu       sync.Mutex
	calls    int
	forces   []bool
	block    chan struct{}
	entered  chan struct{}
	failWith error
	steps    []SmartAlbumSweepProgress
}

func (f *fakeSweeper) SweepSmartAlbums(
	ctx context.Context,
	force bool,
	progress func(SmartAlbumSweepProgress),
) error {
	f.mu.Lock()
	f.calls++
	f.forces = append(f.forces, force)
	f.mu.Unlock()
	if f.entered != nil {
		select {
		case f.entered <- struct{}{}:
		default:
		}
	}
	if f.block != nil {
		select {
		case <-f.block:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	if f.failWith != nil {
		return f.failWith
	}
	for _, step := range f.steps {
		if err := ctx.Err(); err != nil {
			return err
		}
		if progress != nil {
			progress(step)
		}
	}
	return nil
}

func (f *fakeSweeper) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

func waitForRefreshStatus(
	t *testing.T,
	service *SmartAlbumRefreshService,
	id string,
	want SmartAlbumRefreshStatus,
) SmartAlbumRefreshProgress {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		progress, ok := service.Status(id)
		if ok && progress.Status == want {
			return progress
		}
		time.Sleep(5 * time.Millisecond)
	}
	progress, _ := service.Status(id)
	t.Fatalf("smart album refresh did not reach %s: %+v", want, progress)
	return SmartAlbumRefreshProgress{}
}

func TestSmartAlbumRefreshServiceReportsProgress(t *testing.T) {
	sweeper := &fakeSweeper{steps: []SmartAlbumSweepProgress{
		{Albums: 1, Total: 4, Completed: 1, Rebuilt: 1, Groups: 3, AlbumID: "a_1", AlbumName: "旅行", Dimension: SmartAlbumDimensionTime},
		{Albums: 1, Total: 4, Completed: 2, Rebuilt: 1, Reused: 1, Groups: 5, AlbumID: "a_1", AlbumName: "旅行", Dimension: SmartAlbumDimensionPlace},
	}}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	id, reused, err := service.Start(false)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if reused {
		t.Fatal("first Start() reused a task that was not running")
	}
	progress := waitForRefreshStatus(t, service, id, SmartAlbumRefreshStatusComplete)
	if progress.Albums != 1 || progress.Total != 4 || progress.Done != 2 {
		t.Fatalf("progress = %+v", progress)
	}
	if progress.Rebuilt != 1 || progress.Reused != 1 || progress.Groups != 5 {
		t.Fatalf("progress counts = %+v", progress)
	}
	if progress.CurrentAlbumName != "旅行" || progress.CurrentDimension != SmartAlbumDimensionPlace {
		t.Fatalf("progress current = %+v", progress)
	}
	if sweeper.callCount() != 1 {
		t.Fatalf("sweeper calls = %d, want 1", sweeper.callCount())
	}
}

func TestSmartAlbumRefreshServiceReusesRunningTask(t *testing.T) {
	block := make(chan struct{})
	entered := make(chan struct{}, 1)
	sweeper := &fakeSweeper{block: block, entered: entered}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	id, _, err := service.Start(true)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	select {
	case <-entered:
	case <-time.After(3 * time.Second):
		t.Fatal("the refresh task never entered the sweep")
	}
	reusedID, reused, err := service.Start(false)
	if err != nil {
		t.Fatalf("second Start() error = %v", err)
	}
	if !reused || reusedID != id {
		t.Fatalf("second Start() = %q reused=%v, want %q reused=true", reusedID, reused, id)
	}
	if sweeper.callCount() != 1 {
		t.Fatalf("sweeper calls = %d, want 1", sweeper.callCount())
	}
	close(block)
	waitForRefreshStatus(t, service, id, SmartAlbumRefreshStatusComplete)
	sweeper.mu.Lock()
	forces := append([]bool(nil), sweeper.forces...)
	sweeper.mu.Unlock()
	if len(forces) != 1 || !forces[0] {
		t.Fatalf("sweeper force flags = %v, want [true]", forces)
	}
}

func TestSmartAlbumRefreshServiceCancel(t *testing.T) {
	block := make(chan struct{})
	sweeper := &fakeSweeper{block: block}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	id, _, err := service.Start(false)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	if !service.Cancel(id) {
		t.Fatal("Cancel() reported no running task")
	}
	progress := waitForRefreshStatus(t, service, id, SmartAlbumRefreshStatusCancelled)
	if progress.Error != "" {
		t.Fatalf("cancelled task carries an error code: %+v", progress)
	}
	if service.Cancel(id) {
		t.Fatal("Cancel() succeeded on a finished task")
	}
}

func TestSmartAlbumRefreshServiceRunWaitsForResult(t *testing.T) {
	sweeper := &fakeSweeper{steps: []SmartAlbumSweepProgress{
		{Albums: 1, Total: 4, Completed: 4, Rebuilt: 4, Groups: 6},
	}}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	if err := service.Run(context.Background(), false); err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if sweeper.callCount() != 1 {
		t.Fatalf("sweeper calls = %d, want 1", sweeper.callCount())
	}
}

func TestSmartAlbumRefreshServiceRunReportsFailureCode(t *testing.T) {
	sweeper := &fakeSweeper{failWith: ErrLibraryNotReady}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	err := service.Run(context.Background(), false)
	if err == nil || err.Error() != "library_not_ready" {
		t.Fatalf("Run() error = %v, want library_not_ready", err)
	}
}

func TestSmartAlbumRefreshServiceActiveTracksRunningTask(t *testing.T) {
	block := make(chan struct{})
	sweeper := &fakeSweeper{block: block}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	if _, ok := service.Active(); ok {
		t.Fatal("Active() reported a task before any start")
	}
	id, _, err := service.Start(false)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	active, ok := service.Active()
	if !ok || active.JobID != id {
		t.Fatalf("Active() = %+v ok=%v", active, ok)
	}
	close(block)
	waitForRefreshStatus(t, service, id, SmartAlbumRefreshStatusComplete)
}

func TestSmartAlbumRefreshServiceCloseStopsAcceptingWork(t *testing.T) {
	service := NewSmartAlbumRefreshService(&fakeSweeper{})
	service.Close()
	if _, _, err := service.Start(false); err == nil {
		t.Fatal("Start() succeeded after Close()")
	}
}

func TestSmartAlbumRefreshServiceWithoutSweeperFails(t *testing.T) {
	service := NewSmartAlbumRefreshService(nil)
	defer service.Close()
	if _, _, err := service.Start(false); err == nil {
		t.Fatal("Start() succeeded without a sweeper")
	}
}

func TestSmartAlbumRefreshServiceSubscribeStreamsProgress(t *testing.T) {
	sweeper := &fakeSweeper{steps: []SmartAlbumSweepProgress{
		{Albums: 1, Total: 4, Completed: 1, Rebuilt: 1},
	}}
	service := NewSmartAlbumRefreshService(sweeper)
	defer service.Close()

	id, _, err := service.Start(false)
	if err != nil {
		t.Fatalf("Start() error = %v", err)
	}
	events, unsubscribe, ok := service.Subscribe(id)
	if !ok {
		t.Fatal("Subscribe() did not find the task")
	}
	defer unsubscribe()
	waitForRefreshStatus(t, service, id, SmartAlbumRefreshStatusComplete)
	sawComplete := false
	for event := range events {
		if event.Status == SmartAlbumRefreshStatusComplete {
			sawComplete = true
		}
	}
	if !sawComplete {
		t.Fatal("subscription never reported the completed status")
	}
}

func TestSmartAlbumRefreshErrorCodeHidesInternalDetails(t *testing.T) {
	if code := smartAlbumRefreshErrorCode(errors.New("persist cache: open C:/secret/path.json")); code != "smart_album_failed" {
		t.Fatalf("error code = %q", code)
	}
	if code := smartAlbumRefreshErrorCode(ErrLibraryNotReady); code != "library_not_ready" {
		t.Fatalf("error code = %q", code)
	}
}
