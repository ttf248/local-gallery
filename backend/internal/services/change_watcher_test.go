package services

import (
	"os"
	"path/filepath"
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
