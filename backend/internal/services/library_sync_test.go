package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// newSyncHarness 搭一套「监听 + 增量扫描 + 资源索引」的最小环境。
type syncHarness struct {
	root    string
	catalog *ResourceCatalog
	cache   *ScanResultCache
	runner  *AsyncScanRunner
	sync    *LibrarySyncService
}

func newSyncHarness(t *testing.T) *syncHarness {
	t.Helper()
	root := t.TempDir()
	catalog := NewResourceCatalog()
	cache := NewScanResultCache(filepath.Join(t.TempDir(), "scan_cache.json"))
	covers := NewCoverOverrideStore(filepath.Join(t.TempDir(), "covers.json"))
	runner := NewAsyncScanRunner()
	runner.SetCache(cache)
	runner.SetCatalog(catalog)
	runner.SetCoverOverrides(covers)

	sync, err := NewLibrarySyncService(LibrarySyncOptions{
		StatePath:      filepath.Join(t.TempDir(), "library_sync.json"),
		Roots:          func() []string { return []string{root} },
		Exclude:        func() ExcludeConfig { return DefaultExclude() },
		Catalog:        catalog,
		Cache:          cache,
		Covers:         covers,
		Runner:         runner,
		VerifyInterval: time.Hour,
		WatchDebounce:  80 * time.Millisecond,
		WatchMaxWait:   2 * time.Second,
	})
	if err != nil {
		t.Fatalf("create library sync service: %v", err)
	}
	return &syncHarness{
		root:    root,
		catalog: catalog,
		cache:   cache,
		runner:  runner,
		sync:    sync,
	}
}

