package services

// 本文件管自动分析这条链路：变动的资源怎么排进任务中心、任务跑完之后
// 怎么把智能相册重算一遍，以及这条链路的中间状态怎么在重启后接上。
//
// 链路上有三份状态，少一份派生数据就会停在旧状态：
//
//	analysisQueue  每个模块待提交的资源名单（内存里的有界队列）
//	analysisFull   每个模块欠一次全库增量分析
//	analysisDirty  分析结果变了，智能相册要重算
//
// analysisDirty 只有在智能相册真的重算完之后才会清掉。中间任何一步
// 失败都要留着它：抹掉的话派生结果会一直停在旧状态，而界面上看不出
// 哪里不对，只能等用户手动点一次刷新。

import (
	"context"
	"errors"
	"fmt"
	"log"
	"path/filepath"
	"sort"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// defaultSmartAlbumRetryDelay 是智能相册刷新失败之后的重试间隔。
//
// 刷新失败往往是环境问题（图库还没建好、磁盘读不了）：立刻重试只会
// 一遍遍刷出失败的任务记录。隔一会儿再试，派生数据最终一样会跟上，
// 任务中心也不会被失败记录淹没。
const defaultSmartAlbumRetryDelay = 30 * time.Second

// analysisQueue 是一个模块的待分析资源队列。
//
// 队列按先来后到排，重复的资源只排一次。它是内存里的有界队列：
// 超过上限时不丢任务，而是交给一次全库增量分析接手
// （见 LibrarySyncService.analysisFull）。
type analysisQueue struct {
	ids  []string
	seen map[string]struct{}
}

func newAnalysisQueue() *analysisQueue {
	return &analysisQueue{seen: map[string]struct{}{}}
}

// push 把资源排进队列，已经在队列里的不重复排。
func (q *analysisQueue) push(ids []string) {
	for _, id := range ids {
		if id == "" {
			continue
		}
		if _, exists := q.seen[id]; exists {
			continue
		}
		q.seen[id] = struct{}{}
		q.ids = append(q.ids, id)
	}
}

// take 取出队列最前面的若干个资源。
//
// 取走的资源同时从去重表里移除：它们已经交给任务中心，之后内容再变
// （原地覆盖一张照片）还要能重新排进来。去重表留着的话，第二次改动
// 会被当成重复而丢掉 —— 旧的分析结果就一直留着。
func (q *analysisQueue) take(limit int) []string {
	if limit <= 0 || len(q.ids) == 0 {
		return nil
	}
	if limit > len(q.ids) {
		limit = len(q.ids)
	}
	taken := q.ids[:limit]
	q.ids = q.ids[limit:]
	for _, id := range taken {
		delete(q.seen, id)
	}
	return taken
}

// restore 把一批资源放回队列最前面，保持先来后到的顺序。
func (q *analysisQueue) restore(ids []string) {
	if len(ids) == 0 {
		return
	}
	q.ids = append(append(make([]string, 0, len(ids)+len(q.ids)), ids...), q.ids...)
	for _, id := range ids {
		q.seen[id] = struct{}{}
	}
}

// reset 清空队列。
func (q *analysisQueue) reset() {
	q.ids = nil
	q.seen = map[string]struct{}{}
}

// len 是队列里待分析的资源数量。
func (q *analysisQueue) len() int {
	return len(q.ids)
}

// analysisTask 是自动提交出去的一次分析任务。
//
// 它记着任务 ID 与这次负责的资源：任务失败时这批资源要放回队列，
// 否则这批照片的分析结果就永远补不上了。
type analysisTask struct {
	// jobID 是任务中心的任务 ID。
	jobID string
	// ids 是这次任务负责的资源；全库分析没有名单。
	ids []string
	// full 标记这是一次全库增量分析。
	full bool
}

// queueAnalysis 把变动的资源排进分析队列。
//
// 队列满了不丢任务：改成给该模块记一次全库增量分析，
// 由任务中心按文件指纹挑出真正需要重算的那些。
func (s *LibrarySyncService) queueAnalysis(resourceIDs []string) {
	if len(resourceIDs) == 0 {
		return
	}
	modules := s.analysisModules()
	if len(modules) == 0 {
		return
	}
	s.mu.Lock()
	if !s.settings.AutoAnalyze {
		s.mu.Unlock()
		return
	}
	for _, module := range modules {
		entry, exists := s.analysisQueue[module]
		if !exists {
			entry = newAnalysisQueue()
			s.analysisQueue[module] = entry
		}
		entry.push(resourceIDs)
		if entry.len() > maxAnalysisQueue {
			// 超出上限：队列清空，改成一次全库增量分析。
			// 丢掉的是「哪些文件排队了」这份名单，不是任务本身。
			entry.reset()
			s.analysisFull[module] = true
		}
	}
	// 排进了分析任务就要重算智能相册 ——
	// 哪怕每个模块的队列都被清空换成全库分析，那也是分析任务。
	// 只看队列长度会漏掉这一种：队列清空之后长度是零，
	// 但分析照样要跑，智能相册照样要跟着重算。
	s.markDirtyLocked()
	s.mu.Unlock()
	s.persistAnalysisState()
}

// markDirtyLocked 标记「分析结果变了，智能相册要重算」。
//
// 代号每次加一：刷新任务带着它启动时的代号回来，代号没变才说明
// 这次刷新覆盖了全部变化。刷新期间又有新照片进来时代号会变，
// 那次的刷新结果就不算数，标记要留着等下一轮。
func (s *LibrarySyncService) markDirtyLocked() {
	s.analysisDirty = true
	s.dirtyGeneration++
}

// pumpAnalysis 把排队的资源提交成分析任务。
//
// 一次只提交一批：任务中心同一时刻只跑一个任务，批次之间排队等它结束。
// 这样一次导入几千张照片也不会把任务中心一次塞满。
func (s *LibrarySyncService) pumpAnalysis(ctx context.Context) {
	if s.opts.Jobs == nil {
		return
	}
	s.mu.Lock()
	if !s.settings.AutoAnalyze || s.closed {
		s.mu.Unlock()
		return
	}
	s.mu.Unlock()

	// 图库还没建立时没有分析目标：等图库好了再排。
	if !s.opts.Catalog.Acquire().Ready() {
		return
	}
	// 刷新判断放在最后：不管这一轮排进去多少任务，
	// 都要重新看一眼智能相册要不要重算。
	defer s.refreshSmartAlbums()

	for _, module := range s.analysisTargets() {
		// 先结算上一次提交的任务：跑完了才算这批工作做完，
		// 跑失败时这批资源要放回队列重试。
		s.settleAnalysisTask(module)

		s.mu.Lock()
		task := s.analysisTasks[module]
		full := s.analysisFull[module]
		entry := s.analysisQueue[module]
		var ids []string
		if task == nil && !full && entry != nil && entry.len() > 0 {
			ids = entry.take(analysisBatchSize)
		}
		s.mu.Unlock()

		if task != nil {
			// 这个模块还有任务在跑：它自己会把这批资源处理掉。
			continue
		}
		if full {
			// 全库增量分析：任务中心按文件指纹挑出真正要重算的资源。
			//
			// 提交成功之前既不清标记也不清队列：模块不可用时（模型没装好、
			// 磁盘读不了）这次提交会失败，而失败的这次绝不能把这批工作
			// 一起丢掉 —— 标记留着，下一轮还会再试。
			job, _, err := s.opts.Jobs.Start(module, AIJobModeIncremental)
			if err != nil {
				if errors.Is(err, ErrAIJobActive) {
					// 任务中心正忙：标记原样留着，等下一轮再提交。
					return
				}
				s.recordAnalysisFailure(module, err)
				return
			}
			s.mu.Lock()
			s.analysisTasks[module] = &analysisTask{jobID: job.ID, full: true}
			s.mu.Unlock()
			s.persistAnalysisState()
			continue
		}
		if len(ids) == 0 {
			continue
		}
		sort.Strings(ids)

		job, _, err := s.opts.Jobs.StartForResources(module, ids)
		if err == nil {
			// 交给任务中心了：这批资源由它处理，跑完之前不再提交同一批。
			// 任务中途失败时这批要放回队列 —— 见 settleAnalysisTask。
			s.mu.Lock()
			s.analysisTasks[module] = &analysisTask{jobID: job.ID, ids: ids}
			s.mu.Unlock()
			s.persistAnalysisState()
			continue
		}
		if errors.Is(err, ErrAIJobActive) {
			// 任务中心正忙：放回去，等下一轮。
			s.restoreAnalysis(module, ids)
			return
		}
		// 模块暂时不可用（模型没装好、磁盘读不了）：这批留到下一轮再试。
		// 连续失败超过上限才放弃，不能静默丢掉。
		s.restoreAnalysis(module, ids)
		s.recordAnalysisFailure(module, err)
		return
	}
}

// settleAnalysisTask 结算某个模块正在跑的分析任务。
//
// 任务跑完才算这批工作做完：跑失败时这批资源要放回队列，全库分析则
// 要留着标记再提交一次 —— 提交成功就清标记的话，任务中途失败就再也没
// 人接手了，那批照片的分析结果永远补不上。
func (s *LibrarySyncService) settleAnalysisTask(module string) {
	s.mu.Lock()
	task := s.analysisTasks[module]
	s.mu.Unlock()
	if task == nil {
		return
	}
	job, ok := s.opts.Jobs.Get(task.jobID)
	if !ok {
		// 任务记录不见了（被清掉了）：当作失败处理，重新排队。
		s.mu.Lock()
		delete(s.analysisTasks, module)
		s.mu.Unlock()
		s.recordAnalysisFailure(module, errors.New("分析任务记录不见了"))
		return
	}
	switch job.Status {
	case AIJobStatusCompleted:
		s.mu.Lock()
		delete(s.analysisTasks, module)
		// 全库分析跑完了：这次欠的活还清，标记可以撤掉。
		// 只是一批资源的话不动标记 —— 批次跑完不等于这个模块的活干完了。
		if task.full {
			delete(s.analysisFull, module)
		}
		s.mu.Unlock()
		s.clearAnalysisFailure(module)
		s.persistAnalysisState()
	case AIJobStatusFailed, AIJobStatusCancelled:
		s.mu.Lock()
		delete(s.analysisTasks, module)
		s.mu.Unlock()
		if !task.full && len(task.ids) > 0 {
			// 这批资源没分析完：放回队列，下一轮重试。
			s.restoreAnalysis(module, task.ids)
		}
		s.recordAnalysisFailure(module, fmt.Errorf("分析任务 %s 结束于 %s", task.jobID, job.Status))
	}
}

// restoreAnalysis 把一批资源放回某个模块的队首。
func (s *LibrarySyncService) restoreAnalysis(module string, ids []string) {
	if len(ids) == 0 {
		return
	}
	s.mu.Lock()
	entry, exists := s.analysisQueue[module]
	if !exists {
		entry = newAnalysisQueue()
		s.analysisQueue[module] = entry
	}
	entry.restore(ids)
	s.mu.Unlock()
}

// recordAnalysisFailure 记下一次自动分析失败。
//
// 连续失败超过上限就放弃这批资源，并把原因如实记进状态 ——
// 不能悄悄丢掉，也不能无限重试。
func (s *LibrarySyncService) recordAnalysisFailure(module string, err error) {
	s.mu.Lock()
	s.analysisFailures[module]++
	failures := s.analysisFailures[module]
	exhausted := failures >= maxAnalysisRetries
	if exhausted {
		entry, exists := s.analysisQueue[module]
		if exists {
			entry.reset()
		}
		delete(s.analysisQueue, module)
		// 全库增量分析的标记也要一起撤掉：它已经试过这么多次了，
		// 留着只会让每一轮都重试一次，永远停不下来。
		delete(s.analysisFull, module)
	}
	s.mu.Unlock()
	log.Printf("自动分析失败 module=%s（第 %d 次）: %v", module, failures, err)
	s.persistAnalysisState()
	if !exhausted {
		return
	}
	s.recordError("analysis_queue_failed")
}

// clearAnalysisFailure 记下这个模块的分析任务成功跑完一次。
func (s *LibrarySyncService) clearAnalysisFailure(module string) {
	s.mu.Lock()
	delete(s.analysisFailures, module)
	s.mu.Unlock()
}

// refreshSmartAlbums 在自动分析跑完之后重算智能相册。
//
// 智能相册是派生结果：分析结果没更新之前重算没有意义，
// 因此等任务中心空闲下来再触发一次增量刷新。
//
// 清除标记的唯一条件是「刷新真的跑完了」。启动失败、刷新中途出错，
// 标记都要留着 —— 抹掉的话派生结果会一直停在旧状态，
// 而界面上看不出哪里不对，只能等用户手动点一次。
func (s *LibrarySyncService) refreshSmartAlbums() {
	s.mu.Lock()
	dirty := s.analysisDirty
	task := s.smartAlbumJob
	s.mu.Unlock()
	if !dirty {
		return
	}
	if s.opts.SmartAlbums == nil {
		s.mu.Lock()
		s.analysisDirty = false
		s.mu.Unlock()
		s.persistAnalysisState()
		return
	}

	// 上一次触发的刷新还没结束：等它。
	if task != "" {
		progress, ok := s.opts.SmartAlbums.Status(task)
		switch {
		case !ok:
			// 任务记录不见了：当作失败，重新触发一次。
			s.mu.Lock()
			s.smartAlbumJob = ""
			s.mu.Unlock()
		case progress.Status == SmartAlbumRefreshStatusComplete:
			s.mu.Lock()
			s.smartAlbumJob = ""
			// 刷新期间又有新照片进来时代号会变：
			// 那次的刷新结果覆盖不到新的变化，标记要留着。
			if s.dirtyGeneration == s.smartAlbumGeneration {
				s.analysisDirty = false
			}
			s.mu.Unlock()
			s.persistAnalysisState()
			return
		case progress.Status == SmartAlbumRefreshStatusError:
			// 刷新失败了：标记留着，过一会儿自动重试。
			log.Printf("智能相册刷新失败: %s", progress.Error)
			s.mu.Lock()
			s.smartAlbumJob = ""
			s.smartAlbumRetryAt = time.Now().Add(s.smartAlbumRetryDelay)
			s.mu.Unlock()
		case progress.Status == SmartAlbumRefreshStatusCancelled:
			// 用户主动取消的：不再自动重开。派生结果会停在旧状态，
			// 下次有新的分析任务时自然会再重算一次。
			log.Printf("智能相册刷新被取消: %s", progress.Error)
			s.mu.Lock()
			s.smartAlbumJob = ""
			s.analysisDirty = false
			s.mu.Unlock()
			s.persistAnalysisState()
			return
		default:
			// 还在跑：等下一轮再看。
			return
		}
	}

	// 刚失败过：等一会儿再试。一直失败时每一轮都重试一次，
	// 任务中心会被失败记录刷满，重试本身也变成一种负担。
	s.mu.Lock()
	retryAt := s.smartAlbumRetryAt
	s.mu.Unlock()
	if !retryAt.IsZero() && time.Now().Before(retryAt) {
		return
	}

	// 还有模块欠着分析：分析结果没更新之前重算没有意义。
	if s.hasPendingAnalysis() {
		return
	}
	// 任务中心还忙着：等下一轮再重算。
	if s.opts.Jobs != nil {
		snapshot := s.opts.Jobs.List()
		if snapshot.Active != nil || len(snapshot.Queue) > 0 {
			return
		}
	}

	id, _, err := s.opts.SmartAlbums.Start(false)
	if err != nil {
		// 启动失败：标记留着，过一会儿自动重试。
		log.Printf("智能相册增量刷新失败: %v", err)
		s.mu.Lock()
		s.smartAlbumRetryAt = time.Now().Add(s.smartAlbumRetryDelay)
		s.mu.Unlock()
		return
	}
	s.mu.Lock()
	s.smartAlbumJob = id
	s.smartAlbumGeneration = s.dirtyGeneration
	s.smartAlbumRetryAt = time.Time{}
	s.mu.Unlock()
}

// hasPendingAnalysis 报告还有没有模块欠着分析。
func (s *LibrarySyncService) hasPendingAnalysis() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.pendingModulesLocked()) > 0
}

