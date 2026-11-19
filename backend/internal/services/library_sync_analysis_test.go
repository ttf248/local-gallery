package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

// newAnalysisHarness 搭一套带假分析器的自动同步环境。
//
// 假分析器只计数：自动分析链路关心的是「哪些照片被排进了分析」，
// 不是分析出来的内容。
func newAnalysisHarness(t *testing.T) (*LibrarySyncService, *ResourceCatalog, *syncTestAnalyzer, string) {
	t.Helper()
	analyzer := &syncTestAnalyzer{}
	sync, catalog, _, root := newAnalysisHarnessWith(t, analyzer)
	return sync, catalog, analyzer, root
}

// newAnalysisHarnessWith 搭一套带指定分析器的自动同步环境。
func newAnalysisHarnessWith(t *testing.T, analyzer *syncTestAnalyzer) (*LibrarySyncService, *ResourceCatalog, *syncTestAnalyzer, string) {
	t.Helper()
	sync, catalog, root := newAnalysisHarnessWithAnalyzer(t, analyzer)
	return sync, catalog, analyzer, root
}

// newAnalysisHarnessWithAnalyzer 搭一套带任意分析器的自动同步环境。
//
// 自动分析链路关心的是「哪些照片被排进了分析」，不是分析出来的内容，
// 因此这里允许换成会失败、或者还没准备好的分析器。
func newAnalysisHarnessWithAnalyzer(t *testing.T, analyzer AIAnalyzer) (*LibrarySyncService, *ResourceCatalog, string) {
	t.Helper()
	root := t.TempDir()
	catalog := NewResourceCatalog()
	cache := NewScanResultCache(filepath.Join(t.TempDir(), "scan_cache.json"))
	covers := NewCoverOverrideStore(filepath.Join(t.TempDir(), "covers.json"))
	runner := NewAsyncScanRunner()
	runner.SetCache(cache)
	runner.SetCatalog(catalog)
	runner.SetCoverOverrides(covers)

	jobs, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    filepath.Join(t.TempDir(), "jobs.json"),
		MetadataDir:  filepath.Join(t.TempDir(), "derived"),
		Catalog:      catalog,
		ValidatePath: func(path string) (string, error) { return path, nil },
		Analyzers:    []AIAnalyzer{analyzer},
	})
	if err != nil {
		t.Fatalf("create ai job service: %v", err)
	}
	t.Cleanup(func() { _ = jobs.Shutdown(context.Background()) })

	sync, err := NewLibrarySyncService(LibrarySyncOptions{
		StatePath:      filepath.Join(t.TempDir(), "library_sync.json"),
		Roots:          func() []string { return []string{root} },
		Exclude:        func() ExcludeConfig { return DefaultExclude() },
		Catalog:        catalog,
		Cache:          cache,
		Covers:         covers,
		Runner:         runner,
		Jobs:           jobs,
		VerifyInterval: time.Hour,
		WatchDebounce:  80 * time.Millisecond,
		WatchMaxWait:   2 * time.Second,
	})
	if err != nil {
		t.Fatalf("create library sync service: %v", err)
	}
	return sync, catalog, root
}

// TestLibrarySync_OverwrittenPhotoIsAnalyzedAgain 验证原地覆盖一张照片后
// 它会被重新分析。
//
// 覆盖不改变文件清单，只改变内容。以前这类改动被判成「图库没变」，
// 增量结果直接被丢掉：旧的分析结果继续留着，相似照片、人物、检索
// 全都对着旧内容。
func TestLibrarySync_OverwrittenPhotoIsAnalyzedAgain(t *testing.T) {
	sync, catalog, analyzer, root := newAnalysisHarness(t)
	album := filepath.Join(root, "album")
	mkdirAll(t, album)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer sync.Shutdown()
	if _, err := sync.Update(ctx, LibrarySyncSettings{Enabled: true, AutoAnalyze: true}); err != nil {
		t.Fatalf("update library sync: %v", err)
	}

	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	// 新增一张照片：它会被分析一次。
	target := filepath.Join(album, "a.jpg")
	touchAll(t, target)
	waitForAnalyzed(t, analyzer, 1)

	// 原地覆盖：文件还在，名字没变，内容变了。
	overwriteInPlace(t, target, "brand new content with another length")

	waitForAnalyzed(t, analyzer, 2)
}

