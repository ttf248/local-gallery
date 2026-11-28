package services

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/fsnotify/fsnotify"

	"github.com/tianlongxiang/local-gallery/internal/pathutil"
)

// SyncChangeSet 描述一批去抖合并后的文件变化。
//
// 它是「目录监听」与「增量扫描」之间唯一的契约：监听器只负责回答
// 「哪些目录的内容可能变了」，扫描器据此决定重读哪些目录。
type SyncChangeSet struct {
	// Dirs 是内容可能发生变化的目录（绝对路径）。
	Dirs map[string]struct{}
	// Files 是被创建、写入或删除的文件（绝对路径）。
	Files map[string]struct{}
	// CreatedDirs 是本批新出现的目录（绝对路径）。
	CreatedDirs map[string]struct{}
	// RemovedDirs 是本批消失的目录（绝对路径）。
	RemovedDirs map[string]struct{}
	// At 是这批变化合并完成的时间。
	At time.Time
}

func newSyncChangeSet() *SyncChangeSet {
	return &SyncChangeSet{
		Dirs:        make(map[string]struct{}),
		Files:       make(map[string]struct{}),
		CreatedDirs: make(map[string]struct{}),
		RemovedDirs: make(map[string]struct{}),
		At:          time.Now(),
	}
}

// Merge 把另一批变化并进当前批次。批次是集合语义：同一个目录被反复
// 触碰只算一次，避免大批量复制把变更集合撑大。
func (c *SyncChangeSet) Merge(other *SyncChangeSet) {
	if other == nil {
		return
	}
	for dir := range other.Dirs {
		c.Dirs[dir] = struct{}{}
	}
	for file := range other.Files {
		c.Files[file] = struct{}{}
	}
	for dir := range other.CreatedDirs {
		c.CreatedDirs[dir] = struct{}{}
	}
	for dir := range other.RemovedDirs {
		c.RemovedDirs[dir] = struct{}{}
	}
	if other.At.After(c.At) {
		c.At = other.At
	}
}

// Size 是这批变化涉及的文件与目录总数，用于「检测数量」展示。
func (c *SyncChangeSet) Size() int {
	if c == nil {
		return 0
	}
	return len(c.Files) + len(c.Dirs)
}

// Empty 判断批次是否没有任何变化。
func (c *SyncChangeSet) Empty() bool {
	return c == nil || (len(c.Files) == 0 && len(c.Dirs) == 0)
}

// WatcherStatus 是监听器的对外状态。
type WatcherStatus struct {
	// Running 表示监听器已启动并在接收事件。
	Running bool `json:"running"`
	// Degraded 表示监听不可靠（溢出、权限不足、网络共享等），
	// 此时依赖定期校验兜底。
	Degraded bool `json:"degraded"`
	// WatchedRoots 是当前已接管的媒体根数量。
	WatchedRoots int `json:"watchedRoots"`
	// WatchedDirs 是当前登记的监听目录数量。
	WatchedDirs int `json:"watchedDirs"`
	// MaxWatchDirs 是监听目录数量上限；达到上限后不再新增监听，
	// 超出部分靠定期校验兜底。
	MaxWatchDirs int `json:"maxWatchDirs"`
	// PendingChanges 是尚未合并成批次的变更条目数。
	PendingChanges int `json:"pendingChanges"`
	// LastEventAt 是最近一次收到事件的时间。
	LastEventAt time.Time `json:"lastEventAt,omitempty"`
	// LastError 是最近一次监听错误（已脱敏，不含绝对路径）。
	LastError string `json:"lastError,omitempty"`
}