// pendingModulesLocked 列出还欠着分析的模块。
//
// 欠着的口径有三种：队列里还有货、欠一次全库增量分析、有任务在跑。
// 三种都归到「这个模块的活还没干完」—— 智能相册要等它们全部干完。
func (s *LibrarySyncService) pendingModulesLocked() map[string]bool {
	pending := make(map[string]bool, len(s.analysisQueue)+len(s.analysisFull)+len(s.analysisTasks))
	for module, entry := range s.analysisQueue {
		if entry.len() > 0 {
			pending[module] = true
		}
	}
	for module := range s.analysisFull {
		pending[module] = true
	}
	for module := range s.analysisTasks {
		pending[module] = true
	}
	return pending
}

// pendingAnalysisModules 列出还欠着分析的模块（有序）。
func (s *LibrarySyncService) pendingAnalysisModules() []string {
	s.mu.Lock()
	pending := s.pendingModulesLocked()
	s.mu.Unlock()
	modules := make([]string, 0, len(pending))
	for module := range pending {
		modules = append(modules, module)
	}
	sort.Strings(modules)
	return modules
}

// analysisModules 返回自动分析要覆盖的模块。
//
// 只包含已经装好的模块；人脸分析还要看用户有没有打开。
func (s *LibrarySyncService) analysisModules() []string {
	if s.opts.Jobs == nil {
		return nil
	}
	snapshot := s.opts.Jobs.List()
	installed := make(map[string]bool, len(snapshot.Modules))
	for _, module := range snapshot.Modules {
		installed[module.Type] = module.Installed
	}
	peopleEnabled := snapshot.Settings.PeopleEnabled
	order := []string{AIJobTypeMetadata, AIJobTypeSimilarity, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace}
	modules := make([]string, 0, len(order))
	for _, module := range order {
		if !installed[module] {
			continue
		}
		if module == AIJobTypeFace && !peopleEnabled {
			continue
		}
		modules = append(modules, module)
	}
	return modules
}

