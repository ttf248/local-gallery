package services

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// scanAll 跑一次完整扫描，作为增量结果的对照基准。
func scanAll(t *testing.T, root string) *models.ScanResult {
	t.Helper()
	scanner := NewScanner()
	result, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	return result
}

// libraryShape 把扫描结果压成可比较的结构清单。
//
// 增量更新与全量扫描必须得到同一份结构：这是「图库正确更新」而不是
// 「事件已收到」的判据。
func libraryShape(result *models.ScanResult) []string {
	var lines []string
	var walk func(albums []models.Album, collections []models.Collection)
	walk = func(albums []models.Album, collections []models.Collection) {
		for i := range albums {
			files := append([]string(nil), albums[i].ImageFiles...)
			files = append(files, albums[i].VideoFiles...)
			sort.Strings(files)
			lines = append(lines, "A "+albums[i].Path+" | "+strings.Join(files, ","))
		}
		for i := range collections {
			lines = append(lines, "C "+collections[i].Path)
			walk(collections[i].Albums, collections[i].Collections)
		}
	}
	walk(result.Albums, result.Collections)
	sort.Strings(lines)
	return lines
}

// changeSetFor 构造一批文件变化：文件本身与它所在的目录都算变了。
func changeSetFor(files ...string) *SyncChangeSet {
	changes := newSyncChangeSet()
	for _, file := range files {
		changes.Files[file] = struct{}{}
		changes.Dirs[filepath.Dir(file)] = struct{}{}
	}
	return changes
}

// applyIncremental 跑一次增量更新，并断言结果与全量扫描一致。
func applyIncremental(t *testing.T, root string, previous *models.ScanResult, changes *SyncChangeSet) *IncrementalOutcome {
	t.Helper()
	out, err := NewIncrementalEngine().Apply(previous, changes, ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("incremental scan failed: %v", err)
	}
	expected := scanAll(t, root)
	got := libraryShape(out.Result)
	want := libraryShape(expected)
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("incremental result differs from full scan:\n got: %v\nwant: %v", got, want)
	}
	return out
}

func TestIncrementalScan_AddFileToExistingAlbum(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))

	before := scanAll(t, root)
	added := filepath.Join(album, "b.jpg")
	touchAll(t, added)

	out := applyIncremental(t, root, before, changeSetFor(added))
	if len(out.AddedFiles) != 1 || out.AddedFiles[0] != added {
		t.Fatalf("expected one added file %s, got %v", added, out.AddedFiles)
	}
	if len(out.RemovedFiles) != 0 {
		t.Fatalf("expected no removed files, got %v", out.RemovedFiles)
	}
	if len(out.ChangedAlbums) != 1 || out.ChangedAlbums[0] != album {
		t.Fatalf("expected changed album %s, got %v", album, out.ChangedAlbums)
	}
}

func TestIncrementalScan_RemoveFile(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"), filepath.Join(album, "b.jpg"))

	before := scanAll(t, root)
	removed := filepath.Join(album, "b.jpg")
	if err := os.Remove(removed); err != nil {
		t.Fatal(err)
	}

	out := applyIncremental(t, root, before, changeSetFor(removed))
	if len(out.RemovedFiles) != 1 || out.RemovedFiles[0] != removed {
		t.Fatalf("expected removed file %s, got %v", removed, out.RemovedFiles)
	}
}

func TestIncrementalScan_AddNewAlbumDirectory(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "old"))
	touchAll(t, filepath.Join(root, "old", "a.jpg"))

	before := scanAll(t, root)
	newAlbum := filepath.Join(root, "new")
	mkdirAll(t, newAlbum)
	touchAll(t, filepath.Join(newAlbum, "a.jpg"))

	out := applyIncremental(t, root, before, changeSetFor(filepath.Join(newAlbum, "a.jpg")))
	if len(out.AddedDirs) != 1 || out.AddedDirs[0] != newAlbum {
		t.Fatalf("expected added dir %s, got %v", newAlbum, out.AddedDirs)
	}
	if len(out.AddedFiles) != 1 {
		t.Fatalf("expected one added file, got %v", out.AddedFiles)
	}
}

func TestIncrementalScan_RemoveAlbumDirectory(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"), filepath.Join(album, "b.jpg"))

	before := scanAll(t, root)
	if err := os.RemoveAll(album); err != nil {
		t.Fatal(err)
	}

	out := applyIncremental(t, root, before, changeSetFor(filepath.Join(album, "a.jpg")))
	if len(out.RemovedFiles) != 2 {
		t.Fatalf("expected two removed files, got %v", out.RemovedFiles)
	}
	if len(out.RemovedDirs) != 1 {
		t.Fatalf("expected one removed dir, got %v", out.RemovedDirs)
	}
}

