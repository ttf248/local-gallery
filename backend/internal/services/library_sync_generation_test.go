package services

// 本文件覆盖自动分析链路上的并发代次问题：三处状态在「旧的活还没干完、
// 新的活又来了」时会互相踩掉 ——
//
//   - 全库增量分析的标记被上一轮任务清掉，新导入的那批没人接手；
//   - 复用的智能相册刷新盖掉了新一轮分析带来的变化；
//   - 任务记录从任务中心消失时，那批资源的名单只记一次失败就丢了。
//
// 这三处的共同点是：一份「欠着的活」被另一份「已经完成的活」顺手清掉。

import (
	"context"
	"errors"
	"fmt"
	"path/filepath"
	"testing"
)

// TestLibrarySync_NewImportDuringFullAnalysisIsNotDropped 验证全库增量
// 分析在跑的时候又导入一批照片，这批照片不会被上一轮任务顺手清掉。
//
// 队列超出上限时会清空并改成一次全库增量分析。全库分析在跑的时候
// 又导入超过上限的一批照片：新的那轮欠账要另记一次代次，上一轮任务
// 跑完时只能销掉自己那一笔。
//
// 以前没有代次：上一轮任务跑完就把标记删了，新导入的这批照片从此
// 没有人分析 —— 派生索引与媒体库对不上，而界面上看不出哪里不对。
func TestLibrarySync_NewImportDuringFullAnalysisIsNotDropped(t *testing.T) {
	blocking := &syncTestAnalyzer{gate: make(chan struct{})}
	sync, catalog, _, root := newAnalysisHarnessWith(t, blocking)
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))
	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.mu.Unlock()

	// 第一轮全库增量分析：提交出去并在跑。
	sync.markFullAnalysis()
	sync.pumpAnalysis(context.Background())
	sync.mu.Lock()
	task := sync.analysisTasks[AIJobTypeMetadata]
	sync.mu.Unlock()
	if task == nil {
		t.Fatal("全库增量分析没有提交出去")
	}

	// 任务在跑的时候又导入一批照片：数量超过队列上限。
	ids := make([]string, 0, maxAnalysisQueue+1)
	for i := 0; i <= maxAnalysisQueue; i++ {
		ids = append(ids, fmt.Sprintf("f_%d", i))
	}
	sync.queueAnalysis(ids)

	// 上一轮任务跑完了。
	close(blocking.gate)
	waitForLatestJob(t, sync.opts.Jobs)
	sync.pumpAnalysis(context.Background())

	sync.mu.Lock()
	full := sync.analysisFull[AIJobTypeMetadata]
	next := sync.analysisTasks[AIJobTypeMetadata]
	sync.mu.Unlock()
	if !full {
		t.Fatal("上一轮全库分析跑完之后把新一轮的标记清掉了，新导入的这批没人分析")
	}
	if next == nil {
		t.Fatal("新一轮的全库分析没有提交出去")
	}
}

// TestLibrarySync_ReusedSmartAlbumRefreshKeepsDirty 验证复用的智能相册
// 刷新不会把新一轮分析的标记清掉。
//
// 刷新在跑的时候新的 AI 分析完成了：自动链路去开刷新时只能复用正在
// 跑的那次（用户手动点的、每日计划跑的）。那次刷新开始得比这次分析
// 变化早，覆盖不到新的变化 —— 它的结果不能算作覆盖了当前这一代。
//
// 以前复用的那次被当成了自己发起的：它一跑完就把标记清掉，新变化再也
// 不会触发重算，派生结果停在旧状态。
func TestLibrarySync_ReusedSmartAlbumRefreshKeepsDirty(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)
	refresher := &fakeSmartAlbumRefresher{}
	sync.opts.SmartAlbums = refresher

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.markDirtyLocked()
	sync.mu.Unlock()

	// 有人先开了一次刷新：它开始得比后面的分析变化早。
	running := refresher.startRunning()

	// 又有一批分析结果变了：智能相册要重算。
	sync.mu.Lock()
	sync.markDirtyLocked()
	sync.mu.Unlock()

	// 自动链路去开刷新：只能复用正在跑的那次。
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	job := sync.smartAlbumJob
	owned := sync.smartAlbumOwned
	sync.mu.Unlock()
	if job != running {
		t.Fatalf("应复用正在跑的那次刷新，实际 %q", job)
	}
	if owned {
		t.Fatal("复用的刷新被当成了自己发起的：它覆盖不到后来的变化")
	}

	// 那次旧刷新跑完了：它覆盖不到新的变化，标记要留着。
	refresher.completeRunning()
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	dirty := sync.analysisDirty
	sync.mu.Unlock()
	if !dirty {
		t.Fatal("复用的旧刷新把新变化的标记清掉了，派生结果会停在旧状态")
	}

	// 下一轮自己开一次刷新：那次覆盖了全部变化，跑完之后标记才清。
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	owned = sync.smartAlbumOwned
	sync.mu.Unlock()
	if !owned {
		t.Fatal("下一轮没有自己发起刷新")
	}
	sync.refreshSmartAlbums()
	sync.mu.Lock()
	dirty = sync.analysisDirty
	sync.mu.Unlock()
	if dirty {
		t.Fatal("自己发起的刷新跑完之后标记仍然留着")
	}
}