// analysisTargets 返回这一轮要推进的模块。
//
// 已经装好的模块排在前面；欠着分析的模块也要试一次 ——
// 模型刚装好、磁盘刚挂上的时候，它们会重新变得可用。
func (s *LibrarySyncService) analysisTargets() []string {
	modules := s.analysisModules()
	seen := make(map[string]bool, len(modules))
	for _, module := range modules {
		seen[module] = true
	}
	for _, module := range s.pendingAnalysisModules() {
		if seen[module] {
			continue
		}
		seen[module] = true
		modules = append(modules, module)
	}
	return modules
}

// markFullAnalysis 给所有已装好的模块记一次全库增量分析。
//
// 用在「说不清是哪一张照片变了」的时候：全库增量分析按文件指纹
// （大小与修改时间）自己挑出真正要重算的那些，不会把整库重算一遍。
func (s *LibrarySyncService) markFullAnalysis() {
	modules := s.analysisModules()
	if len(modules) == 0 {
		return
	}
	s.mu.Lock()
	for _, module := range modules {
		s.analysisFull[module] = true
	}
	s.markDirtyLocked()
	s.mu.Unlock()
	s.persistAnalysisState()
}

// persistAnalysisState 把分析链路的中间状态写回磁盘。
//
// 这份状态是重启后能不能接上的关键：进程被杀时内存里的队列会没，
// 但磁盘上还留着「哪些模块欠着分析」的记录，重启后靠它补上。
func (s *LibrarySyncService) persistAnalysisState() {
	s.mu.Lock()
	pending := s.pendingModulesLocked()
	if s.state.AnalysisDirty == s.analysisDirty && sameStringSet(s.state.AnalysisPending, pending) {
		s.mu.Unlock()
		return
	}
	s.state.AnalysisDirty = s.analysisDirty
	s.state.AnalysisPending = pending
	s.mu.Unlock()
	s.saveState()
}

