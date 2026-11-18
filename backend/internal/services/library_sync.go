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
	// 失去意义。超出上限时只保留最新的一批，其余交给后续批次。
	maxAnalysisQueue = 5000
)

// LibrarySyncService 把目录监听、增量扫描与分析任务串成一条链路。
//
//   - 监听器把连续的文件事件合并成批次；
//   - 增量引擎只重读受影响目录，把结果原子发布到资源索引；
//   - 分析任务按差异排队，不会因为一次文件变化重跑整个图库；
//   - 监听不可靠时由定期校验兜底。
type LibrarySyncService struct {
	opts   LibrarySyncOptions
	engine *IncrementalEngine

	mu       sync.Mutex
	stateMu  sync.Mutex
	settings LibrarySyncSettings
	state    librarySyncState
	watcher  *ChangeWatcher
	pending  *SyncChangeSet
	// analysisQueue 是「模块 → 待分析资源」的排队表。
	analysisQueue map[string]map[string]struct{}
	// removedResources 是已经离开图库、但分析结果还没作废的资源。
	removedResources map[string]struct{}
	// analysisDirty 标记「有变化需要重算智能相册」。
	analysisDirty bool
	wake          chan struct{}
	ctx           context.Context
	cancel        context.CancelFunc
	closed        bool
	verifyAt      time.Time
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
		analysisQueue:    make(map[string]map[string]struct{}),
		removedResources: make(map[string]struct{}),
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
			s.settings = LibrarySyncSettings{Enabled: true, AutoAnalyze: false}
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
func (s *LibrarySyncService) saveState() {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	s.mu.Lock()
	state := s.state
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
	s.state.Enabled = settings.Enabled
	s.state.AutoAnalyze = settings.AutoAnalyze
	s.mu.Unlock()
	s.saveState()

	switch {
	case settings.Enabled && !previous.Enabled:
		if err := s.startWatcher(); err != nil {
			s.recordError("watcher_start_failed")
			return s.Status(), err
		}
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
	for _, set := range s.analysisQueue {
		queued += len(set)
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
	s.state.LastEventAt = time.Now()
	s.mu.Unlock()
	s.saveState()
	select {
	case s.wake <- struct{}{}:
	default:
	}
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
		return
	}
	if outcome == nil || outcome.Result == nil {
		return
	}

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
	s.removedResources = mergeStringSet(s.removedResources, removedIDs)
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
func (s *LibrarySyncService) queueAnalysis(resourceIDs []string) {
	if len(resourceIDs) == 0 {
		return
	}
	s.mu.Lock()
	if !s.settings.AutoAnalyze {
		s.mu.Unlock()
		return
	}
	for _, module := range s.analysisModules() {
		set, exists := s.analysisQueue[module]
		if !exists {
			set = make(map[string]struct{})
			s.analysisQueue[module] = set
		}
		for _, id := range resourceIDs {
			set[id] = struct{}{}
		}
		if len(set) > maxAnalysisQueue {
			s.analysisQueue[module] = trimStringSet(set, maxAnalysisQueue)
		}
	}
	s.analysisDirty = true
	s.mu.Unlock()
}

// pumpAnalysis 把排队的资源提交成分析任务。
//
// 一次只提交一个模块的任务：任务中心同一时刻只跑一个任务，
// 其余排队等它结束。这样一次文件变化不会同时点亮好几条流水线。
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
		set := s.analysisQueue[module]
		if len(set) == 0 {
			s.mu.Unlock()
			continue
		}
		ids := make([]string, 0, len(set))
		for id := range set {
			ids = append(ids, id)
		}
		delete(s.analysisQueue, module)
		s.mu.Unlock()
		sort.Strings(ids)

		_, _, err := s.opts.Jobs.StartForResources(module, ids)
		if err == nil {
			continue
		}
		if errors.Is(err, ErrAIJobActive) {
			// 任务中心正忙：放回去，等下一轮。
			s.mu.Lock()
			restored := s.analysisQueue[module]
			if restored == nil {
				restored = make(map[string]struct{})
				s.analysisQueue[module] = restored
			}
			for _, id := range ids {
				restored[id] = struct{}{}
			}
			s.mu.Unlock()
			return
		}
		// 模块不可用（模型没装、人脸分析没打开）：丢掉这批，
		// 不再反复重试。
		log.Printf("自动分析排队失败 module=%s: %v", module, err)
		return
	}
	s.refreshSmartAlbums()
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
	for _, set := range s.analysisQueue {
		queued += len(set)
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
		s.verifyAt = time.Time{}
	}
	enabled := s.settings.Enabled
	s.mu.Unlock()
	if !due || !enabled {
		return
	}
	s.runVerification(ctx)
}

// scheduleVerify 安排一次校验扫描。
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
	if changes == nil || changes.Empty() {
		return
	}
	s.mu.Lock()
	s.pending.Merge(changes)
	s.mu.Unlock()
	select {
	case s.wake <- struct{}{}:
	default:
	}
}

// scanOptions 构造扫描选项。
func (s *LibrarySyncService) scanOptions() ScanOptions {
	exclude := ExcludeConfig{}
	if s.opts.Exclude != nil {
		exclude = s.opts.Exclude()
	}
	return ScanOptions{Roots: s.opts.Roots(), Exclude: exclude}
}

// mergeStringSet 把一批 ID 并进一个集合。
func mergeStringSet(base map[string]struct{}, extra []string) map[string]struct{} {
	if base == nil {
		base = make(map[string]struct{})
	}
	for _, id := range extra {
		base[id] = struct{}{}
	}
	return base
}

// trimStringSet 把集合裁剪到上限，保留字典序靠前的一部分。
func trimStringSet(set map[string]struct{}, limit int) map[string]struct{} {
	if len(set) <= limit {
		return set
	}
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	next := make(map[string]struct{}, limit)
	for _, key := range keys[:limit] {
		next[key] = struct{}{}
	}
	return next
}
