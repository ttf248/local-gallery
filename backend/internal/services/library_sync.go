package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// LibrarySyncSettings 是自动发现文件变化的开关。
type LibrarySyncSettings struct {
	// Enabled 打开后监听媒体根，文件变化时增量更新图库。
	Enabled bool `json:"enabled"`
	// AutoAnalyze 打开后在增量更新后为变动的照片自动排分析任务。
	AutoAnalyze bool `json:"autoAnalyze"`
}

// LibrarySyncStatus 是自动发现文件变化的运行状态。
type LibrarySyncStatus struct {
	Enabled      bool `json:"enabled"`
	AutoAnalyze  bool `json:"autoAnalyze"`
	Running      bool `json:"running"`
	Degraded     bool `json:"degraded"`
	WatchedRoots int  `json:"watchedRoots"`
	WatchedDirs  int  `json:"watchedDirs"`
	MaxWatchDirs int  `json:"maxWatchDirs"`
	// PendingChanges 是已经收到但还没合并进图库的变化条目数。
	PendingChanges int `json:"pendingChanges"`
	// PendingAnalysis 是已经排队等待分析的资源数量。
	PendingAnalysis int       `json:"pendingAnalysis"`
	LastEventAt     time.Time `json:"lastEventAt,omitempty"`
	LastVerifyAt    time.Time `json:"lastVerifyAt,omitempty"`
	LastSyncAt      time.Time `json:"lastSyncAt,omitempty"`
	// LastDetected 是上次同步里检测到的变化条目数。
	LastDetected int `json:"lastDetected"`
	// LastUpdated 是上次同步里真正改动索引的资源数量。
	LastUpdated int `json:"lastUpdated"`
	// LastFailed 是上次同步里失败的重读次数。
	LastFailed int `json:"lastFailed"`
	// LastError 是最近一次失败的机器可读原因。
	LastError string `json:"lastError,omitempty"`
	// LibraryRevision 是当前图库版本。图库一变它就变，
	// 界面据此判断要不要重新拉数据。
	LibraryRevision uint64 `json:"libraryRevision"`
}

// librarySyncState 是持久化到磁盘的状态。
//
// 它放在 state/ 目录：开关是用户的决定，不是可以从磁盘重建的缓存。
type librarySyncState struct {
	Enabled      bool      `json:"enabled"`
	AutoAnalyze  bool      `json:"autoAnalyze"`
	LastEventAt  time.Time `json:"lastEventAt,omitempty"`
	LastVerifyAt time.Time `json:"lastVerifyAt,omitempty"`
	LastSyncAt   time.Time `json:"lastSyncAt,omitempty"`
	LastDetected int       `json:"lastDetected"`
	LastUpdated  int       `json:"lastUpdated"`
	LastFailed   int       `json:"lastFailed"`
	LastError    string    `json:"lastError,omitempty"`
}

// LibrarySyncOptions 是自动同步服务的构造参数。
type LibrarySyncOptions struct {
	// StatePath 是开关与状态的持久化文件位置。
	StatePath string
	// Roots 返回当前的媒体根；配置变更后由它拿到最新集合。
	Roots func() []string
	// Exclude 返回当前的扫描排除规则。
	Exclude func() ExcludeConfig
	// Catalog 是资源索引；增量结果在它上面原子发布。
	Catalog *ResourceCatalog
	// Cache 是扫描结果的磁盘副本。
	Cache *ScanResultCache
	// Covers 是用户封面覆盖。
	Covers *CoverOverrideStore
	// Runner 是扫描任务持有者；增量结果与全量扫描共用它的提交锁。
	Runner *AsyncScanRunner
	// Jobs 是分析任务服务；自动分析走它排队，复用现有任务中心。
	Jobs *AIJobService
	// VerifyInterval 是定期校验（兜底全量扫描）的间隔。
	VerifyInterval time.Duration
	// WatchDebounce 是目录事件的静默窗口。
	WatchDebounce time.Duration
	// WatchMaxWait 是一批变化的最长等待时间。
	WatchMaxWait time.Duration
	// SmartAlbums 触发智能相册的增量刷新；为空则不联动。
	SmartAlbums SmartAlbumRefresher
	// OnLibraryUpdated 在图库版本更新后回调，供界面刷新。
	OnLibraryUpdated func(revision uint64)
}