// ChangeWatcherOptions 是监听器的构造参数。
type ChangeWatcherOptions struct {
	// Roots 是要监听的媒体根（绝对路径）。
	Roots []string
	// Exclude 是扫描排除规则；被排除的目录不进入监听范围。
	Exclude ExcludeConfig
	// Debounce 是静默窗口：连续事件之间没有新的事件超过这个时长，
	// 才把变化合并成一批提交。
	Debounce time.Duration
	// MaxWait 是一批变化的最长等待时间。批量复制会持续产生事件，
	// 静默窗口永远等不到；超过这个上限就强制提交当前批次。
	MaxWait time.Duration
	// MaxWatchDirs 是同时监听的目录数量上限。
	MaxWatchDirs int
	// BufferSize 是单个目录监听的事件缓冲区字节数。
	BufferSize int
	// OnChange 在一批变化合并完成时调用。
	OnChange func(*SyncChangeSet)
	// OnError 在监听器遇到错误时调用（溢出、权限不足等）。
	//
	// 某个媒体根登记失败不走上这条通道：那是那一个根的问题，
	// 其余根照常工作，不该把整个监听标成降级。
	OnError func(error)
	// OnRootError 在某个媒体根无法监听时调用。
	OnRootError func(root string, err error)
}

const (
	// defaultWatchDebounce 是默认静默窗口。两秒足够让「复制一堆照片」
	// 这种连续写入收敛成一批，又不至于让用户等太久。
	defaultWatchDebounce = 2 * time.Second
	// defaultWatchMaxWait 是一批变化的最长等待时间。
	defaultWatchMaxWait = 30 * time.Second
	// defaultMaxWatchDirs 是监听目录数量上限。
	//
	// Windows 上每个被监听目录都要占一个句柄和一块事件缓冲区，
	// 缓冲区按 8 KiB 计：一万个目录约 80 MiB。超过上限就不再新增监听，
	// 未覆盖的部分由定期校验兜底，内存与句柄因此有界。
	defaultMaxWatchDirs = 10000
	// defaultWatchBufferSize 是单个目录监听的事件缓冲区大小。
	defaultWatchBufferSize = 8192
	// watchStabilityRounds 是「文件仍在写入」的最大确认轮次。
	// 超过这个轮次仍然认为文件在写，就按当前状态提交，避免永远等下去。
	watchStabilityRounds = 20
)

// ChangeWatcher 用操作系统的目录变更通知盯住媒体根，并把连续事件
// 去抖合并成批次。
//
// 设计要点：
//   - 只监听「扫描器会读取的目录」，被排除规则跳过的目录不监听；
//   - 新建目录自动登记监听，删除目录自动摘掉监听；
//   - 连续事件合并成一批，批量复制不会产生几百次扫描；
//   - 文件仍在写入时推迟提交，避免把半张图写进索引；
//   - 监听失效（溢出、权限不足、网络共享）时降级并交给定期校验兜底。
type ChangeWatcher struct {
	opts ChangeWatcherOptions

	mu        sync.Mutex
	watcher   *fsnotify.Watcher
	roots     []string
	rootKeys  map[string]struct{}
	watched   map[string]struct{}
	pending   *SyncChangeSet
	sizes     map[string]int64
	wake      chan struct{}
	deadline  time.Time
	batchAt   time.Time
	rounds    int
	closed    bool
	running   bool
	degraded  bool
	lastErr   string
	lastEvent time.Time
}

// NewChangeWatcher 创建监听器但不会立刻开始接收事件。
func NewChangeWatcher(opts ChangeWatcherOptions) (*ChangeWatcher, error) {
	if opts.Debounce <= 0 {
		opts.Debounce = defaultWatchDebounce
	}
	if opts.MaxWait <= 0 {
		opts.MaxWait = defaultWatchMaxWait
	}
	if opts.MaxWatchDirs <= 0 {
		opts.MaxWatchDirs = defaultMaxWatchDirs
	}
	if opts.BufferSize <= 0 {
		opts.BufferSize = defaultWatchBufferSize
	}
	roots := pathutil.NormalizeRoots(opts.Roots)
	if len(roots) == 0 {
		return nil, errors.New("change watcher requires at least one media root")
	}
	w := &ChangeWatcher{
		opts:     opts,
		roots:    roots,
		rootKeys: make(map[string]struct{}, len(roots)),
		watched:  make(map[string]struct{}),
		pending:  newSyncChangeSet(),
		sizes:    make(map[string]int64),
		wake:     make(chan struct{}, 1),
	}
	for _, root := range roots {
		w.rootKeys[pathutil.RootKey(root)] = struct{}{}
	}
	return w, nil
}