// sameStringSet 比较两份「键 → 真」的集合。
func sameStringSet(left, right map[string]bool) bool {
	if len(left) != len(right) {
		return false
	}
	for key, value := range left {
		if other, exists := right[key]; !exists || other != value {
			return false
		}
	}
	return true
}

// reconcileAnalysis 把校验扫描发现的差异排进分析。
//
// 校验走的是全量扫描：程序关闭期间磁盘上的变化不会有事件，
// 增量扫描那条路发现不了。差异算出来之后要排进分析 ——
// 否则新照片永远没有分析结果，派生索引就跟媒体库对不上。
func (s *LibrarySyncService) reconcileAnalysis(previous CatalogSnapshot) {
	if s.opts.Jobs == nil {
		return
	}
	s.mu.Lock()
	autoAnalyze := s.settings.AutoAnalyze
	s.mu.Unlock()
	if !autoAnalyze {
		return
	}
	current := s.opts.Catalog.Acquire()
	if !current.Ready() {
		return
	}
	added, removed, contentChanged := diffCatalogMedia(previous.Result(), current.Result())
	if len(removed) > 0 {
		// 离开图库的资源：它的分析结果一并作废，
		// 避免派生数据里留着已经没有对应文件的照片。
		ids := make([]string, 0, len(removed))
		for _, path := range removed {
			if id := previous.ExternalID(path, ResourceFile); id != "" {
				ids = append(ids, id)
			}
		}
		s.opts.Jobs.ForgetResources(ids)
	}
	if contentChanged {
		// 有文件被原地改写过，但内容指纹是整本相册聚合出来的，
		// 说不清是哪一张：让全库增量分析按文件指纹自己挑。
		s.markFullAnalysis()
	}
	if len(added) == 0 {
		return
	}
	ids := make([]string, 0, len(added))
	for _, path := range added {
		if id := current.ExternalID(path, ResourceFile); id != "" {
			ids = append(ids, id)
		}
	}
	s.queueAnalysis(ids)
}