// SmartAlbumRefresher 是智能相册刷新的最小接口。
//
// 智能相册是派生结果：照片变了、分析结果更新了之后要重算分组，
// 但重算很贵，因此只在自动分析真的跑完之后才触发一次。
type SmartAlbumRefresher interface {
	Start(force bool) (string, bool, error)
}

const (
	// defaultVerifyInterval 是定期校验的默认间隔。
	//
	// 监听失效（网络共享抖动、事件溢出、权限不足）时靠它兜底；
	// 间隔太长会让图库长时间落后于磁盘，太短则白跑全量扫描。
	defaultVerifyInterval = 30 * time.Minute
	// syncRetryInterval 是重试间隔：全量扫描在跑、任务队列在忙时，
	// 累积的变化每隔这段时间重试一次。
	syncRetryInterval = 3 * time.Second
	// startupVerifyDelay 是启动后多久做一次校验。
	//
	// 程序关闭期间磁盘上的变化不会产生事件，启动校验负责把它们补上。
	startupVerifyDelay = 15 * time.Second
	// maxAnalysisQueue 是自动分析排队等待的资源上限。
	//
	// 一次大批量导入可能带来上万个资源；全部排进任务中心会让队列
	// 失去意义。超出上限时不丢任务，而是改成让该模块做一次全库增量
	// 分析 —— 任务中心会按文件指纹挑出真正需要重算的那些。
	maxAnalysisQueue = 5000
	// analysisBatchSize 是自动分析一次提交给任务中心的资源数量上限。
	//
	// 分批提交让一次大批量导入能够连续跑完：任务中心同一时刻只跑一批，
	// 下一批等上一批结束再排。
	analysisBatchSize = 500
	// maxAnalysisRetries 是自动分析排队连续失败的重试上限。
	//
	// 失败要能恢复（模型刚装好、磁盘刚恢复），但也不能无限重试：
	// 超过上限就放弃这批并如实记下原因。
	maxAnalysisRetries = 3
	// maxIncrementalRetries 是增量扫描连续失败的重试上限。
	//
	// 失败的变化必须留着等下一轮；但磁盘一直读不了时也不能无限重试，
	// 超过上限就交给一次全量校验把图库对齐。
	maxIncrementalRetries = 5
	// maxPendingChanges 是待处理变化集合的上限。
	//
	// 图库长时间不可用时变化会一直攒着；攒到上限就丢掉旧的 ——
	// 一次全量校验会把它们全部覆盖掉。
	maxPendingChanges = 20000
)

// incrementalScanner 是增量扫描引擎的最小接口。
//
// 抽成接口是为了让「扫描失败后怎么办」这条路径能被测试覆盖：
// 真让磁盘读不出来很难在测试里稳定复现。
type incrementalScanner interface {
	Apply(previous *models.ScanResult, changes *SyncChangeSet, opts ScanOptions) (*IncrementalOutcome, error)
}

// LibrarySyncService 把目录监听、增量扫描与分析任务串成一条链路。
//
//   - 监听器把连续的文件事件合并成批次；
//   - 增量引擎只重读受影响目录，把结果原子发布到资源索引；
//   - 分析任务按差异排队，不会因为一次文件变化重跑整个图库；
//   - 监听不可靠时由定期校验兜底。
type LibrarySyncService struct {
	opts   LibrarySyncOptions
	engine incrementalScanner

	mu       sync.Mutex
	stateMu  sync.Mutex
	settings LibrarySyncSettings
	state    librarySyncState
	watcher  *ChangeWatcher
	pending  *SyncChangeSet
	// pendingRetries 是待处理变化连续失败的次数。
	pendingRetries int
	// analysisQueue 是「模块 → 待分析资源」的排队表。
	analysisQueue map[string]*analysisQueue
	// analysisFull 标记某些模块要做一次全库增量分析。
	analysisFull map[string]bool
	// analysisFailures 是各模块排队连续失败的次数。
	analysisFailures map[string]int
	// analysisDirty 标记「有变化需要重算智能相册」。
	analysisDirty bool
	// pendingOverflow 标记待处理的变化曾经多到被丢弃过：
	// 那说明逐条处理已经不划算了，要靠一次全量校验兜底。
	pendingOverflow bool
	wake            chan struct{}
	ctx             context.Context
	cancel          context.CancelFunc
	closed          bool
	verifyAt        time.Time
}

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