// Start 建立系统监听并开始接收事件。
func (w *ChangeWatcher) Start(ctx context.Context) error {
	watcher, err := fsnotify.NewWatcher()
	if err != nil {
		return fmt.Errorf("create file watcher: %w", err)
	}
	w.mu.Lock()
	w.watcher = watcher
	w.mu.Unlock()

	go w.loop(ctx, watcher)
	go w.flushLoop(ctx)

	// 登记初始目录。单个目录登记失败不阻断整体：网络共享上某些目录
	// 可能拿不到句柄，其余目录仍然可用，缺口由定期校验兜底。
	//
	// 根名单要取快照再读：监听运行期间换根会改写它。
	w.mu.Lock()
	roots := append([]string(nil), w.roots...)
	w.mu.Unlock()
	for _, root := range roots {
		if err := w.addTree(ctx, root, nil); err != nil {
			w.reportRootError(root, err)
		}
	}
	w.mu.Lock()
	w.running = true
	w.mu.Unlock()
	return nil
}

// Close 停止监听并释放系统句柄。
func (w *ChangeWatcher) Close() error {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return nil
	}
	w.closed = true
	w.running = false
	watcher := w.watcher
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
	if watcher != nil {
		return watcher.Close()
	}
	return nil
}

// SetRoots 动态切换监听的媒体根。配置里增删媒体根时调用。
func (w *ChangeWatcher) SetRoots(ctx context.Context, roots []string) {
	roots = pathutil.NormalizeRoots(roots)
	w.mu.Lock()
	old := w.roots
	w.roots = roots
	w.rootKeys = make(map[string]struct{}, len(roots))
	for _, root := range roots {
		w.rootKeys[pathutil.RootKey(root)] = struct{}{}
	}
	watcher := w.watcher
	w.mu.Unlock()

	// 摘掉已经不在根集合里的监听。
	keep := make(map[string]struct{}, len(roots))
	for _, root := range roots {
		keep[pathutil.RootKey(root)] = struct{}{}
	}
	for _, root := range old {
		if _, exists := keep[pathutil.RootKey(root)]; exists {
			continue
		}
		w.removeSubtree(root)
	}
	if watcher == nil {
		return
	}
	for _, root := range roots {
		if err := w.addTree(ctx, root, nil); err != nil {
			w.reportRootError(root, err)
		}
	}
}

// Status 返回当前监听状态。
func (w *ChangeWatcher) Status() WatcherStatus {
	w.mu.Lock()
	defer w.mu.Unlock()
	status := WatcherStatus{
		Running:        w.running && !w.closed,
		Degraded:       w.degraded,
		WatchedRoots:   len(w.roots),
		WatchedDirs:    len(w.watched),
		MaxWatchDirs:   w.opts.MaxWatchDirs,
		PendingChanges: w.pending.Size(),
		LastEventAt:    w.lastEvent,
		LastError:      w.lastErr,
	}
	return status
}

// loop 是事件读取主循环。
func (w *ChangeWatcher) loop(ctx context.Context, watcher *fsnotify.Watcher) {
	for {
		select {
		case <-ctx.Done():
			return
		case event, ok := <-watcher.Events:
			if !ok {
				return
			}
			w.handleEvent(ctx, event)
		case err, ok := <-watcher.Errors:
			if !ok {
				return
			}
			w.handleError(err)
		}
	}
}

// handleError 处理系统层错误。溢出意味着这段时间的事件可能丢失，
// 必须降级并交给定期校验兜底。
func (w *ChangeWatcher) handleError(err error) {
	if errors.Is(err, fsnotify.ErrEventOverflow) {
		w.mu.Lock()
		w.degraded = true
		w.lastErr = "event_overflow"
		w.mu.Unlock()
		w.reportError(errors.New("watch event overflow"))
		return
	}
	w.mu.Lock()
	w.degraded = true
	w.lastErr = "watch_failed"
	w.mu.Unlock()
	w.reportError(err)
}

// reportError 把错误交给上层（脱敏后只保留机器可读的分类）。
func (w *ChangeWatcher) reportError(err error) {
	if w.opts.OnError != nil {
		w.opts.OnError(err)
	}
}

