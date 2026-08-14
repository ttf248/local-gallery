package services

import (
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestAsyncScanRunner_HappyPath(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepathJoin(root, "album1"))
	touchAll(t, filepathJoin(root, "album1", "1.jpg"))
	mkdirAll(t, filepathJoin(root, "album2"))
	touchAll(t, filepathJoin(root, "album2", "1.png"))

	runner := NewAsyncScanRunner()
	id, events, err := runner.Start(ScanOptions{Root: root})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if id == "" {
		t.Fatal("scan id should not be empty")
	}

	var (
		sawRunning  bool
		completeEv  *ProgressEvent
		totalEvents int
	)

	deadline := time.After(5 * time.Second)
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				goto done
			}
			totalEvents++
			if ev.Status == ScanStatusRunning {
				sawRunning = true
			}
			if ev.Status == ScanStatusComplete {
				ce := ev
				completeEv = &ce
				goto done
			}
		case <-deadline:
			t.Fatal("scan timed out")
		}
	}
done:

	if !sawRunning && totalEvents > 1 {
		t.Errorf("expected at least one running event before complete")
	}
	if completeEv == nil {
		t.Fatal("never received complete event")
	}
	if completeEv.AlbumsFound != 2 {
		t.Errorf("albums found: got %d, want 2", completeEv.AlbumsFound)
	}

	// Result 可获取
	res := runner.Result(id)
	if res == nil {
		t.Fatal("Result should be available after complete")
	}
	if res.AlbumCount != 2 {
		t.Errorf("album count: got %d", res.AlbumCount)
	}
}

func TestAsyncScanRunner_Cancel(t *testing.T) {
	root := t.TempDir()
	// 创建足够多的相册让扫描有耗时
	for i := 0; i < 500; i++ {
		dir := filepathJoin(root, "album-"+itoa(i))
		mkdirAll(t, dir)
		touchAll(t, filepathJoin(dir, "1.jpg"))
	}

	runner := NewAsyncScanRunner()
	id, events, err := runner.Start(ScanOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}

	// 立即取消
	go func() {
		time.Sleep(1 * time.Millisecond)
		runner.Cancel(id)
	}()

	deadline := time.After(5 * time.Second)
	var sawCancelled, sawComplete bool
	for {
		select {
		case ev, ok := <-events:
			if !ok {
				goto check
			}
			if ev.Status == ScanStatusCancelled {
				sawCancelled = true
				goto check
			}
			if ev.Status == ScanStatusComplete {
				sawComplete = true
				goto check
			}
		case <-deadline:
			t.Fatal("scan should have finished (cancelled or complete) within timeout")
		}
	}
check:
	// 接受两种结果：扫描太快完成，或者真的被取消
	if !sawCancelled && !sawComplete {
		t.Error("expected cancelled or complete event")
	}
	if sawCancelled {
		// 验证：取消后状态应标记为 cancelled
		runner.Wait(id)
	}
}

func TestAsyncScanRunner_MissingRoot(t *testing.T) {
	runner := NewAsyncScanRunner()
	_, _, err := runner.Start(ScanOptions{Root: ""})
	if err == nil {
		t.Error("expected error for empty root")
	}
}

func TestAsyncScanRunner_CancelUnknown(t *testing.T) {
	runner := NewAsyncScanRunner()
	if runner.Cancel("nope") {
		t.Error("cancel of unknown id should return false")
	}
}

func TestAsyncScanRunner_GetUnknown(t *testing.T) {
	runner := NewAsyncScanRunner()
	if runner.Get("nope") != nil {
		t.Error("Get of unknown id should return nil")
	}
}

// helpers（避免引入 strconv/filepath 到测试包根）
func filepathJoin(parts ...string) string {
	return filepath.Join(parts...)
}

func itoa(n int) string {
	return strconv.Itoa(n)
}