// NewLibrarySyncService 创建自动同步服务并读取已保存的开关。
func NewLibrarySyncService(opts LibrarySyncOptions) (*LibrarySyncService, error) {
	if opts.StatePath == "" {
		return nil, errors.New("library sync service requires a state path")
	}
	if opts.Roots == nil || opts.Catalog == nil {
		return nil, errors.New("library sync service requires roots and a catalog")
	}
	if opts.VerifyInterval <= 0 {
		opts.VerifyInterval = defaultVerifyInterval
	}
	service := &LibrarySyncService{
		opts:             opts,
		engine:           NewIncrementalEngine(),
		pending:          newSyncChangeSet(),
		analysisQueue:    make(map[string]*analysisQueue),
		analysisFull:     make(map[string]bool),
		analysisFailures: make(map[string]int),
		wake:             make(chan struct{}, 1),
	}
	if err := service.loadState(); err != nil {
		return nil, err
	}
	return service, nil
}

// loadState 读取磁盘上的开关与状态。
func (s *LibrarySyncService) loadState() error {
	data, err := os.ReadFile(s.opts.StatePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			// 首次使用：默认打开自动发现，默认不自动分析。
			// 内存里的两份记录都要写全，否则下一次落盘会把开关写成关闭。
			s.settings = LibrarySyncSettings{Enabled: true, AutoAnalyze: false}
			s.state = librarySyncState{Enabled: true, AutoAnalyze: false}
			return nil
		}
		return fmt.Errorf("read library sync state: %w", err)
	}
	var state librarySyncState
	if err := json.Unmarshal(data, &state); err != nil {
		return fmt.Errorf("parse library sync state: %w", err)
	}
	s.state = state
	s.settings = LibrarySyncSettings{Enabled: state.Enabled, AutoAnalyze: state.AutoAnalyze}
	return nil
}

// saveState 把开关与状态写回磁盘。
//
// 写盘单独加一把锁：Windows 上重命名覆盖正在被读的文件会失败，
// 事件与同步两条路径可能同时落盘，串行化才不会互相踩。
//
// 开关取自 settings 而不是 state：两者是同一件事的两个副本，
// 只写其中一个会让磁盘上的开关与内存里的对不上 —— 首次运行时
// 状态文件还不存在，下一次落盘就会把「已打开」写成「已关闭」。
func (s *LibrarySyncService) saveState() {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	s.mu.Lock()
	state := s.state
	state.Enabled = s.settings.Enabled
	state.AutoAnalyze = s.settings.AutoAnalyze
	s.mu.Unlock()
	data, err := json.MarshalIndent(state, "", "  ")
	if err != nil {
		log.Printf("库同步状态序列化失败: %v", err)
		return
	}
	if err := os.MkdirAll(filepath.Dir(s.opts.StatePath), 0o755); err != nil {
		log.Printf("库同步状态目录创建失败: %v", err)
		return
	}
	temporary, err := os.CreateTemp(filepath.Dir(s.opts.StatePath), ".library-sync-*.tmp")
	if err != nil {
		log.Printf("库同步状态临时文件创建失败: %v", err)
		return
	}
	name := temporary.Name()
	defer os.Remove(name)
	if _, err = temporary.Write(data); err == nil {
		err = temporary.Sync()
	}
	closeErr := temporary.Close()
	if err == nil {
		err = closeErr
	}
	if err == nil {
		err = os.Rename(name, s.opts.StatePath)
	}
	if err != nil {
		log.Printf("库同步状态写入失败: %v", err)
	}
}

