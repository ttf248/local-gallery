package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
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
	return sync, catalog, analyzer, root
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
// 队列上限的照片时，每一张都会被分析。
//
// 以前超出上限的部分会被直接裁掉：任务永远排不进去，那些照片的分析
// 结果就再也补不上了。
func TestLibrarySync_LargeImportAnalyzesEveryPhoto(t *testing.T) {
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

	// 一次导入超过队列上限的照片。
	total := maxAnalysisQueue + 120
	for i := 0; i < total; i++ {
		path := filepath.Join(album, fmt.Sprintf("p%05d.jpg", i))
		if err := os.WriteFile(path, []byte("fake"), 0o644); err != nil {
			t.Fatal(err)
		}
	}

	waitForAnalyzed(t, analyzer, int64(total))
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
