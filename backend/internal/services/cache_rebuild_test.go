package services

import (
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// rebuildFixture 造一个只有一个相册、几张图的小库。
func rebuildFixture(t *testing.T) (*ResourceCatalog, []string) {
	t.Helper()
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := make([]string, 0, 3)
	for i := 0; i < 3; i++ {
		name := "page.jpg"
		if i > 0 {
			name = string(rune('a'+i)) + ".jpg"
		}
		files = append(files, makeTestImage(t, albumPath, name, 640, 480))
	}
	catalog := NewResourceCatalog()
	catalog.Publish(&models.ScanResult{
		Roots: []string{root},
		Albums: []models.Album{{
			Type:       "album",
			Path:       albumPath,
			SourceRoot: root,
			ImageFiles: files,
			CoverImage: files[0],
		}},
	}, []string{root})
	return catalog, files
}

func newRebuildService(t *testing.T) (*CacheRebuildService, *ThumbnailService, []string) {
	t.Helper()
	catalog, files := rebuildFixture(t)
	thumbs, err := NewThumbnailService(ThumbnailOptions{CacheDir: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	return NewCacheRebuildService(catalog, thumbs), thumbs, files
}

// 重建跑完后，缩略图与预览图都应该落到磁盘上。
func TestCacheRebuildGeneratesRenditions(t *testing.T) {
	svc, thumbs, files := newRebuildService(t)

	jobID, reused, err := svc.Start([]string{CacheScopeThumbs, CacheScopePreviews}, DefaultRebuildPreviewWidth)
	if err != nil {
		t.Fatal(err)
	}
	if reused {
		t.Fatal("first start should not reuse a job")
	}
	waitForRebuild(t, svc, jobID, RebuildStatusComplete)

	entries, err := os.ReadDir(thumbs.cacheDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) == 0 {
		t.Fatal("rebuild should have written thumbnail renditions")
	}
	previews, err := os.ReadDir(thumbs.previewDir)
	if err != nil {
		t.Fatal(err)
	}
	if len(previews) == 0 {
		t.Fatal("rebuild should have written preview renditions")
	}
	_ = files
}

// 进度要能一路涨到总数，进度是界面上的唯一反馈。
func TestCacheRebuildReportsProgress(t *testing.T) {
	svc, _, _ := newRebuildService(t)
	jobID, _, err := svc.Start([]string{CacheScopeThumbs}, 0)
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe, ok := svc.Subscribe(jobID)
	if !ok {
		t.Fatal("subscribe should succeed")
	}
	defer unsubscribe()

	deadline := time.After(20 * time.Second)
	for {
		select {
		case ev, open := <-events:
			if !open {
				t.Fatal("event stream closed before terminal state")
			}
			if ev.Status == RebuildStatusComplete {
				if ev.Total != 3 {
					t.Errorf("total = %d, want 3", ev.Total)
				}
				if ev.Done != ev.Total {
					t.Errorf("done = %d, want %d", ev.Done, ev.Total)
				}
				return
			}
		case <-deadline:
			t.Fatal("rebuild did not finish in time")
		}
	}
}

// 重建跑的过程中要持续推进度：进度条十分钟不动，用户只会以为卡死了。
func TestCacheRebuildStreamsProgressWhileRunning(t *testing.T) {
	svc, thumbs, files := newRebuildService(t)
	t.Cleanup(svc.Close)
	// 占住解码槽，确保订阅者看到定时推送时，真实缩略图任务仍在运行。
	thumbs.imageSlots = make(chan struct{}, 1)
	thumbs.imageSlots <- struct{}{}
	release := sync.OnceFunc(func() { <-thumbs.imageSlots })
	defer release()
	svc.progressInterval = 10 * time.Millisecond
	jobID, _, err := svc.Start([]string{CacheScopeThumbs}, 0)
	if err != nil {
		t.Fatal(err)
	}
	events, unsubscribe, ok := svc.Subscribe(jobID)
	if !ok {
		t.Fatal("subscribe should succeed")
	}
	defer unsubscribe()

	running := 0
	deadline := time.After(20 * time.Second)
	for {
		select {
		case ev, open := <-events:
			if !open {
				t.Fatal("event stream closed before terminal state")
			}
			if ev.Status == RebuildStatusPending || ev.Status == RebuildStatusRunning {
				if ev.Status == RebuildStatusRunning && ev.Total == len(files) && ev.Done == 0 {
					running++
					// 初始订阅和设置总数各至多发一条，第三条一定来自定时推送。
					if running == 3 {
						release()
					}
				}
				continue
			}
			if running < 3 || ev.Status != RebuildStatusComplete || ev.Done != len(files) || ev.Failed != 0 {
				t.Fatalf("unexpected progress: running events = %d, terminal = %+v", running, ev)
			}
			return
		case <-deadline:
			t.Fatal("rebuild did not finish in time")
		}
	}
}

// 取消要真的停：任务落到 cancelled 终态。
func TestCacheRebuildCancel(t *testing.T) {
	svc, _, _ := newRebuildService(t)
	jobID, _, err := svc.Start([]string{CacheScopeThumbs, CacheScopePreviews}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !svc.Cancel(jobID) {
		// 任务可能已经跑完（样例很小），这不算失败。
		if progress, ok := svc.Status(jobID); !ok || progress.Status != RebuildStatusComplete {
			t.Fatal("cancel should succeed for a running job")
		}
		return
	}
	waitForRebuild(t, svc, jobID, RebuildStatusCancelled)
}

// 同一个进程里只跑一个任务：第二次开始会复用第一个。
func TestCacheRebuildReusesRunningJob(t *testing.T) {
	svc, _, _ := newRebuildService(t)
	first, _, err := svc.Start([]string{CacheScopeThumbs}, 0)
	if err != nil {
		t.Fatal(err)
	}
	second, reused, err := svc.Start([]string{CacheScopePreviews}, 0)
	if err != nil {
		t.Fatal(err)
	}
	if !reused || second != first {
		t.Fatalf("second start = (%q,%v), want reuse of %q", second, reused, first)
	}
	waitForRebuild(t, svc, first, RebuildStatusComplete)
}

// 未知范围要报错，而不是悄悄什么都不做。
func TestCacheRebuildRejectsUnknownScope(t *testing.T) {
	svc, _, _ := newRebuildService(t)
	if _, _, err := svc.Start([]string{"transcode"}, 0); err == nil {
		t.Fatal("unknown scope should be rejected")
	}
	if _, _, err := svc.Start(nil, 0); err == nil {
		t.Fatal("empty scope should be rejected")
	}
}

func waitForRebuild(t *testing.T, svc *CacheRebuildService, jobID string, want CacheRebuildStatus) {
	t.Helper()
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) {
		progress, ok := svc.Status(jobID)
		if ok && progress.Status == want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	progress, _ := svc.Status(jobID)
	t.Fatalf("rebuild status = %q, want %q", progress.Status, want)
}