// reportRootError 报告某个媒体根无法监听。
//
// 这不算监听器降级：那一个根读不到（离线磁盘、断开的网络共享），
// 其余根照常工作。
func (w *ChangeWatcher) reportRootError(root string, err error) {
	if w.opts.OnRootError != nil {
		w.opts.OnRootError(root, err)
	}
}

// handleEvent 处理一次系统事件。
func (w *ChangeWatcher) handleEvent(ctx context.Context, event fsnotify.Event) {
	path := filepath.Clean(event.Name)
	if !w.withinRoots(path) {
		// 越界事件直接丢弃：监听范围只认媒体根，根外的事件
		// 既不参与索引，也不能写进任何状态。
		return
	}
	w.mu.Lock()
	w.lastEvent = time.Now()
	w.mu.Unlock()

	op := event.Op
	if op.Has(fsnotify.Remove) || op.Has(fsnotify.Rename) {
		w.markDirty(filepath.Dir(path))
		w.mu.Lock()
		_, watchedDir := w.watched[path]
		w.mu.Unlock()
		if watchedDir {
			w.removeSubtree(path)
			w.mu.Lock()
			w.pending.RemovedDirs[path] = struct{}{}
			w.mu.Unlock()
		}
		w.markFile(path)
		w.armTimer()
		return
	}
	if op.Has(fsnotify.Create) {
		info, err := os.Lstat(path)
		if err == nil && info.IsDir() && !w.opts.Exclude.ShouldSkipDir(filepath.Base(path)) {
			// 目录事件到达前，文件可能已经写进尚未登记监听的目录。
			changes := newSyncChangeSet()
			if err := w.addTree(ctx, path, changes.Files); err != nil {
				w.reportError(fmt.Errorf("watch new directory %s: %w", filepath.Base(path), err))
			}
			changes.CreatedDirs[path] = struct{}{}
			w.mu.Lock()
			w.pending.Merge(changes)
			w.mu.Unlock()
		}
		w.markDirty(filepath.Dir(path))
		w.markFile(path)
		w.armTimer()
		return
	}
	if op.Has(fsnotify.Write) {
		w.markDirty(filepath.Dir(path))
		w.markFile(path)
		w.armTimer()
	}
}

// withinRoots 判断路径是否落在某个媒体根内。
func (w *ChangeWatcher) withinRoots(path string) bool {
	w.mu.Lock()
	roots := append([]string(nil), w.roots...)
	w.mu.Unlock()
	_, _, ok := pathutil.MostSpecificRoot(path, roots)
	return ok
}

// markDirty 标记一个目录的内容可能变化。
func (w *ChangeWatcher) markDirty(dir string) {
	if dir == "" {
		return
	}
	clean := filepath.Clean(dir)
	w.mu.Lock()
	w.pending.Dirs[clean] = struct{}{}
	w.mu.Unlock()
}

// markFile 标记一个文件发生变化。
func (w *ChangeWatcher) markFile(path string) {
	if path == "" {
		return
	}
	clean := filepath.Clean(path)
	w.mu.Lock()
	w.pending.Files[clean] = struct{}{}
	w.mu.Unlock()
}

// armTimer 重置静默窗口计时器。
//
// 这里只更新截止时间并唤醒等待方，由 flushLoop 统一提交；不用一次性
// timer 是因为事件是并发的，重置 timer 需要额外加锁。
func (w *ChangeWatcher) armTimer() {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	now := time.Now()
	if w.batchAt.IsZero() {
		w.batchAt = now
		w.rounds = 0
	}
	w.deadline = now.Add(w.opts.Debounce)
	// 达到最长等待时间后不再延后。
	if maxDeadline := w.batchAt.Add(w.opts.MaxWait); maxDeadline.Before(w.deadline) {
		w.deadline = maxDeadline
	}
	w.mu.Unlock()
	select {
	case w.wake <- struct{}{}:
	default:
	}
}

