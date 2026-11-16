package services

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/google/uuid"
)

// SmartAlbumRefreshStatus 与缓存重建任务同一套状态取值，
// 前端一套进度条逻辑两处都能用。
type SmartAlbumRefreshStatus string

const (
	SmartAlbumRefreshStatusPending   SmartAlbumRefreshStatus = "pending"
	SmartAlbumRefreshStatusRunning   SmartAlbumRefreshStatus = "running"
	SmartAlbumRefreshStatusComplete  SmartAlbumRefreshStatus = "complete"
	SmartAlbumRefreshStatusCancelled SmartAlbumRefreshStatus = "cancelled"
	SmartAlbumRefreshStatusError     SmartAlbumRefreshStatus = "error"
)

// SmartAlbumSweepProgress 是全库扫描的进度回报。
//
// 计数都是累计值：Albums 是照片相册总数，Total 是「相册 × 五个维度」的
// 组合总数，Completed 是已处理的组合数。
type SmartAlbumSweepProgress struct {
	Albums    int
	Total     int
	Completed int
	// Rebuilt 是重算的组合数，Reused 是命中缓存直接复用的组合数。
	Rebuilt int
	Reused  int
	// Groups 是已产出的分组总数。
	Groups int
	// AlbumID / AlbumName / Dimension 指出刚处理完哪个组合。
	AlbumID   string
	AlbumName string
	Dimension string
}

// SmartAlbumSweeper 是刷新任务依赖的分组计算入口。
//
// 抽成接口是为了让任务本身（进度、取消、状态）能与分组算法分开测：
// 任务只关心「谁在跑、跑到哪了」，不关心分组怎么算。
type SmartAlbumSweeper interface {
	SweepSmartAlbums(ctx context.Context, force bool, progress func(SmartAlbumSweepProgress)) error
}

// SmartAlbumRefreshProgress 是刷新任务的对外进度快照。
type SmartAlbumRefreshProgress struct {
	JobID  string                  `json:"jobId"`
	Status SmartAlbumRefreshStatus `json:"status"`
	// Force 为真时无视缓存，全部重算。
	Force bool `json:"force"`
	// Albums 是照片相册总数，Total 是「相册 × 五个维度」的组合总数。
	Albums int `json:"albums"`
	Total  int `json:"total"`
	Done   int `json:"done"`
	// Rebuilt 是重算的组合数，Reused 是命中缓存直接复用的组合数。
	Rebuilt int `json:"rebuilt"`
	Reused  int `json:"reused"`
	// Groups 是本次产出的分组总数。
	Groups int `json:"groups"`
	// CurrentAlbumID / CurrentAlbumName / CurrentDimension 指出正在处理哪个组合。
	CurrentAlbumID   string `json:"currentAlbumId,omitempty"`
	CurrentAlbumName string `json:"currentAlbumName,omitempty"`
	CurrentDimension string `json:"currentDimension,omitempty"`
	// StartedAt / FinishedAt 是任务的开始与结束时间。
	StartedAt  *time.Time `json:"startedAt,omitempty"`
	FinishedAt *time.Time `json:"finishedAt,omitempty"`
	// ElapsedMs 是已耗时（毫秒）。
	ElapsedMs int64 `json:"elapsedMs"`
	// Error 是失败原因（机器可读的错误码或空）。
	Error string `json:"error,omitempty"`
}

// smartAlbumRefreshState 是单个刷新任务的状态。
type smartAlbumRefreshState struct {
	id         string
	ctx        context.Context
	cancel     context.CancelFunc
	status     SmartAlbumRefreshStatus
	force      bool
	startedAt  time.Time
	finishedAt time.Time
	albums     int
	total      int
	done       int
	rebuilt    int
	reused     int
	groups     int
	currentID  string
	currentNm  string
	currentDim string
	errCode    string
	lastEvent  SmartAlbumRefreshProgress
	subs       map[chan SmartAlbumRefreshProgress]struct{}
	// doneCh 在任务进入终态后关闭，等待方靠它拿到结果。
	doneCh chan struct{}
}

// SmartAlbumRefreshService 负责「重建全部智能相册分组」的后台任务。
//
// 为什么要有它：全库分组要按相册 × 五个维度逐个算，放在 HTTP 请求里
// 同步跑会撞超时；放进后台任务，页面上看得见进度、也能中途取消。
//
// 全进程同一时间只跑一个刷新：手动触发与每日计划读的是同一份派生缓存
// 与索引，两个任务并行只会互相踩。
type SmartAlbumRefreshService struct {
	mu       sync.Mutex
	states   map[string]*smartAlbumRefreshState
	activeID string
	sweeper  SmartAlbumSweeper

	// progressInterval 是进度快照的推送间隔；测试里调小它，
	// 免得为了等一条进度把用例拖成慢用例。
	progressInterval time.Duration

	closed bool
}

// NewSmartAlbumRefreshService 创建刷新服务。
func NewSmartAlbumRefreshService(sweeper SmartAlbumSweeper) *SmartAlbumRefreshService {
	return &SmartAlbumRefreshService{
		states:           make(map[string]*smartAlbumRefreshState),
		sweeper:          sweeper,
		progressInterval: smartAlbumRefreshProgressInterval,
	}
}