func TestIncrementalScan_MoveAlbumDirectory(t *testing.T) {
	root := t.TempDir()
	source := filepath.Join(root, "source")
	mkdirAll(t, source)
	touchAll(t, filepath.Join(source, "a.jpg"))

	before := scanAll(t, root)
	target := filepath.Join(root, "target")
	if err := os.Rename(source, target); err != nil {
		t.Fatal(err)
	}

	// 改名在监听器看来是「旧路径消失 + 新路径出现」。
	changes := changeSetFor(filepath.Join(source, "a.jpg"), filepath.Join(target, "a.jpg"))
	out := applyIncremental(t, root, before, changes)
	if len(out.RemovedFiles) != 1 {
		t.Fatalf("expected one removed file, got %v", out.RemovedFiles)
	}
	if len(out.AddedFiles) != 1 {
		t.Fatalf("expected one added file, got %v", out.AddedFiles)
	}
}

func TestIncrementalScan_ModifyFileKeepsStructure(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))

	before := scanAll(t, root)
	modified := filepath.Join(album, "a.jpg")
	if err := os.WriteFile(modified, []byte("changed content"), 0o644); err != nil {
		t.Fatal(err)
	}

	out := applyIncremental(t, root, before, changeSetFor(modified))
	// 原地改写不改变目录结构，索引里的文件清单保持不变。
	if len(out.AddedFiles) != 0 || len(out.RemovedFiles) != 0 {
		t.Fatalf("expected no structural change, got added=%v removed=%v", out.AddedFiles, out.RemovedFiles)
	}
}

func TestIncrementalScan_NestedCollectionKeepsSiblings(t *testing.T) {
	root := t.TempDir()
	series := filepath.Join(root, "2020")
	nested := filepath.Join(series, "spring")
	sibling := filepath.Join(series, "summer")
	mkdirAll(t, nested)
	mkdirAll(t, sibling)
	touchAll(t, filepath.Join(nested, "a.jpg"), filepath.Join(sibling, "b.jpg"))

	before := scanAll(t, root)
	added := filepath.Join(nested, "c.jpg")
	touchAll(t, added)

	out := applyIncremental(t, root, before, changeSetFor(added))
	if len(out.AddedFiles) != 1 {
		t.Fatalf("expected one added file, got %v", out.AddedFiles)
	}
	// 未变化的兄弟目录不能被重算：只有变化路径上的目录会被重新读取。
	if out.RescannedDirs > 4 {
		t.Fatalf("expected a bounded number of rescanned dirs, got %d", out.RescannedDirs)
	}
}

func TestIncrementalScan_IgnoresChangesOutsideRoots(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "album"))
	touchAll(t, filepath.Join(root, "album", "a.jpg"))

	before := scanAll(t, root)
	outside := filepath.Join(t.TempDir(), "elsewhere.jpg")
	changes := changeSetFor(outside)

	out, err := NewIncrementalEngine().Apply(before, changes, ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("incremental scan failed: %v", err)
	}
	if len(out.AddedFiles) != 0 || len(out.RemovedFiles) != 0 {
		t.Fatalf("expected no change for outside paths, got %v / %v", out.AddedFiles, out.RemovedFiles)
	}
}

func TestIncrementalScan_EmptyRootProducesEmptyResult(t *testing.T) {
	root := t.TempDir()
	before := scanAll(t, root)
	out := applyIncremental(t, root, before, changeSetFor(filepath.Join(root, "nope.jpg")))
	if out.Result.AlbumCount != 0 {
		t.Fatalf("expected empty library, got %d albums", out.Result.AlbumCount)
	}
}

func TestIncrementalScan_KeepsOfflineRootContent(t *testing.T) {
	online := t.TempDir()
	offline := filepath.Join(t.TempDir(), "offline")
	mkdirAll(t, filepath.Join(online, "album"))
	touchAll(t, filepath.Join(online, "album", "a.jpg"))

	opts := ScanOptions{Roots: []string{online, offline}}
	before := scanAll(t, online)

	// 离线的根让全量扫描无法完成，这里只验证增量更新不会因此丢掉
	// 其它根的内容，也不会报错。
	changes := changeSetFor(filepath.Join(online, "album", "b.jpg"))
	touchAll(t, filepath.Join(online, "album", "b.jpg"))
	out, err := NewIncrementalEngine().Apply(before, changes, opts)
	if err != nil {
		t.Fatalf("增量扫描不应因为离线的根失败: %v", err)
	}
	if len(out.AddedFiles) != 1 {
		t.Fatalf("应检测到新增文件，实际 %v", out.AddedFiles)
	}
	found := false
	for _, album := range out.Result.Albums {
		if filepath.Clean(album.Path) == filepath.Clean(filepath.Join(online, "album")) {
			found = true
		}
	}
	if !found {
		t.Fatalf("在线根的相册丢了：%v", out.Result.Albums)
	}
}