// TestLibrarySync_LargeImportAnalyzesEveryPhoto 验证一次导入超过
// 队列上限的照片时，每一张都会被分析，并且智能相册跟着重算。
//
// 以前超出上限的部分会被直接裁掉：任务永远排不进去，那些照片的分析
// 结果就再也补不上了。
//
// 队列超上限时会改成一次全库增量分析，而队列因此被清空：只看队列长度
// 的话就会以为没有分析任务了，智能相册从此不再重算 ——
// 派生结果停在导入之前的样子。
func TestLibrarySync_LargeImportAnalyzesEveryPhoto(t *testing.T) {
	sync, catalog, analyzer, root := newAnalysisHarness(t)
	refresher := &fakeSmartAlbumRefresher{}
	sync.opts.SmartAlbums = refresher
	album := filepath.Join(root, "album")
	mkdirAll(t, album)

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer sync.Shutdown()
	if _, err := sync.Update(ctx, LibrarySyncSettings{Enabled: true, AutoAnalyze: true}); err != nil {
		t.Fatalf("update library sync: %v", err)
	}

	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	// 一次导入超过队列上限的照片。
	total := maxAnalysisQueue + 120
	for i := 0; i < total; i++ {
		path := filepath.Join(album, fmt.Sprintf("p%05d.jpg", i))
		if err := os.WriteFile(path, []byte("fake"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	waitForAnalyzed(t, analyzer, int64(total))
	// 所有模块跑完之后，智能相册要重算一次。
	waitForSmartAlbumRefresh(t, refresher)
}

// waitForSmartAlbumRefresh 等到智能相册被重算过。
func waitForSmartAlbumRefresh(t *testing.T, refresher *fakeSmartAlbumRefresher) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if refresher.starts.Load() > 0 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatal("分析都跑完了，智能相册仍然没有重算")
}

// TestLibrarySync_SmartAlbumRefreshWaitsForQueuedAnalysis 验证队列还没
// 排空时智能相册的重算不会被丢掉。
//
// 一次导入上千张照片时队列要分几轮才排得空。重算的标记如果在队列还有
// 东西的时候就被抹掉，那这批照片改完之后智能相册就再也不会重算 ——
// 派生结果停在导入之前的样子。
func TestLibrarySync_SmartAlbumRefreshWaitsForQueuedAnalysis(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)
	refresher := &fakeSmartAlbumRefresher{}
	sync.opts.SmartAlbums = refresher

	// 队列里还有没提交的活。
	sync.restoreAnalysis(AIJobTypeMetadata, []string{"f_1", "f_2"})
	sync.mu.Lock()
	sync.analysisDirty = true
	sync.mu.Unlock()

	sync.refreshSmartAlbums()

	sync.mu.Lock()
	dirty := sync.analysisDirty
	sync.mu.Unlock()
	if !dirty {
		t.Fatal("队列还没排空就把重算的标记抹掉了，这批照片改完之后智能相册不会再重算")
	}
	if refresher.starts.Load() != 0 {
		t.Fatal("队列还没排空就重算了智能相册：分析结果还没更新")
	}
}

// fakeSmartAlbumRefresher 是智能相册刷新的假实现：只计数。
//
// 它也能模拟失败：startFailures 让前几次启动失败，statuses 记录每个
// 任务的状态，用来验证「刷新失败之后会自动重试」。
type fakeSmartAlbumRefresher struct {
	starts atomic.Int64

	mu sync.Mutex
	// startFailures 是还要失败的启动次数。
	startFailures int
	// statuses 记录每个刷新任务的状态。
	statuses map[string]SmartAlbumRefreshProgress
	// nextID 给刷新任务编号。
	nextID int
}

func (f *fakeSmartAlbumRefresher) Start(bool) (string, bool, error) {
	f.starts.Add(1)
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.startFailures > 0 {
		f.startFailures--
		return "", false, errors.New("智能相册服务暂时不可用")
	}
	f.nextID++
	id := fmt.Sprintf("smart-album-%d", f.nextID)
	if f.statuses == nil {
		f.statuses = map[string]SmartAlbumRefreshProgress{}
	}
	f.statuses[id] = SmartAlbumRefreshProgress{JobID: id, Status: SmartAlbumRefreshStatusComplete}
	return id, false, nil
}

func (f *fakeSmartAlbumRefresher) Status(id string) (SmartAlbumRefreshProgress, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	status, ok := f.statuses[id]
	return status, ok
}

// failNextStart 让接下来 n 次启动失败。
func (f *fakeSmartAlbumRefresher) failNextStart(n int) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.startFailures = n
}