// Start 启动一次全库刷新。已有任务在跑时复用它（reused=true）。
//
// force 为真时无视缓存，全部重算；否则只重建媒体或分析结果有变化的组合。
func (s *SmartAlbumRefreshService) Start(force bool) (string, bool, error) {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return "", false, errors.New("smart album refresh service is shutting down")
	}
	if s.sweeper == nil {
		s.mu.Unlock()
		return "", false, errors.New("smart album service is unavailable")
	}
	if active := s.states[s.activeID]; active != nil && isActiveSmartAlbumRefresh(active.status) {
		id := active.id
		s.mu.Unlock()
		return id, true, nil
	}
	id := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())
	state := &smartAlbumRefreshState{
		id:        id,
		ctx:       ctx,
		cancel:    cancel,
		status:    SmartAlbumRefreshStatusPending,
		force:     force,
		startedAt: time.Now(),
		subs:      make(map[chan SmartAlbumRefreshProgress]struct{}),
		doneCh:    make(chan struct{}),
	}
	state.lastEvent = s.progressLocked(state)
	s.states[id] = state
	s.activeID = id
	s.mu.Unlock()

	go s.run(state)
	return id, false, nil
}

// Run 刷新全部分组并等到结束。已有任务在跑时复用它。
//
// 每日计划走这条路径：计划末尾要的是「分组已经是最新的」这个状态，
// 至于这次状态是手动刷出来的还是计划自己刷出来的，没有区别。
func (s *SmartAlbumRefreshService) Run(ctx context.Context, force bool) error {
	id, reused, err := s.Start(force)
	if err != nil {
		return err
	}
	s.mu.Lock()
	state := s.states[id]
	s.mu.Unlock()
	if state == nil {
		return errors.New("smart album refresh task disappeared")
	}
	select {
	case <-state.doneCh:
		s.mu.Lock()
		code := state.errCode
		s.mu.Unlock()
		if code != "" {
			return errors.New(code)
		}
		return nil
	case <-ctx.Done():
		// 复用的任务不是本次启动的，别替别人取消。
		if !reused {
			s.Cancel(id)
		}
		return ctx.Err()
	}
}

// Cancel 取消进行中的刷新。
func (s *SmartAlbumRefreshService) Cancel(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.states[id]
	if state == nil {
		return false
	}
	if !isActiveSmartAlbumRefresh(state.status) {
		return false
	}
	state.cancel()
	return true
}

// Status 返回任务当前快照。
func (s *SmartAlbumRefreshService) Status(id string) (SmartAlbumRefreshProgress, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.states[id]
	if state == nil {
		return SmartAlbumRefreshProgress{}, false
	}
	return s.progressLocked(state), true
}

// Active 返回当前正在跑的任务。没有任务在跑时返回 false。
func (s *SmartAlbumRefreshService) Active() (SmartAlbumRefreshProgress, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state := s.states[s.activeID]
	if state == nil {
		return SmartAlbumRefreshProgress{}, false
	}
	return s.progressLocked(state), true
}

// Subscribe 为每个 SSE 客户端创建独立缓冲通道，并立即发送最新快照。
func (s *SmartAlbumRefreshService) Subscribe(id string) (<-chan SmartAlbumRefreshProgress, func(), bool) {
	s.mu.Lock()
	state := s.states[id]
	if state == nil {
		s.mu.Unlock()
		return nil, func() {}, false
	}
	ch := make(chan SmartAlbumRefreshProgress, 8)
	ch <- s.progressLocked(state)
	if isActiveSmartAlbumRefresh(state.status) {
		state.subs[ch] = struct{}{}
	} else {
		close(ch)
	}
	s.mu.Unlock()

	cancel := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if current := s.states[id]; current != nil {
			if _, ok := current.subs[ch]; ok {
				delete(current.subs, ch)
				close(ch)
			}
		}
	}
	return ch, cancel, true
}

// Close 取消所有任务并停止接受新任务。
func (s *SmartAlbumRefreshService) Close() {
	s.mu.Lock()
	s.closed = true
	for _, state := range s.states {
		if isActiveSmartAlbumRefresh(state.status) {
			state.cancel()
		}
	}
	s.mu.Unlock()
}

func (s *SmartAlbumRefreshService) run(state *smartAlbumRefreshState) {
	defer state.cancel()
	s.mu.Lock()
	state.status = SmartAlbumRefreshStatusRunning
	s.mu.Unlock()
	s.publish(state, s.progressSnapshot(state, SmartAlbumRefreshStatusRunning))

	stopProgress := s.startProgressTicker(state)
	defer stopProgress()

	err := s.sweep(state)
	switch {
	case err == nil:
		s.finish(state, SmartAlbumRefreshStatusComplete, "")
	case errors.Is(err, context.Canceled):
		s.finish(state, SmartAlbumRefreshStatusCancelled, "")
	default:
		// 失败原因里可能带本机路径，只记日志，界面上给错误码。
		log.Printf("刷新智能相册分组失败: %v", err)
		s.finish(state, SmartAlbumRefreshStatusError, smartAlbumRefreshErrorCode(err))
	}
}

