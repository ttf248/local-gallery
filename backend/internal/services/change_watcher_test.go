package services

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

// newTestWatcher 造一个静默窗口很短的监听器，方便测试快速收敛。
func newTestWatcher(t *testing.T, root string, onChange func(*SyncChangeSet)) *ChangeWatcher {
	t.Helper()
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     60 * time.Millisecond,
		MaxWait:      2 * time.Second,
		MaxWatchDirs: 100,
		OnChange:     onChange,
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	return watcher
}

func TestChangeWatcher_ReportsNewFile(t *testing.T) {
	root := t.TempDir()
	batches := make(chan *SyncChangeSet, 4)
	watcher := newTestWatcher(t, root, func(changes *SyncChangeSet) {
		select {
		case batches <- changes:
		default:
		}
	})
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(album, "a.jpg")
	if err := os.WriteFile(file, []byte("image"), 0o644); err != nil {
		t.Fatal(err)
	}

	select {
	case batch := <-batches:
		if _, ok := batch.Files[file]; !ok {
			t.Fatalf("批次里没有新文件 %s：%v", file, batch.Files)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("没有收到文件变化")
	}
}

func TestChangeWatcher_WaitsUntilFileStopsGrowing(t *testing.T) {
	root := t.TempDir()
	batches := make(chan *SyncChangeSet, 8)
	watcher := newTestWatcher(t, root, func(changes *SyncChangeSet) {
		select {
		case batches <- changes:
		default:
		}
	})
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	file := filepath.Join(root, "growing.jpg")
	if err := os.WriteFile(file, []byte("start"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 连续追加内容，模拟还在写入的文件。
	for i := 0; i < 4; i++ {
		time.Sleep(80 * time.Millisecond)
		file, err := os.OpenFile(file, os.O_APPEND|os.O_WRONLY, 0o644)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = file.WriteString("more-content"); err != nil {
			t.Fatal(err)
		}
		_ = file.Close()
	}

	var first *SyncChangeSet
	select {
	case first = <-batches:
	case <-time.After(5 * time.Second):
		t.Fatal("没有收到文件变化")
	}
	// 第一批到达时文件仍在写：它不该被当成「写完了」。
	info, err := os.Stat(file)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Files) != 1 {
		t.Fatalf("批次里应只有一个文件，实际 %v", first.Files)
	}
	_ = info
}

func TestChangeWatcher_IgnoresPathsOutsideRoots(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	batches := make(chan *SyncChangeSet, 4)
	watcher := newTestWatcher(t, root, func(changes *SyncChangeSet) {
		select {
		case batches <- changes:
		default:
		}
	})
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	if err := os.WriteFile(filepath.Join(outside, "a.jpg"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	select {
	case batch := <-batches:
		t.Fatalf("根目录外的事件不该被报告：%v", batch)
	case <-time.After(500 * time.Millisecond):
	}
}

func TestChangeWatcher_RegistersNewSubdirectory(t *testing.T) {
	root := t.TempDir()
	watcher := newTestWatcher(t, root, func(*SyncChangeSet) {})
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if watcher.Status().WatchedDirs >= 2 {
			return
		}
		time.Sleep(50 * time.Millisecond)
	}
	t.Fatalf("新目录没有被登记监听：%+v", watcher.Status())
}

// TestChangeWatcher_SetRootsDoesNotRaceWithEvents 验证换媒体根与目录
// 遍历并发时不会出现数据竞态。
//
// 换根会改写「哪些根要单独监听」那张表，而遍历目录时要读它。
// 以前遍历时是直接读那张表的：换根的瞬间正好撞上另一次换根或新建
// 目录事件，就是一次并发读写同一张表 —— 撞上就是进程直接崩掉。
//
// 用例本身不做断言：它要交给 `go test -race` 判断。
func TestChangeWatcher_SetRootsDoesNotRaceWithEvents(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	// 根下面要有子目录：遍历时才会去查那张表。
	for i := 0; i < 20; i++ {
		if err := os.MkdirAll(filepath.Join(root, fmt.Sprintf("album%02d", i)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     time.Millisecond,
		MaxWait:      20 * time.Millisecond,
		MaxWatchDirs: 200,
		OnChange:     func(*SyncChangeSet) {},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	ctx := t.Context()
	stop := make(chan struct{})
	var group sync.WaitGroup
	group.Add(3)
	// 两边同时换根：一边改写那张表，一边遍历目录去读它。
	for worker := 0; worker < 2; worker++ {
		go func() {
			defer group.Done()
			for {
				select {
				case <-stop:
					return
				default:
				}
				watcher.SetRoots(ctx, []string{root, other})
				watcher.SetRoots(ctx, []string{root})
			}
		}()
	}
	// 一边不停建目录，触发遍历目录的路径。
	go func() {
		defer group.Done()
		for i := 0; i < 300; i++ {
			_ = os.MkdirAll(filepath.Join(root, fmt.Sprintf("d%03d", i)), 0o755)
		}
		close(stop)
	}()
	group.Wait()
	time.Sleep(300 * time.Millisecond)
}

// TestChangeWatcher_EventDuringFlushIsNotStranded 验证提交批次期间到达的
// 新事件不会被搁浅。
//
// 批次是在提交的那段时间里换走的：这段时间里有新事件到达，计时器已经
// 排好了下一次提交。提交结束时不能把计时器抹掉 —— 抹掉之后这批变化会
// 一直搁着：提交线程已经醒过一次，不会再有第二次唤醒，只能等到下一次
// 文件变化（或者定期校验）才有机会提交。
func TestChangeWatcher_EventDuringFlushIsNotStranded(t *testing.T) {
	root := t.TempDir()
	committed := make(chan *SyncChangeSet, 4)
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     10 * time.Millisecond,
		MaxWait:      time.Second,
		MaxWatchDirs: 100,
		OnChange: func(changes *SyncChangeSet) {
			select {
			case committed <- changes:
			default:
			}
		},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	// 一批足够大的清单：提交前要逐个 stat，窗口足够宽，
	// 新事件能落在窗口里。
	const bulk = 4000
	watcher.mu.Lock()
	for i := 0; i < bulk; i++ {
		watcher.pending.Files[filepath.Join(root, fmt.Sprintf("f%05d.jpg", i))] = struct{}{}
	}
	watcher.mu.Unlock()
	watcher.armTimer()

	// 盯着待处理集合：批次被换走的那一瞬就是提交窗口。
	injected := make(chan struct{})
	go func() {
		defer close(injected)
		for {
			watcher.mu.Lock()
			swapped := watcher.pending.Size() == 0 && !watcher.batchAt.IsZero()
			watcher.mu.Unlock()
			if swapped {
				// 模拟窗口里到达的新事件。
				watcher.markFile(filepath.Join(root, "late.jpg"))
				watcher.armTimer()
				return
			}
			runtime.Gosched()
		}
	}()
	select {
	case <-injected:
	case <-time.After(20 * time.Second):
		t.Fatal("没有等到提交窗口")
	}

	// 等这一批提交完：提交回调在收尾之后，那时计时器该在不该在
	// 已经定了。
	select {
	case <-committed:
	case <-time.After(20 * time.Second):
		t.Fatal("这批变化没有提交")
	}

	// 计时器必须还在：新事件不能被搁浅。
	watcher.mu.Lock()
	scheduled := watcher.deadline
	watcher.mu.Unlock()
	if scheduled.IsZero() {
		t.Fatal("提交期间到达的新事件被搁浅了：计时器被抹掉")
	}
}

// TestChangeWatcher_ExhaustedStabilityIsNotDeliveredTwice 验证文件一直
// 写不完时同一批变化不会被提交两次。
//
// 超过确认轮次时要按当前状态提交，但那份提交过的批次不能还留在待处理
// 集合里 —— 留着的话下一轮会把同样的变化再交一次，检测数量翻倍，
// 还会白白多扫一次图库。
//
// 用例让一个文件一直写：批次因此永远稳定不下来，任何一次提交都只能
// 是「超过确认轮次后的强行提交」。另一个只写一次的文件用来分辨：
// 它被提交过之后就不该还留在待处理集合里。
func TestChangeWatcher_ExhaustedStabilityIsNotDeliveredTwice(t *testing.T) {
	root := t.TempDir()
	delivered := make(chan *SyncChangeSet, 8)
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     5 * time.Millisecond,
		MaxWait:      5 * time.Second,
		MaxWatchDirs: 100,
		OnChange: func(changes *SyncChangeSet) {
			select {
			case delivered <- changes:
			default:
			}
		},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	if err := watcher.Start(t.Context()); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	defer watcher.Close()

	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		t.Fatal(err)
	}
	waitForWatchedDirs(t, watcher, 2)

	// 只写一次的文件：它进过这一批，之后就不再变化。
	settled := filepath.Join(album, "settled.jpg")
	if err := os.WriteFile(settled, []byte("settled"), 0o644); err != nil {
		t.Fatal(err)
	}
	// 一直写的文件：每次都变大，批次因此永远稳定不下来。
	growing := filepath.Join(album, "growing.jpg")
	stop := make(chan struct{})
	defer close(stop)
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			file, err := os.OpenFile(growing, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
			if err == nil {
				_, _ = file.Write([]byte("x"))
				_ = file.Close()
			}
			time.Sleep(time.Millisecond)
		}
	}()

	// 超过确认轮次之后才提交：那一批里有只写过一次的那张。
	var batch *SyncChangeSet
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case candidate := <-delivered:
			if _, exists := candidate.Files[settled]; !exists {
				continue
			}
			batch = candidate
		default:
		}
		if batch != nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if batch == nil {
		t.Fatal("一直写不完的文件没有触发强行提交")
	}

	// 强行提交之后，那份批次不能还留在待处理集合里。
	time.Sleep(200 * time.Millisecond)
	watcher.mu.Lock()
	_, stillQueued := watcher.pending.Files[settled]
	watcher.mu.Unlock()
	if stillQueued {
		t.Fatal("同一批变化被留在了待处理集合里，会被再提交一次")
	}
}

// TestChangeWatcher_StartDoesNotRaceWithSetRoots 验证启动监听与换根并发
// 时不会出现数据竞态。
//
// 启动时要遍历媒体根，换根要改写媒体根名单。以前启动时是直接读那份
// 名单的：换根撞上启动，就是一次并发读写同一份数据。
//
// 用例本身不做断言：它要交给 `go test -race` 判断。
func TestChangeWatcher_StartDoesNotRaceWithSetRoots(t *testing.T) {
	root := t.TempDir()
	other := t.TempDir()
	for i := 0; i < 20; i++ {
		if err := os.MkdirAll(filepath.Join(root, fmt.Sprintf("album%02d", i)), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	watcher, err := NewChangeWatcher(ChangeWatcherOptions{
		Roots:        []string{root},
		Exclude:      DefaultExclude(),
		Debounce:     time.Millisecond,
		MaxWait:      20 * time.Millisecond,
		MaxWatchDirs: 200,
		OnChange:     func(*SyncChangeSet) {},
	})
	if err != nil {
		t.Fatalf("create watcher: %v", err)
	}
	ctx := t.Context()
	stop := make(chan struct{})
	var group sync.WaitGroup
	group.Add(1)
	go func() {
		defer group.Done()
		for {
			select {
			case <-stop:
				return
			default:
			}
			watcher.SetRoots(ctx, []string{root, other})
			watcher.SetRoots(ctx, []string{root})
		}
	}()
	if err := watcher.Start(ctx); err != nil {
		t.Fatalf("start watcher: %v", err)
	}
	close(stop)
	group.Wait()
	_ = watcher.Close()
}
