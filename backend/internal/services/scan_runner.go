package services

import (
	"context"
	"errors"
	"path/filepath"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

type ScanStatus string

const (
	ScanStatusPending   ScanStatus = "pending"
	ScanStatusRunning   ScanStatus = "running"
	ScanStatusComplete  ScanStatus = "complete"
	ScanStatusCancelled ScanStatus = "cancelled"
	ScanStatusError     ScanStatus = "error"
)

type ProgressEvent struct {
	ScanID      string     `json:"scanId"`
	Progress    int        `json:"progress"`
	Status      ScanStatus `json:"status"`
	Phase       string     `json:"phase,omitempty"`
	CurrentPath string     `json:"currentPath,omitempty"`
	AlbumsFound int        `json:"albumsFound"`
	Error       string     `json:"error,omitempty"`
	ElapsedMs   int64      `json:"elapsedMs"`
}

type ScanState struct {
	ID         string
	Ctx        context.Context
	Cancel     context.CancelFunc
	Status     ScanStatus
	StartedAt  time.Time
	FinishedAt time.Time
	Progress   int
	Albums     []models.Album
	Result     *models.ScanResult
	Err        error
	done       chan struct{}
	lastEvent  ProgressEvent
	subs       map[chan ProgressEvent]struct{}
}

type AsyncScanRunner struct {
	mu        sync.Mutex
	states    map[string]*ScanState
	activeID  string
	cache     *ScanResultCache
	catalog   *ResourceCatalog
	retention time.Duration
}

func NewAsyncScanRunner() *AsyncScanRunner {
	return &AsyncScanRunner{
		states:    make(map[string]*ScanState),
		retention: 10 * time.Minute,
	}
}

func (r *AsyncScanRunner) SetCache(cache *ScanResultCache)     { r.cache = cache }
func (r *AsyncScanRunner) SetCatalog(catalog *ResourceCatalog) { r.catalog = catalog }

// Start 保持原有调用形式；重复启动时复用当前任务。
func (r *AsyncScanRunner) Start(opts ScanOptions) (string, <-chan ProgressEvent, error) {
	id, events, _, err := r.StartOrReuse(opts)
	return id, events, err
}

// StartOrReuse 保证全进程同一时间只有一个扫描任务。
func (r *AsyncScanRunner) StartOrReuse(opts ScanOptions) (string, <-chan ProgressEvent, bool, error) {
	if len(opts.Roots) == 0 && opts.Root == "" {
		return "", nil, false, errors.New("root is required")
	}

	r.mu.Lock()
	if active := r.states[r.activeID]; active != nil && isActiveScan(active.Status) {
		ch := r.subscribeLocked(active)
		id := active.ID
		r.mu.Unlock()
		return id, ch, true, nil
	}

	id := uuid.New().String()
	ctx, cancel := context.WithCancel(context.Background())
	state := &ScanState{
		ID:        id,
		Ctx:       ctx,
		Cancel:    cancel,
		Status:    ScanStatusPending,
		StartedAt: time.Now(),
		done:      make(chan struct{}),
		subs:      make(map[chan ProgressEvent]struct{}),
	}
	state.lastEvent = ProgressEvent{ScanID: id, Status: ScanStatusPending}
	r.states[id] = state
	r.activeID = id
	ch := r.subscribeLocked(state)
	r.mu.Unlock()

	go r.run(state, opts)
	return id, ch, false, nil
}

func (r *AsyncScanRunner) Cancel(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.states[id]
	if state == nil || !isActiveScan(state.Status) {
		return false
	}
	state.Cancel()
	return true
}

func (r *AsyncScanRunner) Get(id string) *ScanState {
	r.mu.Lock()
	defer r.mu.Unlock()
	state := r.states[id]
	if state == nil {
		return nil
	}
	cp := *state
	cp.Albums = append([]models.Album(nil), state.Albums...)
	cp.subs = nil
	return &cp
}

func (r *AsyncScanRunner) Result(id string) *models.ScanResult {
	r.mu.Lock()
	defer r.mu.Unlock()
	if state := r.states[id]; state != nil {
		return state.Result
	}
	return nil
}

func (r *AsyncScanRunner) Wait(id string) {
	r.mu.Lock()
	state := r.states[id]
	r.mu.Unlock()
	if state != nil {
		<-state.done
	}
}

// Subscribe 为每个 SSE 客户端创建独立缓冲通道，并立即发送最新快照。
func (r *AsyncScanRunner) Subscribe(id string) (<-chan ProgressEvent, func(), bool) {
	r.mu.Lock()
	state := r.states[id]
	if state == nil {
		r.mu.Unlock()
		return nil, func() {}, false
	}
	ch := r.subscribeLocked(state)
	terminal := !isActiveScan(state.Status)
	if terminal {
		close(ch)
	}
	r.mu.Unlock()
	cancel := func() {
		r.mu.Lock()
		if current := r.states[id]; current != nil {
			if _, ok := current.subs[ch]; ok {
				delete(current.subs, ch)
				close(ch)
			}
		}
		r.mu.Unlock()
	}
	return ch, cancel, true
}

func (r *AsyncScanRunner) subscribeLocked(state *ScanState) chan ProgressEvent {
	ch := make(chan ProgressEvent, 8)
	ch <- state.lastEvent
	if isActiveScan(state.Status) {
		state.subs[ch] = struct{}{}
	}
	return ch
}

func (r *AsyncScanRunner) run(state *ScanState, opts ScanOptions) {
	defer close(state.done)
	r.publish(state, ProgressEvent{ScanID: state.ID, Status: ScanStatusRunning})

	scanner := NewScanner()
	hook := func(ev ScanProgress) {
		if state.Ctx.Err() != nil {
			return
		}
		pct := 0
		if ev.Total > 0 {
			pct = min(99, ev.Processed*100/ev.Total)
		}
		r.publish(state, ProgressEvent{
			ScanID:      state.ID,
			Progress:    pct,
			Status:      ScanStatusRunning,
			Phase:       ev.Phase,
			CurrentPath: relativeScanPath(ev.CurrentPath, opts.effectiveRoots()),
			AlbumsFound: ev.AlbumsFound,
			ElapsedMs:   time.Since(state.StartedAt).Milliseconds(),
		})
	}

	result, err := scanner.ScanWithContext(state.Ctx, opts, hook)
	if errors.Is(err, context.Canceled) || state.Ctx.Err() != nil {
		r.finish(state, ProgressEvent{
			ScanID: state.ID, Status: ScanStatusCancelled,
			ElapsedMs: time.Since(state.StartedAt).Milliseconds(),
		}, nil, context.Canceled)
		return
	}
	if err != nil {
		r.finish(state, ProgressEvent{
			ScanID: state.ID, Status: ScanStatusError,
			Error: "scan failed", ElapsedMs: time.Since(state.StartedAt).Milliseconds(),
		}, nil, err)
		return
	}

	if r.catalog != nil {
		r.catalog.Rebuild(result, opts.effectiveRoots())
	}
	if r.cache != nil {
		r.cache.Set(result)
	}
	r.finish(state, ProgressEvent{
		ScanID: state.ID, Progress: 100, Status: ScanStatusComplete, Phase: "done",
		AlbumsFound: result.AlbumCount, ElapsedMs: time.Since(state.StartedAt).Milliseconds(),
	}, result, nil)
}

func (r *AsyncScanRunner) publish(state *ScanState, event ProgressEvent) {
	r.mu.Lock()
	defer r.mu.Unlock()
	state.Status = event.Status
	state.Progress = event.Progress
	state.lastEvent = event
	for ch := range state.subs {
		select {
		case ch <- event:
		default:
			// 慢客户端只需要最新进度；丢弃最旧事件后补入当前事件。
			select {
			case <-ch:
			default:
			}
			select {
			case ch <- event:
			default:
			}
		}
	}
}

func (r *AsyncScanRunner) finish(state *ScanState, event ProgressEvent, result *models.ScanResult, err error) {
	r.mu.Lock()
	state.Status = event.Status
	state.Progress = event.Progress
	state.Result = result
	state.Err = err
	state.FinishedAt = time.Now()
	state.lastEvent = event
	if r.activeID == state.ID {
		r.activeID = ""
	}
	for ch := range state.subs {
		select {
		case ch <- event:
		default:
			select {
			case <-ch:
			default:
			}
			ch <- event
		}
		close(ch)
		delete(state.subs, ch)
	}
	retention := r.retention
	r.mu.Unlock()

	if retention > 0 {
		time.AfterFunc(retention, func() {
			r.mu.Lock()
			delete(r.states, state.ID)
			r.mu.Unlock()
		})
	}
}

func isActiveScan(status ScanStatus) bool {
	return status == ScanStatusPending || status == ScanStatusRunning
}

func relativeScanPath(path string, roots []string) string {
	for _, root := range roots {
		rel, err := filepath.Rel(root, path)
		if err == nil && !relEscapesRoot(rel) {
			name := filepath.Base(filepath.Clean(root))
			if rel == "." {
				return name
			}
			return filepath.ToSlash(filepath.Join(name, rel))
		}
	}
	return ""
}