// flushLoop 在静默窗口结束后提交一批变化。
func (w *ChangeWatcher) flushLoop(ctx context.Context) {
	timer := time.NewTimer(time.Hour)
	defer timer.Stop()
	for {
		w.mu.Lock()
		deadline := w.deadline
		closed := w.closed
		w.mu.Unlock()
		if closed {
			return
		}
		if deadline.IsZero() {
			select {
			case <-ctx.Done():
				return
			case <-w.wake:
			}
			continue
		}
		wait := time.Until(deadline)
		if wait < 0 {
			wait = 0
		}
		if !timer.Stop() {
			select {
			case <-timer.C:
			default:
			}
		}
		timer.Reset(wait)
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		case <-w.wake:
			// 有新事件：重新按新的截止时间等待。
			continue
		}
		w.flush(ctx)
	}
}

// flush 提交当前批次。文件仍在写入时推迟到下一轮。
//
// 批次在取出时就换走：换走之后这一批只归 flush 所有，事件处理那边
// 往新批次里写，两边不再碰同一份数据 —— 否则「读批次」与「写批次」
// 会并发跑在同一张表上。
func (w *ChangeWatcher) flush(ctx context.Context) {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	batch := w.pending
	if batch.Empty() {
		w.batchAt = time.Time{}
		w.deadline = time.Time{}
		w.mu.Unlock()
		return
	}
	// 把批次换走：之后到达的事件进入新的批次。
	w.pending = newSyncChangeSet()
	w.mu.Unlock()

	if !w.filesStable(batch) {
		// 文件还在写：这一批放回去，重新计时，等它写完再提交。
		w.mu.Lock()
		w.rounds++
		exhausted := w.rounds >= watchStabilityRounds
		if !exhausted {
			w.pending.Merge(batch)
		}
		w.mu.Unlock()
		if !exhausted {
			w.armTimer()
			return
		}
		// 超过确认轮次：按当前状态提交，避免永远等下去。
		// 刚才没有合并回去，这一批不会被重复提交。
	}

	w.mu.Lock()
	w.sizes = make(map[string]int64)
	w.rounds = 0
	// 这一批到此结束：批次起点清掉，下一批从头计时。
	w.batchAt = time.Time{}
	hasPending := !w.pending.Empty()
	if !hasPending {
		// 没有新变化：计时器也清掉，等下一次事件再排。
		w.deadline = time.Time{}
	}
	w.mu.Unlock()
	if hasPending {
		// 提交期间到达的新变化已经在等着了：重新排一次提交。
		//
		// 计时器不能就这么抹掉 —— 提交线程已经醒过一次，不会再有
		// 第二次唤醒，这批变化会一直搁到下一次文件变化才有机会提交。
		w.armTimer()
	}

	if w.opts.OnChange != nil {
		w.opts.OnChange(batch)
	}
}