// Start 启动自动同步。
//
// 打开开关时会立刻建立监听；关闭时只保留设置，不监听磁盘。
func (s *LibrarySyncService) Start(ctx context.Context) error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return errors.New("library sync service is closed")
	}
	s.ctx, s.cancel = context.WithCancel(ctx)
	enabled := s.settings.Enabled
	s.verifyAt = time.Now().Add(startupVerifyDelay)
	s.mu.Unlock()

	if enabled {
		if err := s.startWatcher(); err != nil {
			s.recordError("watcher_start_failed")
			return err
		}
	}
	go s.loop(s.ctx)
	return nil
}

// Shutdown 停止自动同步并释放监听句柄。
func (s *LibrarySyncService) Shutdown() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	cancel := s.cancel
	watcher := s.watcher
	s.watcher = nil
	s.mu.Unlock()
	if cancel != nil {
		cancel()
	}
	if watcher != nil {
		_ = watcher.Close()
	}
}

// Update 修改开关。
func (s *LibrarySyncService) Update(ctx context.Context, settings LibrarySyncSettings) (LibrarySyncStatus, error) {
	s.mu.Lock()
	previous := s.settings
	s.settings = settings
	s.mu.Unlock()
	s.saveState()

	switch {
	case settings.Enabled && !previous.Enabled:
		if err := s.startWatcher(); err != nil {
			s.recordError("watcher_start_failed")
			return s.Status(), err
		}
		// 监听关着的那段时间里磁盘上的变化不会有事件：
		// 重新打开后要补一次校验，把这段时间漏掉的找回来。
		s.scheduleVerify(time.Now().Add(startupVerifyDelay))
	case !settings.Enabled && previous.Enabled:
		s.stopWatcher()
	}
	return s.Status(), nil
}

// SetRoots 在媒体根变更后重新登记监听。
func (s *LibrarySyncService) SetRoots(ctx context.Context) {
	s.mu.Lock()
	enabled := s.settings.Enabled
	watcher := s.watcher
	s.mu.Unlock()
	if !enabled || watcher == nil {
		return
	}
	watcher.SetRoots(ctx, s.opts.Roots())
}

// Status 返回当前的运行状态。
func (s *LibrarySyncService) Status() LibrarySyncStatus {
	s.mu.Lock()
	state := s.state
	settings := s.settings
	pending := s.pending.Size()
	queued := 0
	for _, entry := range s.analysisQueue {
		queued += entry.len()
	}
	watcher := s.watcher
	s.mu.Unlock()

	status := LibrarySyncStatus{
		Enabled:         settings.Enabled,
		AutoAnalyze:     settings.AutoAnalyze,
		Running:         false,
		PendingChanges:  pending,
		PendingAnalysis: queued,
		LastEventAt:     state.LastEventAt,
		LastVerifyAt:    state.LastVerifyAt,
		LastSyncAt:      state.LastSyncAt,
		LastDetected:    state.LastDetected,
		LastUpdated:     state.LastUpdated,
		LastFailed:      state.LastFailed,
		LastError:       state.LastError,
		LibraryRevision: s.opts.Catalog.Acquire().Revision(),
	}
	if watcher != nil {
		watchStatus := watcher.Status()
		status.Running = watchStatus.Running
		status.Degraded = watchStatus.Degraded
		status.WatchedRoots = watchStatus.WatchedRoots
		status.WatchedDirs = watchStatus.WatchedDirs
		status.MaxWatchDirs = watchStatus.MaxWatchDirs
		if !watchStatus.LastEventAt.IsZero() {
			status.LastEventAt = watchStatus.LastEventAt
		}
	}
	return status
}