// TestLibrarySync_FullAnalysisSurvivesModuleFailure 验证全库增量分析
// 在模块暂时不可用时不会被丢掉。
//
// 队列超上限时，那批资源改成由一次全库增量分析接手 —— 任务中心按
// 文件指纹挑出真正要重算的那些。这次提交要是失败了（模型刚装好还没
// 准备好、磁盘读不了），标记必须留着等下一轮再试。
//
// 以前标记在提交之前就被清掉了：模块失败一次，这批工作就再也没人
// 接手，那批照片的分析结果永远补不上。
func TestLibrarySync_FullAnalysisSurvivesModuleFailure(t *testing.T) {
	analyzer := &unreadyAnalyzer{}
	sync, catalog, root := newAnalysisHarnessWithAnalyzer(t, analyzer)
	publishTestLibrary(t, catalog, root)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.analysisFull[AIJobTypeMetadata] = true
	sync.mu.Unlock()

	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	full := sync.analysisFull[AIJobTypeMetadata]
	failures := sync.analysisFailures[AIJobTypeMetadata]
	sync.mu.Unlock()
	if !full {
		t.Fatal("模块不可用时全库分析的标记被丢掉了，这批工作没人接手")
	}
	if failures < 1 {
		t.Fatalf("失败次数没记上：%d", failures)
	}

	// 模块恢复之后，这次全库分析要真的跑起来。
	analyzer.ready.Store(true)
	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	task := sync.analysisTasks[AIJobTypeMetadata]
	sync.mu.Unlock()
	if task == nil {
		t.Fatal("模块恢复后全库分析仍然没有提交")
	}

	// 标记要等任务真的跑完才清：提交成功就清的话，
	// 任务中途失败就再也没人接手了。
	waitForLatestJob(t, sync.opts.Jobs)
	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	full = sync.analysisFull[AIJobTypeMetadata]
	sync.mu.Unlock()
	if full {
		t.Fatal("全库分析跑完之后标记仍然留着")
	}
}

// TestLibrarySync_FullAnalysisGivesUpAfterRetries 验证全库增量分析连续
// 失败之后会停手，并如实记下原因。
//
// 不能无限重试：模块一直不可用时每一轮都重试一次，图库就永远卡在
// 排队状态。但停手也要说清楚为什么停，不能悄悄把任务丢掉。
func TestLibrarySync_FullAnalysisGivesUpAfterRetries(t *testing.T) {
	analyzer := &unreadyAnalyzer{}
	sync, catalog, root := newAnalysisHarnessWithAnalyzer(t, analyzer)
	publishTestLibrary(t, catalog, root)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.analysisFull[AIJobTypeMetadata] = true
	sync.mu.Unlock()

	for attempt := 0; attempt < maxAnalysisRetries+2; attempt++ {
		sync.pumpAnalysis(context.Background())
	}

	sync.mu.Lock()
	full := sync.analysisFull[AIJobTypeMetadata]
	failures := sync.analysisFailures[AIJobTypeMetadata]
	sync.mu.Unlock()
	if full {
		t.Fatalf("超过重试上限后仍在重试：失败 %d 次", failures)
	}
	if failures < maxAnalysisRetries {
		t.Fatalf("失败次数没记上：%d", failures)
	}
	if sync.Status().LastError == "" {
		t.Fatal("放弃这批任务时没有记录原因")
	}
}