// diffCatalogMedia 比较两次扫描结果，算出新增、消失与内容变动的媒体文件。
//
// 相册按路径配对：路径没变的相册比文件清单；清单没变但内容指纹变了，
// 说明有文件被原地改写过 —— 内容指纹是整本相册聚合出来的，说不清是
// 哪一张，那种情况由调用方改成一次全库增量分析。
func diffCatalogMedia(previous, current *models.ScanResult) (added, removed []string, contentChanged bool) {
	if current == nil {
		return nil, nil, false
	}
	oldAlbums := albumIndexByPath(previous)
	newAlbums := albumIndexByPath(current)
	for path, album := range newAlbums {
		old, exists := oldAlbums[path]
		if !exists {
			added = append(added, albumFiles(album)...)
			continue
		}
		addedFiles, removedFiles := diffFileSets(albumFiles(old), albumFiles(album))
		added = append(added, addedFiles...)
		removed = append(removed, removedFiles...)
		if len(addedFiles) == 0 && len(removedFiles) == 0 &&
			old.ContentSignature != "" && old.ContentSignature != album.ContentSignature {
			contentChanged = true
		}
	}
	for path, album := range oldAlbums {
		if _, exists := newAlbums[path]; !exists {
			removed = append(removed, albumFiles(album)...)
		}
	}
	sort.Strings(added)
	sort.Strings(removed)
	return added, removed, contentChanged
}

// albumIndexByPath 按相册路径给扫描结果里的相册建索引。
func albumIndexByPath(result *models.ScanResult) map[string]*models.Album {
	index := make(map[string]*models.Album)
	if result == nil {
		return index
	}
	albums := flattenAlbums(result.Albums, result.Collections)
	for i := range albums {
		index[filepath.Clean(albums[i].Path)] = &albums[i]
	}
	return index
}