// TestLibrarySync_MissingJobRecordRestoresResources 验证任务记录从任务
// 中心消失时，那批资源会被放回队列。
//
// 任务记录没了（用户在任务中心清了历史）不等于活干完了：这批资源的
// 分析结果还是没有补上。名单要放回队列等下一轮重试。
//
// 以前这里只记一次失败就把名单丢了：那批照片的分析结果永远补不上。
func TestLibrarySync_MissingJobRecordRestoresResources(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.analysisTasks[AIJobTypeMetadata] = &analysisTask{
		jobID: "job-record-gone",
		ids:   []string{"f_1", "f_2"},
	}
	sync.mu.Unlock()

	sync.settleAnalysisTask(AIJobTypeMetadata)

	sync.mu.Lock()
	entry := sync.analysisQueue[AIJobTypeMetadata]
	sync.mu.Unlock()
	if entry == nil || entry.len() != 2 {
		t.Fatalf("任务记录消失之后这批资源没被放回队列：%+v", entry)
	}
}

// TestLibrarySync_MissingFullJobRecordKeepsFullAnalysis 验证任务记录
// 消失时，全库增量分析的欠账不会被一起丢掉。
//
// 全库分析没有资源名单：欠着的活全靠那个标记。记录没了之后要能重新
// 提交一次全库增量分析 —— 任务中心按文件指纹挑出真正要重算的那些。
func TestLibrarySync_MissingFullJobRecordKeepsFullAnalysis(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.markFullAnalysisLocked(AIJobTypeMetadata)
	sync.analysisTasks[AIJobTypeMetadata] = &analysisTask{
		jobID:          "job-record-gone",
		full:           true,
		fullGeneration: sync.analysisFullGeneration[AIJobTypeMetadata],
	}
	sync.mu.Unlock()

	sync.settleAnalysisTask(AIJobTypeMetadata)

	sync.mu.Lock()
	full := sync.analysisFull[AIJobTypeMetadata]
	sync.mu.Unlock()
	if !full {
		t.Fatal("任务记录消失之后全库分析的欠账丢了，这批工作没人接手")
	}
}

// TestLibrarySync_AnalysisFailureKeepsNewerQueueEntries 验证放弃一批失败
// 的工作时，队列里后来排进来的资源不受影响。
//
// 连续失败到上限时只放弃这次失败的那批：后来排进来的资源是新的工作，
// 跟着一起丢就等于「导入之后没有分析」。
func TestLibrarySync_AnalysisFailureKeepsNewerQueueEntries(t *testing.T) {
	sync, _, _, _ := newAnalysisHarness(t)

	sync.mu.Lock()
	sync.settings.AutoAnalyze = true
	sync.mu.Unlock()

	failed := []string{"f_1", "f_2"}
	sync.restoreAnalysis(AIJobTypeMetadata, failed)
	// 后来又排进来一个资源：它跟失败的那批无关。
	sync.restoreAnalysis(AIJobTypeMetadata, []string{"f_3"})

	for attempt := 0; attempt < maxAnalysisRetries; attempt++ {
		sync.recordAnalysisFailure(
			AIJobTypeMetadata,
			analysisAttempt{ids: failed},
			errors.New("模块一直不可用"),
		)
	}

	sync.mu.Lock()
	entry := sync.analysisQueue[AIJobTypeMetadata]
	sync.mu.Unlock()
	if entry == nil || entry.len() != 1 {
		t.Fatalf("放弃失败的那批时把新排进来的资源也丢了：%+v", entry)
	}
	remaining := entry.take(analysisBatchSize)
	if len(remaining) != 1 || remaining[0] != "f_3" {
		t.Fatalf("留下的应该是后来排进来的那一个：%v", remaining)
	}
}
