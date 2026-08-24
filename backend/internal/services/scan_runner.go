package services

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// ScanStatus 扫描状态机。
type ScanStatus string

const (
	ScanStatusPending   ScanStatus = "pending"
	ScanStatusRunning   ScanStatus = "running"
	ScanStatusComplete  ScanStatus = "complete"
	ScanStatusCancelled ScanStatus = "cancelled"
	ScanStatusError     ScanStatus = "error"
)

// ProgressEvent SSE 推送的进度事件。
type ProgressEvent struct {
	ScanID      string     `json:"scanId"`
	Progress    int        `json:"progress"`         // 0-100
	Status      ScanStatus `json:"status"`           // running / complete / cancelled / error
	Phase       string     `json:"phase,omitempty"`  // "scanning" / "smart-grouping" / "done"
	CurrentPath string     `json:"currentPath,omitempty"`
	AlbumsFound int        `json:"albumsFound"`
	Error       string     `json:"error,omitempty"`
	ElapsedMs   int64      `json:"elapsedMs"`
}

// ScanState 单次扫描的运行时状态。
type ScanState struct {
	ID         string
	Ctx        context.Context
	Cancel     context.CancelFunc
	Status     ScanStatus
	StartedAt  time.Time
	FinishedAt time.Time
	Progress   int
	Albums     []models.Album // 已发现的相册（用于进度展示）
	Result     *models.ScanResult
	Err        error
	Events     chan ProgressEvent
	done       chan struct{}
}

// AsyncScanRunner 管理并发运行的扫描任务。
type AsyncScanRunner struct {
	mu     sync.Mutex
	states map[string]*ScanState
	cache  *ScanResultCache // 可选：扫描成功时写入缓存
}

// NewAsyncScanRunner 创建 runner。
func NewAsyncScanRunner() *AsyncScanRunner {
	return &AsyncScanRunner{states: make(map[string]*ScanState)}
}

// SetCache 绑定全局扫描结果缓存。
func (r *AsyncScanRunner) SetCache(cache *ScanResultCache) {
	r.cache = cache
}

// Start 启动一次新扫描，返回 scan_id 和事件通道。
//
// 至少需要一个根：opts.Roots 非空优先；否则回退到 opts.Root（兼容）。
func (r *AsyncScanRunner) Start(opts ScanOptions) (string, <-chan ProgressEvent, error) {
	if len(opts.Roots) == 0 && opts.Root == "" {
		return "", nil, errors.New("root is required")
	}

	id := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())

	state := &ScanState{
		ID:        id,
		Ctx:       ctx,
		Cancel:    cancel,
		Status:    ScanStatusPending,
		StartedAt: time.Now(),
		Events:    make(chan ProgressEvent, 64),
		done:      make(chan struct{}),
	}

	r.mu.Lock()
	r.states[id] = state
	r.mu.Unlock()

	go r.run(state, opts)
	return id, state.Events, nil
}

// Cancel 取消指定扫描。
func (r *AsyncScanRunner) Cancel(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.states[id]; ok {
		s.Cancel()
		return true
	}
	return false
}

// Get 返回扫描当前状态（拷贝）。
func (r *AsyncScanRunner) Get(id string) *ScanState {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.states[id]; ok {
		cp := *s
		return &cp
	}
	return nil
}

// Result 返回扫描最终结果（完成态才有）。
func (r *AsyncScanRunner) Result(id string) *models.ScanResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	if s, ok := r.states[id]; ok {
		return s.Result
	}
	return nil
}

// Wait 阻塞等待扫描完成（用于测试）。
func (r *AsyncScanRunner) Wait(id string) {
	r.mu.Lock()
	s, ok := r.states[id]
	r.mu.Unlock()
	if !ok {
		return
	}
	<-s.done
}

func (r *AsyncScanRunner) run(state *ScanState, opts ScanOptions) {
	defer close(state.Events)
	defer close(state.done)

	r.setStatus(state, ScanStatusRunning)

	scanner := NewScanner()
	hook := func(ev ScanProgress) {
		// ctx 已取消则不再发事件
		if state.Ctx.Err() != nil {
			return
		}
		pct := 0
		if ev.Total > 0 {
			pct = ev.Processed * 100 / ev.Total
			if pct > 99 {
				pct = 99
			}
		}
		state.Progress = pct
		state.Albums = append(state.Albums, ev.NewAlbums...)
		state.Events <- ProgressEvent{
			ScanID:      state.ID,
			Progress:    pct,
			Status:      ScanStatusRunning,
			Phase:       ev.Phase,
			CurrentPath: ev.CurrentPath,
			AlbumsFound: ev.AlbumsFound,
			ElapsedMs:   time.Since(state.StartedAt).Milliseconds(),
		}
	}

	result, err := scanner.ScanWithHook(opts, hook)
	if err != nil {
		if state.Ctx.Err() == context.Canceled {
			state.Events <- ProgressEvent{
				ScanID:      state.ID,
				Progress:    state.Progress,
				Status:      ScanStatusCancelled,
				AlbumsFound: len(state.Albums),
				ElapsedMs:   time.Since(state.StartedAt).Milliseconds(),
			}
			r.setStatus(state, ScanStatusCancelled)
			return
		}
		state.Events <- ProgressEvent{
			ScanID:      state.ID,
			Progress:    state.Progress,
			Status:      ScanStatusError,
			Error:       err.Error(),
			ElapsedMs:   time.Since(state.StartedAt).Milliseconds(),
		}
		r.setStatus(state, ScanStatusError)
		state.Err = err
		return
	}

	state.Result = result
	state.FinishedAt = time.Now()
	// 写入全局缓存（供后续直接查询，避免再次扫描）。
	if r.cache != nil {
		r.cache.Set(result)
	}
	state.Events <- ProgressEvent{
		ScanID:      state.ID,
		Progress:    100,
		Status:      ScanStatusComplete,
		Phase:       "done",
		AlbumsFound: result.AlbumCount,
		ElapsedMs:   time.Since(state.StartedAt).Milliseconds(),
	}
	r.setStatus(state, ScanStatusComplete)
}

func (r *AsyncScanRunner) setStatus(state *ScanState, s ScanStatus) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state.Status = s
}