// startWatcher 建立目录监听。
func (s *LibrarySyncService) startWatcher() error {
	roots := s.opts.Roots()
	if len(roots) == 0 {
		return errors.New("no media roots to watch")
	}
	exclude := ExcludeConfig{}
	if s.opts.Exclude != nil {
		exclude = s.opts.Exclude()
	}
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:    roots,
		Exclude:  exclude,
		Debounce: s.opts.WatchDebounce,
		MaxWait:  s.opts.WatchMaxWait,
		OnChange: func(changes *SyncChangeSet) {
			s.onChange(changes)
		},
		OnError: func(err error) {
			log.Printf("目录监听异常: %v", err)
			s.recordError("watch_failed")
			// 监听不可靠时立刻做一次校验，把漏掉的变化补回来。
			s.scheduleVerify(time.Now().Add(5 * time.Second))
		},
		OnRootError: func(root string, err error) {
			// 单个媒体根读不到（离线磁盘、断开的网络共享）：
			// 其余根照常工作，这不是监听器降级。
			log.Printf("媒体根无法监听 %s: %v", filepath.Base(root), err)
			s.recordError("root_unavailable")
		},
	})
	if err != nil {
		return err
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		_ = watcher.Close()
		return errors.New("library sync service is closed")
	}
	previous := s.watcher
	s.watcher = watcher
	s.mu.Unlock()
	if previous != nil {
		_ = previous.Close()
	}
	if err := watcher.Start(s.ctx); err != nil {
		return err
	}
	return nil
}

// stopWatcher 停止目录监听。
func (s *LibrarySyncService) stopWatcher() {
	s.mu.Lock()
	watcher := s.watcher
	s.watcher = nil
	s.mu.Unlock()
	if watcher != nil {
		_ = watcher.Close()
	}
}

// onChange 收到一批文件变化。
func (s *LibrarySyncService) onChange(changes *SyncChangeSet) {
	if changes == nil || changes.Empty() {
		return
	}
	s.mu.Lock()
	s.pending.Merge(changes)
	s.trimPendingLocked()
	s.state.LastEventAt = time.Now()
	s.mu.Unlock()
	s.saveState()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// trimPendingLocked 给待处理的变化集合封顶。
//
// 图库长时间不可用时（例如媒体根离线导致图库还没建立），变化会一直
// 攒着。攒到上限之后，多出来的变化没有价值 —— 一次全量校验会把它们
// 全部覆盖掉 —— 直接丢掉，内存才有界。
func (s *LibrarySyncService) trimPendingLocked() {
	if s.pending.Size() <= maxPendingChanges {
		return
	}
	s.pending = newSyncChangeSet()
	s.pendingOverflow = true
}

// loop 是自动同步的主循环。
func (s *LibrarySyncService) loop(ctx context.Context) {
	ticker := time.NewTicker(syncRetryInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-s.wake:
			s.processPending(ctx)
		case <-ticker.C:
			s.processPending(ctx)
			s.maybeVerify(ctx)
			s.pumpAnalysis(ctx)
		}
	}
}

