package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// TestChangeWatcher_HighFrequencyWritesAreAllReported 验证连续写入时
// 监听器既不丢事件也不崩。
//
// 之前批次在提交前是被事件处理与提交逻辑共享同一张表的：一边遍历
// 「哪些文件变了」，一边往里写。高频写入时会撞上
// "fatal error: concurrent map iteration and map write"，
// 整个进程就此退出。
//
// 这个用例要配合 `go test -race` 跑：竞态检测器能把没撞上崩溃窗口的
// 那次并发也抓出来。
func TestChangeWatcher_HighFrequencyWritesAreAllReported(t *testing.T) {
	root := t.TempDir()
	batches := make(chan *SyncChangeSet, 64)
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     time.Millisecond,
		MaxWait:      50 * time.Millisecond,
		MaxWatchDirs: 100,
		OnChange: func(changes *SyncChangeSet) {
			select {
			case batches <- changes:
			default:
			}
		},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	const total = 300
	for i := 0; i < total; i++ {
		path := filepath.Join(album, fmt.Sprintf("f%03d.jpg", i))
		if err := os.WriteFile(path, []byte("image"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]struct{}{}
	deadline := time.Now().Add(20 * time.Second)
	for time.Now().Before(deadline) && len(seen) < total {
		select {
		case batch := <-batches:
			for file := range batch.Files {
				seen[file] = struct{}{}
			}
		case <-time.After(50 * time.Millisecond):
		}
	}
	if len(seen) < total {
		t.Fatalf("高频写入丢了事件：只收到 %d/%d 个文件", len(seen), total)
	}
}

// TestChangeWatcher_ConcurrentWritesAndFlushDoNotRace 验证事件处理与批次
// 提交并发时不会出现数据竞态。
//
// 用例本身不做断言：它要交给 `go test -race` 判断。竞态检测器报出的
// 位置就是共享状态被并发读写的地方。
func TestChangeWatcher_ConcurrentWritesAndFlushDoNotRace(t *testing.T) {
	root := t.TempDir()
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     time.Millisecond,
		MaxWait:      20 * time.Millisecond,
		MaxWatchDirs: 100,
		OnChange:     func(*SyncChangeSet) {},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	var writers sync.WaitGroup
	for worker := 0; worker < 4; worker++ {
		writers.Add(1)
		go func(worker int) {
			defer writers.Done()
			for i := 0; i < 60; i++ {
				path := filepath.Join(album, fmt.Sprintf("w%d-%03d.jpg", worker, i))
				_ = os.WriteFile(path, []byte("image"), 0o644)
			}
		}(worker)
	}
	writers.Wait()
	time.Sleep(500 * time.Millisecond)
}

// TestChangeWatcher_CloseAndRestartKeepsWatching 验证关掉再打开监听器后
// 仍然能收到变化。
func TestChangeWatcher_CloseAndRestartKeepsWatching(t *testing.T) {
	root := t.TempDir()
	batches := make(chan *SyncChangeSet, 8)
	newWatcher := func() *ChangeWatcher {
		watcher, err := NewChangeWatcher(ChangeWatcherOptions{
			Roots:        []string{root},
			Exclude:      DefaultExclude(),
			Debounce:     20 * time.Millisecond,
			MaxWait:      time.Second,
			MaxWatchDirs: 100,
			OnChange: func(changes *SyncChangeSet) {
				select {
				case batches <- changes:
				default:
				}
			},
		})
		if err != nil {
			t.Fatalf("create watcher: %v", err)
		}
		return watcher
	}

	first := newWatcher()
	if err := first.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	if err := first.Close(); err != nil {
		t.Fatalf("close watcher: %v", err)
	}

	second := newWatcher()
	if err := second.Start(t.Context()); err != nil {
		t.Fatalf("restart watcher: %v", err)
	}
	defer second.Close()

	file := filepath.Join(root, "after-restart.jpg")
	if err := os.WriteFile(file, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case batch := <-batches:
		if _, ok := batch.Files[file]; !ok {
			t.Fatalf("重启后的监听器没收到新文件：%v", batch.Files)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("重启后的监听器没有收到文件变化")
	}
}

// TestChangeWatcher_MovedDirectoryIsReported 验证目录被移动后监听器会
// 报告旧位置与需要重读的父目录。
//
// 目录改名在系统层面是一次改名事件：新路径未必单独出现在事件里，
// 真正让图库跟上的是「父目录需要重读」这条标记 —— 父目录重读时
// 就能看到改名后的目录。
func TestChangeWatcher_MovedDirectoryIsReported(t *testing.T) {
	root := t.TempDir()
	batches := make(chan *SyncChangeSet, 16)
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     20 * time.Millisecond,
		MaxWait:      time.Second,
		MaxWatchDirs: 100,
		OnChange: func(changes *SyncChangeSet) {
			select {
			case batches <- changes:
			default:
			}
		},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	source := filepath.Join(root, "source")
	if err := os.MkdirAll(source, 0o755); err != nil {
		t.Fatal(err)
	}
	photo := filepath.Join(source, "photo.jpg")
	if err := os.WriteFile(photo, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 等监听器登记好新目录再移动，否则移动本身可能落在监听范围之外。
	waitForWatchedDirs(t, watcher, 2)

	target := filepath.Join(root, "target")
	if err := os.Rename(source, target); err != nil {
		t.Fatal(err)
	}

	deadline := time.Now().Add(10 * time.Second)
	sawOld := false
	sawParent := false
	for time.Now().Before(deadline) && (!sawOld || !sawParent) {
		select {
		case batch := <-batches:
			for file := range batch.Files {
				if filepath.Clean(file) == filepath.Clean(photo) {
					sawOld = true
				}
			}
			for dir := range batch.Dirs {
				if filepath.Clean(dir) == filepath.Clean(root) {
					sawParent = true
				}
			}
		case <-time.After(50 * time.Millisecond):
		}
	}
	if !sawOld {
		t.Fatal("目录移动后旧位置的变化没有被报告")
	}
	if !sawParent {
		t.Fatal("目录移动后父目录没有被标记为需要重读")
	}
}

// waitForWatchedDirs 等到监听器登记了指定数量的目录。
func waitForWatchedDirs(t *testing.T, watcher *ChangeWatcher, want int) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		if watcher.Status().WatchedDirs >= want {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("监听目录数没有到 %d：%+v", want, watcher.Status())
}

// newVerifyHarness 搭一套校验间隔很短的自动同步环境。
func newVerifyHarness(t *testing.T, verifyInterval time.Duration) *syncHarness {
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
		VerifyInterval: verifyInterval,
		WatchDebounce:  80 * time.Millisecond,
		WatchMaxWait:   2 * time.Second,
	})
	if err != nil {
		t.Fatalf("create library sync service: %v", err)
	}
	return &syncHarness{root: root, catalog: catalog, cache: cache, runner: runner, sync: sync}
}

// TestLibrarySync_VerificationKeepsRunning 验证定期校验会一直跑下去。
//
// 校验是监听失效时的兜底：只跑一次的话，之后监听再漏掉变化就永远
// 补不回来了。这里用很短的校验间隔，验证它会连续执行。
func TestLibrarySync_VerificationKeepsRunning(t *testing.T) {
	h := newVerifyHarness(t, 300*time.Millisecond)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	// 先触发一次校验，确认这条链路是通的。
	h.sync.scheduleVerify(time.Now().Add(-time.Second))
	first := waitForCatalogRevision(t, h.catalog, h.catalog.Acquire().Revision())
	second := waitForCatalogRevision(t, h.catalog, first)
	if second == first {
		t.Fatal("定期校验只跑了一次，之后再也不校验了")
	}
}

// waitForCatalogRevision 等到图库版本变化，返回新的版本号。
func waitForCatalogRevision(t *testing.T, catalog *ResourceCatalog, from uint64) uint64 {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		current := catalog.Acquire().Revision()
		if current != from {
			return current
		}
		time.Sleep(20 * time.Millisecond)
	}
	return from
}

// failingScanner 是必定失败的增量扫描引擎。
type failingScanner struct {
	failures int
	calls    int
}

func (f *failingScanner) Apply(*models.ScanResult, *SyncChangeSet, ScanOptions) (*IncrementalOutcome, error) {
	f.calls++
	f.failures--
	if f.failures >= 0 {
		return nil, errors.New("增量扫描失败")
	}
	return nil, errors.New("增量扫描失败")
}

// TestLibrarySync_FailedIncrementalKeepsPendingChanges 验证增量扫描失败后
// 待处理的变化不会丢。
//
// 失败时把变化丢掉等于「这次改动永远进不了图库」：磁盘上文件已经
// 变了，图库却当没发生过，下次校验之前一直显示旧内容。
func TestLibrarySync_FailedIncrementalKeepsPendingChanges(t *testing.T) {
	h := newSyncHarness(t)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	// 让增量扫描必然失败。
	h.sync.engine = &failingScanner{failures: 1 << 30}

	album := filepath.Join(h.root, "album")
	mkdirAll(t, album)
	added := filepath.Join(album, "new.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.sync.onChange(changeSetFor(added))

	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		if h.sync.Status().PendingChanges > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("增量扫描失败后待处理的变化被丢掉了：%+v", h.sync.Status())
}

// TestLibrarySync_RetryLimitFallsBackToVerification 验证增量扫描连续失败
// 之后会改用全量校验兜底，而不是无限重试。
func TestLibrarySync_RetryLimitFallsBackToVerification(t *testing.T) {
	h := newSyncHarness(t)
	h.scanNow(t)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := h.sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer h.sync.Shutdown()

	scanner := &failingScanner{}
	h.sync.engine = scanner
	album := filepath.Join(h.root, "album")
	mkdirAll(t, album)
	added := filepath.Join(album, "new.jpg")
	if err := os.WriteFile(added, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}
	h.sync.onChange(changeSetFor(added))

	// 连续失败之后会转成一次全量校验：校验成功即说明兜底生效了。
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if !h.sync.Status().LastVerifyAt.IsZero() {
			break
		}
		time.Sleep(50 * time.Millisecond)
	}
	if h.sync.Status().LastVerifyAt.IsZero() {
		t.Fatalf("增量扫描连续失败后没有转成全量校验：%+v", h.sync.Status())
	}
	// 重试次数必须有界：同一批变化不能无限重试。
	if scanner.calls > maxIncrementalRetries+2 {
		t.Fatalf("增量扫描重试次数没有上限：调用了 %d 次", scanner.calls)
	}
}