// publishTestLibrary 扫一遍测试媒体根并发布到图库。
//
// 分析任务要有目标才能开跑：图库还没建立起来的时候没有可分析的资源。
func publishTestLibrary(t *testing.T, catalog *ResourceCatalog, root string) {
	t.Helper()
	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})
}

// unreadyAnalyzer 是「装上了但还没准备好」的分析器。
//
// 它实现了就绪检查：没准备好时开任务会失败，但模块本身仍然算已安装。
type unreadyAnalyzer struct {
	ready atomic.Bool
}

func (a *unreadyAnalyzer) Type() string    { return AIJobTypeMetadata }
func (a *unreadyAnalyzer) Version() string { return "unready-test-v1" }
func (a *unreadyAnalyzer) Analyze(context.Context, io.ReadSeeker) (AIAnalysisOutput, error) {
	return AIAnalysisOutput{Status: "ok", Data: json.RawMessage(`{}`)}, nil
}
func (a *unreadyAnalyzer) Ready(context.Context) error {
	if a.ready.Load() {
		return nil
	}
	return errors.New("模型还没准备好")
}

// TestLibrarySync_AnalysisQueueKeepsTasksWhenModuleFails 验证自动分析
// 排队失败时任务不会被丢掉。
//
// 以前模块不可用（模型没装好、磁盘读不了）会把这批资源直接扔掉：
// 那批照片的分析结果就永远补不上了。
func TestLibrarySync_AnalysisQueueKeepsTasksWhenModuleFails(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	ids := []string{"f_1", "f_2", "f_3"}
	sync.restoreAnalysis(AIJobTypeMetadata, ids)

	// 连续失败但还没到上限：任务要留在队列里等下一轮。
	for attempt := 1; attempt < maxAnalysisRetries; attempt++ {
		sync.recordAnalysisFailure(AIJobTypeMetadata, errors.New("模块暂时不可用"))
		sync.mu.Lock()
		entry := sync.analysisQueue[AIJobTypeMetadata]
		sync.mu.Unlock()
		if entry == nil || entry.len() != len(ids) {
			t.Fatalf("第 %d 次失败后任务被丢掉了：%+v", attempt, entry)
		}
	}

	// 超过上限才放弃，并且要如实记下原因。
	sync.recordAnalysisFailure(AIJobTypeMetadata, errors.New("模块一直不可用"))
	sync.mu.Lock()
	entry := sync.analysisQueue[AIJobTypeMetadata]
	failures := sync.analysisFailures[AIJobTypeMetadata]
	sync.mu.Unlock()
	if entry != nil && entry.len() != 0 {
		t.Fatalf("超过重试上限后任务应被放弃：%+v", entry)
	}
	if failures < maxAnalysisRetries {
		t.Fatalf("失败次数没记上：%d", failures)
	}
	if sync.Status().LastError == "" {
		t.Fatal("放弃这批任务时没有记录原因")
	}
}

// TestLibrarySync_AnalysisQueueKeepsTasksWhileJobCenterIsBusy 验证任务
// 中心正忙时排队的资源会留在队列里。
func TestLibrarySync_AnalysisQueueKeepsTasksWhileJobCenterIsBusy(t *testing.T) {
	blocking := &syncTestAnalyzer{gate: make(chan struct{})}
	sync, catalog, _, root := newAnalysisHarnessWith(t, blocking)
	defer close(blocking.gate)

	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "busy.jpg"))
	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.mu.Unlock()

	// 任务中心正忙：先占住它。
	if _, _, err := sync.opts.Jobs.Start(AIJobTypeMetadata, AIJobModeFull); err != nil {
		t.Fatalf("start blocking job: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && blocking.analyzed.Load() == 0 {
		time.Sleep(20 * time.Millisecond)
	}

	ids := []string{"f_1", "f_2", "f_3"}
	sync.restoreAnalysis(AIJobTypeMetadata, ids)
	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	entry := sync.analysisQueue[AIJobTypeMetadata]
	sync.mu.Unlock()
	if entry == nil || entry.len() != len(ids) {
		t.Fatalf("任务中心忙时排队的资源被丢掉了：%+v", entry)
	}
}