// processPending 把累积的变化合并进图库。
func (s *LibrarySyncService) processPending(ctx context.Context) {
	s.mu.Lock()
	pending := s.pending
	s.pending = newSyncChangeSet()
	s.mu.Unlock()
	if pending.Empty() {
		return
	}

	// 全量扫描正在跑时先攒着：它会发布一份更新的结果，
	// 我们的增量应当基于那一份来算。
	if s.opts.Runner != nil && s.opts.Runner.HasActiveScan() {
		s.requeue(pending)
		return
	}

	snapshot := s.opts.Catalog.Acquire()
	if !snapshot.Ready() {
		// 图库还没建立，等下一次重试。
		s.requeue(pending)
		return
	}
	previous := snapshot.Result()
	revision := snapshot.Revision()

	outcome, err := s.engine.Apply(previous, pending, s.scanOptions())
	if err != nil {
		s.recordError("incremental_failed")
		log.Printf("增量扫描失败: %v", err)
		// 失败不能把变化丢掉：这批变化放回队列，等下一轮再试。
		s.retryPending(pending)
		return
	}
	if outcome == nil || outcome.Result == nil {
		s.restorePending(pending)
		return
	}
	if !outcome.Changed {
		// 图库结构与内容都没变（例如只是目录被碰了一下）：不发布，
		// 图库版本不跳动，界面也不用白刷一遍。
		s.clearPendingRetries()
		return
	}
	s.clearPendingRetries()

	// 发布前先记下离开图库的资源：它们在旧快照里还有 ID，
	// 发布之后就没法再解析了。
	removedIDs := make([]string, 0, len(outcome.RemovedFiles))
	for _, file := range outcome.RemovedFiles {
		if id := snapshot.ExternalID(file, ResourceFile); id != "" {
			removedIDs = append(removedIDs, id)
		}
	}

	roots := s.opts.Roots()
	_, newRevision, ok := s.commit(outcome.Result, roots, revision)
	if !ok {
		// 期间有别的发布（全量扫描或改封面）：基于新的图库重算。
		s.requeue(pending)
		return
	}

	changed := s.collectChangedResources(outcome, pending)
	s.mu.Lock()
	s.state.LastSyncAt = time.Now()
	s.state.LastDetected = pending.Size()
	s.state.LastUpdated = outcome.ChangedResourceCount()
	s.state.LastFailed = len(outcome.Warnings)
	s.state.LastError = ""
	s.mu.Unlock()
	s.saveState()

	// 离开图库的资源：它的分析结果一并作废，避免派生数据里留着
	// 已经没有对应文件的照片。
	if len(removedIDs) > 0 && s.opts.Jobs != nil {
		s.opts.Jobs.ForgetResources(removedIDs)
	}

	if s.opts.OnLibraryUpdated != nil {
		s.opts.OnLibraryUpdated(newRevision)
	}
	s.queueAnalysis(changed)
}

// commit 在扫描任务的提交锁下发布增量结果。
func (s *LibrarySyncService) commit(
	result *models.ScanResult,
	roots []string,
	expectedRevision uint64,
) (*models.ScanResult, uint64, bool) {
	if s.opts.Runner != nil {
		return s.opts.Runner.CommitIncremental(result, roots, expectedRevision)
	}
	s.opts.Catalog.publishMu.Lock()
	defer s.opts.Catalog.publishMu.Unlock()
	if s.opts.Catalog.Acquire().Revision() != expectedRevision {
		return nil, 0, false
	}
	published, revision := s.opts.Catalog.CommitScan(result, roots, s.opts.Cache, s.opts.Covers)
	return published, revision, true
}

// collectChangedResources 收集这次变化里真正需要重新分析的资源。
//
// 新增的文件与被改写的文件都要重新分析：改写的照片内容变了，
// 旧的分析结果已经对不上。删除的资源不需要分析，
// 它们的结果作废即可。
func (s *LibrarySyncService) collectChangedResources(
	outcome *IncrementalOutcome,
	pending *SyncChangeSet,
) []string {
	published := s.opts.Catalog.Acquire()
	ids := make(map[string]struct{})
	add := func(path string) {
		if path == "" {
			return
		}
		if id := published.ExternalID(path, ResourceFile); id != "" {
			ids[id] = struct{}{}
		}
	}
	for _, file := range outcome.AddedFiles {
		add(file)
	}
	for file := range pending.Files {
		add(file)
	}
	result := make([]string, 0, len(ids))
	for id := range ids {
		result = append(result, id)
	}
	sort.Strings(result)
	return result
}