// filesStable 判断批次里的文件是否都已经写完。
//
// 判定方式是「两次观测之间大小没有变化」。第一次观测只建立基线，
// 还不能确认文件写完了 —— 新写入的图片要等下一轮才提交，
// 免得把写了一半的文件写进图库。
//
// 批次在调用方那里已经是独占的，这里读它不需要加锁；
// 只有跨批次共用的 sizes 需要保护。
func (w *ChangeWatcher) filesStable(batch *SyncChangeSet) bool {
	stable := true
	w.mu.Lock()
	sizes := w.sizes
	w.mu.Unlock()
	next := make(map[string]int64, len(batch.Files))
	for path := range batch.Files {
		info, err := os.Lstat(path)
		if err != nil {
			// 文件已经消失：不是「仍在写入」，交给删除流程处理。
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		size := info.Size()
		next[path] = size
		previous, exists := sizes[path]
		if !exists {
			// 第一次观测：只建立基线。
			stable = false
			continue
		}
		if previous != size {
			// 大小又变了：文件还在写。
			stable = false
		}
	}
	w.mu.Lock()
	w.sizes = next
	w.mu.Unlock()
	return stable
}

// addTree 登记一棵目录树的监听。
func (w *ChangeWatcher) addTree(ctx context.Context, root string, initialFiles map[string]struct{}) error {
	if directoryHasNoMediaMarker(root) {
		return nil
	}
	return w.walkDirs(ctx, root, initialFiles, w.addDir)
}

// addDir 登记单个目录的监听。
func (w *ChangeWatcher) addDir(dir string) error {
	w.mu.Lock()
	if _, exists := w.watched[dir]; exists {
		w.mu.Unlock()
		return nil
	}
	if len(w.watched) >= w.opts.MaxWatchDirs {
		w.degraded = true
		w.mu.Unlock()
		return nil
	}
	watcher := w.watcher
	w.mu.Unlock()
	if watcher == nil {
		return errors.New("watcher is not started")
	}
	if err := watcher.AddWith(dir, fsnotify.WithBufferSize(w.opts.BufferSize)); err != nil {
		return err
	}
	w.mu.Lock()
	w.watched[dir] = struct{}{}
	w.mu.Unlock()
	return nil
}

// delegatedRoots 取出「独立配置、需要单独监听」的媒体根名单快照。
//
// 快照是必须的：rootKeys 会被 SetRoots 换掉，而遍历目录可能同时
// 被换根与新建目录事件触发。直接读那张表就是并发读写。
func (w *ChangeWatcher) delegatedRoots() map[string]struct{} {
	w.mu.Lock()
	defer w.mu.Unlock()
	keys := make(map[string]struct{}, len(w.rootKeys))
	for key := range w.rootKeys {
		keys[key] = struct{}{}
	}
	return keys
}

// removeSubtree 摘掉某个路径及其子目录的监听。
func (w *ChangeWatcher) removeSubtree(root string) {
	w.mu.Lock()
	prefix := filepath.Clean(root)
	watcher := w.watcher
	victims := make([]string, 0, 4)
	for dir := range w.watched {
		if dir == prefix || strings.HasPrefix(dir, prefix+string(filepath.Separator)) {
			victims = append(victims, dir)
		}
	}
	for _, dir := range victims {
		delete(w.watched, dir)
	}
	w.mu.Unlock()
	if watcher != nil {
		for _, dir := range victims {
			_ = watcher.Remove(dir)
		}
	}
}

// walkDirs 遍历 root 下所有需要监听的目录。
//
// 跳过被排除规则排除的目录、符号链接、独立配置的媒体根（它们各自
// 单独监听）以及带 .nomedia 标记的目录 —— 扫描器不读它们，监听它们
// 只会浪费句柄。
func (w *ChangeWatcher) walkDirs(ctx context.Context, root string, initialFiles map[string]struct{}, visit func(dir string) error) error {
	type task struct {
		path  string
		depth int
	}
	// 独立配置的媒体根各自单独监听，遍历时要跳过。
	//
	// 这份名单要先取快照再读：SetRoots 会在监听运行期间换掉它，
	// 直接读那张表就是并发读写 —— 换根的瞬间正好撞上新建目录事件，
	// 竞态检测器会当场报出来。
	delegated := w.delegatedRoots()
	queue := []task{{path: root}}
	for len(queue) > 0 {
		if err := ctx.Err(); err != nil {
			return err
		}
		current := queue[0]
		queue = queue[1:]
		if err := visit(current.path); err != nil {
			return err
		}
		entries, err := os.ReadDir(current.path)
		if err != nil {
			// 目录读不了（权限不足、已被删除）时跳过这一支，
			// 定期校验会再试一次。
			continue
		}
		for _, entry := range entries {
			if entry.Type()&(os.ModeSymlink|os.ModeIrregular) != 0 {
				continue
			}
			if !entry.IsDir() {
				if initialFiles != nil && entry.Type().IsRegular() {
					initialFiles[filepath.Join(current.path, entry.Name())] = struct{}{}
				}
				continue
			}
			if w.opts.Exclude.ShouldSkipDir(entry.Name()) {
				continue
			}
			child := filepath.Join(current.path, entry.Name())
			if _, ok := delegated[pathutil.RootKey(child)]; ok {
				continue
			}
			if directoryHasNoMediaMarker(child) {
				continue
			}
			queue = append(queue, task{path: child, depth: current.depth + 1})
		}
	}
	return nil
}