// sweep 跑一次全库分组，并把进度写回任务状态。
func (s *SmartAlbumRefreshService) sweep(state *smartAlbumRefreshState) error {
	if s.sweeper == nil {
		return errors.New("smart album service is unavailable")
	}
	return s.sweeper.SweepSmartAlbums(state.ctx, state.force, func(progress SmartAlbumSweepProgress) {
		s.mu.Lock()
		defer s.mu.Unlock()
		state.albums = progress.Albums
		state.total = progress.Total
		state.done = progress.Completed
		state.rebuilt = progress.Rebuilt
		state.reused = progress.Reused
		state.groups = progress.Groups
		state.currentID = progress.AlbumID
		state.currentNm = progress.AlbumName
		state.currentDim = progress.Dimension
	})
}

func (s *SmartAlbumRefreshService) finish(state *smartAlbumRefreshState, status SmartAlbumRefreshStatus, errCode string) {
	s.mu.Lock()
	state.status = status
	state.errCode = errCode
	state.finishedAt = time.Now()
	s.mu.Unlock()
	// 先把终态推给订阅者，再关通道：顺序反了的话订阅者收到的最后一条
	// 是 running，界面会一直显示「生成中」。
	s.publish(state, s.progressSnapshot(state, status))
	s.mu.Lock()
	for ch := range state.subs {
		close(ch)
		delete(state.subs, ch)
	}
	s.mu.Unlock()
	close(state.doneCh)
}

// startProgressTicker 在任务运行期间定期推送进度快照。
//
// 返回的函数用来停掉推送：调用方保证它被调用（defer），推送协程不会
// 泄漏，也不会在任务结束后继续往已关闭的通道里写。
func (s *SmartAlbumRefreshService) startProgressTicker(state *smartAlbumRefreshState) func() {
	interval := s.progressInterval
	if interval <= 0 {
		interval = smartAlbumRefreshProgressInterval
	}
	stop := make(chan struct{})
	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-state.ctx.Done():
				return
			case <-ticker.C:
				s.mu.Lock()
				active := isActiveSmartAlbumRefresh(state.status)
				s.mu.Unlock()
				if !active {
					return
				}
				s.publish(state, s.progressSnapshot(state, SmartAlbumRefreshStatusRunning))
			}
		}
	}()
	return func() { close(stop) }
}

func (s *SmartAlbumRefreshService) publish(state *smartAlbumRefreshState, event SmartAlbumRefreshProgress) {
	s.mu.Lock()
	defer s.mu.Unlock()
	state.lastEvent = event
	for ch := range state.subs {
		select {
		case ch <- event:
		default:
			// 客户端来不及消费时丢弃这一条：进度是快照，下一条会覆盖它。
		}
	}
}

func (s *SmartAlbumRefreshService) progressLocked(state *smartAlbumRefreshState) SmartAlbumRefreshProgress {
	var finishedAt *time.Time
	if !state.finishedAt.IsZero() {
		finished := state.finishedAt
		finishedAt = &finished
	}
	return SmartAlbumRefreshProgress{
		JobID:            state.id,
		Status:           state.status,
		Force:            state.force,
		Albums:           state.albums,
		Total:            state.total,
		Done:             state.done,
		Rebuilt:          state.rebuilt,
		Reused:           state.reused,
		Groups:           state.groups,
		CurrentAlbumID:   state.currentID,
		CurrentAlbumName: state.currentNm,
		CurrentDimension: state.currentDim,
		StartedAt:        &state.startedAt,
		FinishedAt:       finishedAt,
		ElapsedMs:        time.Since(state.startedAt).Milliseconds(),
		Error:            state.errCode,
	}
}

// progressSnapshot 取一份带锁的进度快照。
func (s *SmartAlbumRefreshService) progressSnapshot(state *smartAlbumRefreshState, status SmartAlbumRefreshStatus) SmartAlbumRefreshProgress {
	s.mu.Lock()
	defer s.mu.Unlock()
	event := s.progressLocked(state)
	event.Status = status
	return event
}

// smartAlbumRefreshErrorCode 把内部错误映射成可以公开的错误码。
func smartAlbumRefreshErrorCode(err error) string {
	switch {
	case errors.Is(err, ErrLibraryNotReady):
		return "library_not_ready"
	case errors.Is(err, ErrStalePageCursor):
		return "library_changed"
	default:
		return "smart_album_failed"
	}
}

// smartAlbumRefreshProgressInterval 是进度快照的推送间隔。
//
// 一次分组可能要几十毫秒到几秒，推送太密没有意义；太疏又会让进度条
// 长时间不动，用户以为卡死了。
const smartAlbumRefreshProgressInterval = 500 * time.Millisecond

func isActiveSmartAlbumRefresh(status SmartAlbumRefreshStatus) bool {
	return status == SmartAlbumRefreshStatusPending || status == SmartAlbumRefreshStatusRunning
}
