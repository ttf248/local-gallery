package services

// 本文件覆盖自动分析完成之后的派生数据一致性：分析结果更新了，
// 智能相册有没有跟着重算；进程重启之后，欠下的分析还在不在。

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// TestLibrarySync_QueueOverflowKeepsSmartAlbumRefresh 验证队列超出上限、
// 改成全库增量分析之后，智能相册仍然会被重算。
//
// 队列超上限时会被清空：清空之后队列长度是零。只看队列长度的话就会
// 以为没有分析任务了，智能相册从此不再重算 —— 派生结果停在导入之前，
// 而这批照片的分析其实还没跑。
func TestLibrarySync_QueueOverflowKeepsSmartAlbumRefresh(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.mu.Unlock()

	ids := make([]string, 0, maxAnalysisQueue+1)
	for i := 0; i <= maxAnalysisQueue; i++ {
		ids = append(ids, fmt.Sprintf("f_%d", i))
	}
	sync.queueAnalysis(ids)

	sync.mu.Lock()
	dirty := sync.analysisDirty
	full := sync.analysisFull[AIJobTypeMetadata]
	sync.mu.Unlock()
	if !full {
		t.Fatal("队列超上限之后没有记下全库增量分析，这批工作没人接手")
	}
	if !dirty {
		t.Fatal("队列超上限之后没有标记要重算智能相册，派生结果会停在导入之前")
	}
}

// TestLibrarySync_SmartAlbumRefreshRecoversFromStartFailure 验证智能相册
// 刷新第一次启动失败之后会自动重试，不需要用户手动点。
//
// 以前启动失败时「要重算」的标记已经被抹掉了：派生结果停在旧状态，
// 而界面上看不出哪里不对，只能等用户手动点一次刷新。
func TestLibrarySync_SmartAlbumRefreshRecoversFromStartFailure(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)
	refresher := &fakeSmartAlbumRefresher{}
	refresher.failNextStart(1)
	sync.opts.SmartAlbums = refresher
	// 失败之后的重试间隔调小：这里要验证的是「会自动重试」。
	sync.smartAlbumRetryDelay = 0

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.analysisDirty = true
	sync.mu.Unlock()

	// 第一次启动失败：标记要留着。
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	dirty := sync.analysisDirty
	sync.mu.Unlock()
	if !dirty {
		t.Fatal("刷新启动失败之后把要重算的标记抹掉了，派生结果不会再更新")
	}
	if refresher.starts.Load() != 1 {
		t.Fatalf("应尝试启动一次，实际 %d 次", refresher.starts.Load())
	}

	// 下一轮自动重试：这次启动成功。
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	job := sync.smartAlbumJob
	sync.mu.Unlock()
	if job == "" {
		t.Fatal("刷新失败之后没有自动重试，要等用户手动点")
	}

	// 刷新真的跑完之后，标记才清掉。
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	dirty = sync.analysisDirty
	sync.mu.Unlock()
	if dirty {
		t.Fatal("刷新跑完之后要重算的标记仍然留着")
	}
}

// TestLibrarySync_PendingAnalysisSurvivesRestart 验证进程重启之后，
// 上一次没跑完的分析会接着跑。
//
// 进程被杀时内存里的队列会没：磁盘上留下的只有「哪些模块欠着分析」。
// 重启后靠它改成一次全库增量分析 —— 欠下的活一定在内，
// 派生索引最终要与实际媒体库一致，靠的就是这一步。
func TestLibrarySync_PendingAnalysisSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))

	catalog := NewResourceCatalog()
	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})
	resourceIDs := catalog.Acquire().FileIDs()
	if len(resourceIDs) != 1 {
		t.Fatalf("图库里应有 1 个资源，实际 %d", len(resourceIDs))
	}

	statePath := filepath.Join(t.TempDir(), "library_sync.json")
	newService := func(analyzer AIAnalyzer) *LibrarySyncService {
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
			StatePath:      statePath,
			Roots:          func() []string { return []string{root} },
			Exclude:        func() ExcludeConfig { return DefaultExclude() },
			Catalog:        catalog,
			Cache:          NewScanResultCache(filepath.Join(t.TempDir(), "scan_cache.json")),
			Covers:         NewCoverOverrideStore(filepath.Join(t.TempDir(), "covers.json")),
			Jobs:           jobs,
			VerifyInterval: time.Hour,
		})
		if err != nil {
			t.Fatalf("create library sync service: %v", err)
		}
		return sync
	}

	ctx := context.Background()
	first := newService(&syncTestAnalyzer{})
	if _, err := first.Update(ctx, LibrarySyncSettings{Enabled: true, AutoAnalyze: true}); err != nil {
		t.Fatalf("update library sync: %v", err)
	}
	// 模拟「分析执行过程中新增照片」：资源排进队列，还没提交出去。
	first.queueAnalysis(resourceIDs)
	first.Shutdown()

	// 重启：新的服务实例读同一份状态。
	analyzer := &syncTestAnalyzer{}
	second := newService(analyzer)
	defer second.Shutdown()

	second.mu.Lock()
	full := second.analysisFull[AIJobTypeMetadata]
	second.mu.Unlock()
	if !full {
		t.Fatal("重启之后欠下的分析没人接手")
	}

	second.pumpAnalysis(ctx)
	waitForAnalyzed(t, analyzer, 1)
	// 分析器返回后才会提交批次，等待任务完成后再读取派生索引。
	waitForAIJobIdle(t, second.opts.Jobs)

	// 派生索引要与实际媒体库一致：这张照片要有分析结果。
	records := second.opts.Jobs.Records(AIJobTypeMetadata)
	if len(records) != 1 {
		t.Fatalf("派生索引里应有 1 条结果，实际 %d", len(records))
	}
}

// TestLibrarySync_VerificationQueuesNewPhotosForAnalysis 验证校验扫描
// 发现的新照片会被排进分析。
//
// 程序关闭期间磁盘上的变化不会有事件，增量扫描那条路发现不了。
// 不把校验发现的差异排进分析，新照片就永远没有分析结果 ——
// 派生索引与实际媒体库永远对不上。
func TestLibrarySync_VerificationQueuesNewPhotosForAnalysis(t *testing.T) {
	sync, catalog, analyzer, root := newAnalysisHarness(t)
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))

	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})
	previous := catalog.Acquire()

	// 校验期间磁盘上多了一张照片。
	touchAll(t, filepath.Join(album, "b.jpg"))
	next, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(next, []string{root})

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.mu.Unlock()

	sync.reconcileAnalysis(previous)
	sync.pumpAnalysis(context.Background())

	// 只分析新出现的那一张：没变过的不用重算。
	waitForAnalyzed(t, analyzer, 1)
}