// TestLibrarySync_AnalysisQueueAcceptsSameResourceAgain 验证同一张照片
// 内容再变之后还能重新排进队列。
//
// 队列按资源去重：同一张照片排过一次就不该排第二次。但「排过一次」
// 指的是还在队列里的时候 —— 已经交给任务中心之后再被覆盖，
// 必须能重新排进去，否则旧的分析结果就一直留着。
func TestLibrarySync_AnalysisQueueAcceptsSameResourceAgain(t *testing.T) {
	queue := newAnalysisQueue()
	queue.push([]string{"f_1"})

	taken := queue.take(analysisBatchSize)
	if len(taken) != 1 {
		t.Fatalf("应取出 1 个资源，实际 %d", len(taken))
	}
	queue.push([]string{"f_1"})
	if queue.len() != 1 {
		t.Fatalf("内容再变之后同一张照片应能重新排队，实际队列长度 %d", queue.len())
	}
}

// TestLibrarySync_FullAnalysisFlagSurvivesBusyJobCenter 验证任务中心正忙
// 时，全库增量分析的标记不会被丢掉。
//
// 标记丢了就等于这批任务没人接手：那批照片的分析结果永远补不上。
func TestLibrarySync_FullAnalysisFlagSurvivesBusyJobCenter(t *testing.T) {
	blocking := &syncTestAnalyzer{gate: make(chan struct{})}
	sync, catalog, _, root := newAnalysisHarnessWith(t, blocking)
	defer close(blocking.gate)

	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "busy.jpg"))
	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.analysisFull[AIJobTypeMetadata] = true
	sync.mu.Unlock()

	// 先占住任务中心。
	if _, _, err := sync.opts.Jobs.Start(AIJobTypeMetadata, AIJobModeFull); err != nil {
		t.Fatalf("start blocking job: %v", err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && blocking.analyzed.Load() == 0 {
		time.Sleep(20 * time.Millisecond)
	}

	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	full := sync.analysisFull[AIJobTypeMetadata]
	sync.mu.Unlock()
	if !full {
		t.Fatal("任务中心正忙时全库分析的标记被丢掉了")
	}
}

// TestLibrarySync_AnalysisQueueBatchesLargeImport 验证大批量导入会分批
// 提交，而不是一次性塞进任务中心。
func TestLibrarySync_AnalysisQueueBatchesLargeImport(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	entry := newAnalysisQueue()
	for i := 0; i < analysisBatchSize*3+7; i++ {
		entry.push([]string{fmt.Sprintf("f_%d", i)})
	}
	sync.analysisQueue[AIJobTypeMetadata] = entry
	sync.mu.Unlock()

	taken := entry.take(analysisBatchSize)
	if len(taken) != analysisBatchSize {
		t.Fatalf("一批应取 %d 个资源，实际 %d", analysisBatchSize, len(taken))
	}
	if taken[0] != "f_0" || taken[len(taken)-1] != fmt.Sprintf("f_%d", analysisBatchSize-1) {
		t.Fatalf("批次应按先来后到取：%v ... %v", taken[0], taken[len(taken)-1])
	}
	restored := entry.take(analysisBatchSize)
	entry.restore(restored)
	sync.mu.Lock()
	defer sync.mu.Unlock()
	if entry.len() != analysisBatchSize*2+7 {
		t.Fatalf("放回后队列长度不对：%d", entry.len())
	}
}