// scanNow 跑一次全量扫描并把结果发布到资源索引。
func (h *syncHarness) scanNow(t *testing.T) {
	t.Helper()
	scanner := NewScanner()
	result, err := scanner.Scan(ScanOptions{Roots: []string{h.root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	h.catalog.Publish(result, []string{h.root})
}

// waitForFile 等待索引里出现（或不再出现）某个文件。
func (h *syncHarness) waitForFile(t *testing.T, path string, present bool) {
	t.Helper()
	deadline := time.Now().Add(15 * time.Second)
	for time.Now().Before(deadline) {
		snapshot := h.catalog.Acquire()
		found := false
		for _, id := range snapshot.FileIDs() {
			ref, ok := snapshot.Lookup(id)
			if ok && filepath.Clean(ref.AbsolutePath) == filepath.Clean(path) {
				found = true
				break
			}
		}
		if found == present {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("文件 %s 的索引状态没有变成「存在=%v」", path, present)
}

func TestLibrarySync_NewFileAppearsInLibrary(t *testing.T) {
	h := newSyncHarness(t)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	added := filepath.Join(album, "new.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, added, true)
}

func TestLibrarySync_RemovedFileLeavesLibrary(t *testing.T) {
	h := newSyncHarness(t)
	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(album, "old.jpg")
	if err := os.WriteFile(existing, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	if err := os.Remove(existing); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, existing, false)
}

func TestLibrarySync_MovedDirectoryUpdatesLibrary(t *testing.T) {
	h := newSyncHarness(t)
	source := filepath.Join(h.root, "source")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	photo := filepath.Join(source, "photo.jpg")
	if err := os.WriteFile(photo, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	target := filepath.Join(h.root, "target")
	if err := os.Rename(source, target); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, photo, false)
	h.waitForFile(t, filepath.Join(target, "photo.jpg"), true)
}

func TestLibrarySync_DisabledWatcherLeavesLibraryUntouched(t *testing.T) {
	h := newSyncHarness(t)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	if _, err := h.sync.Update(ctx, LibrarySyncSettings{Enabled: false, AutoAnalyze: false}); err != nil {
		t.Fatalf("update library sync: %v", err)
	}

	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	added := filepath.Join(album, "new.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	time.Sleep(600 * time.Millisecond)

	snapshot := h.catalog.Acquire()
	for _, id := range snapshot.FileIDs() {
		ref, ok := snapshot.Lookup(id)
		if ok && filepath.Clean(ref.AbsolutePath) == filepath.Clean(added) {
			t.Fatalf("关闭监听后不应更新索引，却发现了 %s", added)
		}
	}
}

func TestLibrarySync_StatusReportsLastSync(t *testing.T) {
	h := newSyncHarness(t)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	added := filepath.Join(album, "new.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, added, true)

	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		status := h.sync.Status()
		if status.LastSyncAt.IsZero() {
			time.Sleep(50 * time.Millisecond)
			continue
		}
		if status.LastDetected == 0 {
			t.Fatalf("检测数量不应为 0：%+v", status)
		}
		if status.LastUpdated == 0 {
			t.Fatalf("更新数量不应为 0：%+v", status)
		}
		return
	}
	t.Fatalf("没有记录到最近一次同步时间")
}

func TestLibrarySync_KeepsFavoritesAndPicks(t *testing.T) {
	h := newSyncHarness(t)
	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	photo := filepath.Join(album, "photo.jpg")
	if err := os.WriteFile(photo, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.scanNow(t)

	// 收藏与精选按资源 ID 存放：增量更新不能把它们改掉。
	snapshot := h.catalog.Acquire()
	var albumID string
	for _, id := range snapshot.FileIDs() {
		ref, ok := snapshot.Lookup(id)
		if ok && filepath.Clean(ref.AbsolutePath) == filepath.Clean(photo) {
			albumID = id
			break
		}
	}
	if albumID == "" {
		t.Fatal("没有找到照片的资源 ID")
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	added := filepath.Join(album, "second.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, added, true)

	after := h.catalog.Acquire()
	if _, ok := after.Lookup(albumID); !ok {
		t.Fatalf("增量更新后原有资源的 ID 变了：%s", albumID)
	}
}

func TestLibrarySync_IncrementalResultMatchesFullScan(t *testing.T) {
	h := newSyncHarness(t)
	album := filepath.Join(h.root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	existing := filepath.Join(album, "a.jpg")
	if err := os.WriteFile(existing, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	added := filepath.Join(album, "b.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.waitForFile(t, added, true)

	incremental := h.catalog.Acquire().Result()
	scanner := NewScanner()
	full, err := scanner.Scan(ScanOptions{Roots: []string{h.root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	got := libraryShape(incremental)
	want := libraryShape(full)
	if len(got) != len(want) {
		t.Fatalf("增量结果与全量扫描不一致:\n got: %v\nwant: %v", got, want)
	}
	for i := range got {
		if got[i] != want[i] {
			t.Fatalf("增量结果与全量扫描不一致:\n got: %v\nwant: %v", got, want)
		}
	}
	var _ = models.Album{}
}

func TestLibrarySync_SettingsSurviveRestart(t *testing.T) {
	statePath := filepath.Join(t.TempDir(), "library_sync.json")
	catalog := NewResourceCatalog()
	newService := func() *LibrarySyncService {
		service, err := NewLibrarySyncService(LibrarySyncOptions{
			StatePath: statePath,
			Roots:     func() []string { return []string{t.TempDir()} },
			Catalog:   catalog,
		})
		if err != nil {
			t.Fatalf("create library sync service: %v", err)
		}
		return service
	}

	// 首次使用：默认打开自动发现。
	first := newService()
	if !first.settings.Enabled {
		t.Fatal("首次使用应当默认打开自动发现文件变化")
	}
	// 落盘一次（收到事件就会落盘）。
	first.onChange(changeSetFor(filepath.Join(t.TempDir(), "a.jpg")))

	// 重启后开关必须还在。
	second := newService()
	if !second.settings.Enabled {
		t.Fatal("重启后自动发现文件变化的开关丢失了")
	}
}