// queueAnalysis 把变动的资源排进分析队列。
//
// 队列满了不丢任务：改成给该模块记一次全库增量分析，
// 由任务中心按文件指纹挑出真正需要重算的那些。
func (s *LibrarySyncService) queueAnalysis(resourceIDs []string) {
	if len(resourceIDs) == 0 {
		return
	}
	s.mu.Lock()
	if !s.settings.AutoAnalyze {
		s.mu.Unlock()
		return
	}
	queued := 0
	for _, module := range s.analysisModules() {
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
		queued += entry.len()
	}
	// 只有真的排进了分析任务才需要重算智能相册。
	s.analysisDirty = s.analysisDirty || queued > 0
	s.mu.Unlock()
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
	modules := s.analysisModules()
	s.mu.Unlock()

	for _, module := range modules {
		s.mu.Lock()
		full := s.analysisFull[module]
		entry := s.analysisQueue[module]
		if !full && (entry == nil || entry.len() == 0) {
			s.mu.Unlock()
			continue
		}
		var ids []string
		if full {
			// 全库增量分析：任务中心按文件指纹挑出真正要重算的资源。
			// 任务中心正忙时把标记放回去，等下一轮再提交 ——
			// 放掉就等于这批任务没人接手了。
			delete(s.analysisFull, module)
			if entry != nil {
				entry.reset()
			}
			s.mu.Unlock()
			if _, _, err := s.opts.Jobs.Start(module, AIJobModeIncremental); err != nil {
				if errors.Is(err, ErrAIJobActive) {
					s.mu.Lock()
					s.analysisFull[module] = true
					s.mu.Unlock()
					return
				}
				s.recordAnalysisFailure(module, err)
				return
			}
			s.clearAnalysisFailure(module)
			continue
		}
		ids = entry.take(analysisBatchSize)
		s.mu.Unlock()
		sort.Strings(ids)

		_, _, err := s.opts.Jobs.StartForResources(module, ids)
		if err == nil {
			s.clearAnalysisFailure(module)
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
	s.refreshSmartAlbums()
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

// recordAnalysisFailure 记下一次自动分析排队失败。
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
	}
	s.mu.Unlock()
	log.Printf("自动分析排队失败 module=%s（第 %d 次）: %v", module, failures, err)
	if !exhausted {
		return
	}
	s.recordError("analysis_queue_failed")
}

// clearAnalysisFailure 记下这个模块排队成功过一次。
func (s *LibrarySyncService) clearAnalysisFailure(module string) {
	s.mu.Lock()
	delete(s.analysisFailures, module)
	s.mu.Unlock()
}

// refreshSmartAlbums 在自动分析跑完之后重算智能相册。
//
// 智能相册是派生结果：分析结果没更新之前重算没有意义，
// 因此等任务中心空闲下来再触发一次增量刷新。
func (s *LibrarySyncService) refreshSmartAlbums() {
	s.mu.Lock()
	dirty := s.analysisDirty
	s.analysisDirty = false
	queued := 0
	for _, entry := range s.analysisQueue {
		queued += entry.len()
	}
	s.mu.Unlock()
	if !dirty || queued > 0 || s.opts.SmartAlbums == nil {
		return
	}
	snapshot := s.opts.Jobs.List()
	if snapshot.Active != nil || len(snapshot.Queue) > 0 {
		// 任务中心还忙着：等下一轮再重算。
		s.mu.Lock()
		s.analysisDirty = true
		s.mu.Unlock()
		return
	}
	if _, _, err := s.opts.SmartAlbums.Start(false); err != nil {
		log.Printf("智能相册增量刷新失败: %v", err)
	}
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

// maybeVerify 到点做一次校验扫描，兜住监听漏掉的变化。
func (s *LibrarySyncService) maybeVerify(ctx context.Context) {
	s.mu.Lock()
	due := !s.verifyAt.IsZero() && time.Now().After(s.verifyAt)
	if due {
		// 校验完要排下一次：不排的话只会在启动后校验一次，
		// 之后监听再漏掉变化就永远补不回来了。
		s.verifyAt = time.Now().Add(s.opts.VerifyInterval)
	}
	overflow := s.pendingOverflow
	s.pendingOverflow = false
	enabled := s.settings.Enabled
	s.mu.Unlock()
	if !enabled {
		return
	}
	if overflow {
		// 攒下的变化多到被丢掉了：一次全量校验把它们一次性对齐。
		s.runVerification(ctx)
		return
	}
	if !due {
		return
	}
	s.runVerification(ctx)
}

// scheduleVerify 安排一次校验扫描。
//
// 只能提前，不能推后：监听出错时要尽快补一次漏掉的变化。
func (s *LibrarySyncService) scheduleVerify(at time.Time) {
	s.mu.Lock()
	if s.verifyAt.IsZero() || at.Before(s.verifyAt) {
		s.verifyAt = at
	}
	s.mu.Unlock()
}

// runVerification 跑一次全量扫描作为校验。
//
// 校验用的是既有的扫描任务：进度、取消、SSE 全部复用，
// 不新增第二套任务体系。
func (s *LibrarySyncService) runVerification(ctx context.Context) {
	if s.opts.Runner == nil {
		return
	}
	opts := s.scanOptions()
	if len(opts.Roots) == 0 {
		return
	}
	id, _, err := s.opts.Runner.StartOrReuse(opts)
	if err != nil {
		s.recordError("verification_failed")
		return
	}
	go func() {
		ticker := time.NewTicker(500 * time.Millisecond)
		defer ticker.Stop()
		for {
			state := s.opts.Runner.Get(id)
			if state == nil {
				return
			}
			switch state.Status {
			case ScanStatusComplete:
				s.markVerified()
				return
			case ScanStatusCancelled, ScanStatusError:
				return
			}
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

// markVerified 记录一次成功校验。
func (s *LibrarySyncService) markVerified() {
	s.mu.Lock()
	s.state.LastVerifyAt = time.Now()
	s.mu.Unlock()
	s.saveState()
}

// recordError 记录一次失败原因。
func (s *LibrarySyncService) recordError(code string) {
	s.mu.Lock()
	s.state.LastError = code
	s.mu.Unlock()
	s.saveState()
}

// requeue 把一批变化放回队列，等下一轮再处理。
func (s *LibrarySyncService) requeue(changes *SyncChangeSet) {
	if !s.restorePending(changes) {
		return
	}
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// restorePending 把一批变化放回待处理集合。
//
// 返回值表示这批变化是否真的被放回去了（空批次不算）。
func (s *LibrarySyncService) restorePending(changes *SyncChangeSet) bool {
	if changes == nil || changes.Empty() {
		return false
	}
	s.mu.Lock()
	s.pending.Merge(changes)
	s.trimPendingLocked()
	s.mu.Unlock()
	return true
}

// retryPending 安排一批失败的变化稍后重试。
//
// 这里不唤醒主循环：立即重试会变成忙等 —— 磁盘一直读不了时，
// 主循环会一秒几百次地重扫同一批变化。交给定时器，节奏才是固定的。
//
// 连续失败超过上限就放弃这批变化，改用一次全量校验把图库对齐：
// 逐条重试已经没有意义，全量校验会把这些变化一次性覆盖掉。
func (s *LibrarySyncService) retryPending(changes *SyncChangeSet) {
	s.mu.Lock()
	s.pendingRetries++
	failures := s.pendingRetries
	exhausted := failures >= maxIncrementalRetries
	s.mu.Unlock()
	if exhausted {
		log.Printf("增量扫描连续失败 %d 次，改用全量校验对齐图库", failures)
		s.mu.Lock()
		s.pendingRetries = 0
		s.pendingOverflow = true
		s.mu.Unlock()
		return
	}
	s.restorePending(changes)
}

// clearPendingRetries 记下这一轮增量扫描成功了。
func (s *LibrarySyncService) clearPendingRetries() {
	s.mu.Lock()
	s.pendingRetries = 0
	s.mu.Unlock()
}

// scanOptions 构造扫描选项。
func (s *LibrarySyncService) scanOptions() ScanOptions {
	exclude := ExcludeConfig{}
	if s.opts.Exclude != nil {
		exclude = s.opts.Exclude()
	}
	return ScanOptions{Roots: s.opts.Roots(), Exclude: exclude}
}
