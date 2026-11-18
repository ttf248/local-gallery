package services

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// overwriteInPlace 原地覆盖一个文件，并把修改时间明确往后挪。
//
// 挪修改时间是为了避开文件时间精度：同一时间刻里改写同一个文件，
// 系统可能给出相同的修改时间，那就没有「内容变了」这回事了。
func overwriteInPlace(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
}

// TestIncrementalScan_OverwriteInPlaceIsContentChange 验证原地覆盖一张照片
// 会被认成「内容变了」。
//
// 原地覆盖不动目录结构：文件还在、名字没变、目录修改时间也没变。
// 只比路径与目录修改时间的话，这次覆盖会被判成「什么都没变」，
// 图库停在旧内容上，界面与派生数据都不会更新。
func TestIncrementalScan_OverwriteInPlaceIsContentChange(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	target := filepath.Join(album, "a.jpg")
	touchAll(t, target)

	before := scanAll(t, root)
	overwriteInPlace(t, target, "brand new content")

	out := applyIncremental(t, root, before, changeSetFor(target))
	if len(out.AddedFiles) != 0 || len(out.RemovedFiles) != 0 {
		t.Fatalf("原地覆盖不该改变文件清单：added=%v removed=%v", out.AddedFiles, out.RemovedFiles)
	}
	if !out.Changed {
		t.Fatal("原地覆盖后图库应该变了：内容变了")
	}
	if len(out.ChangedContentAlbums) != 1 || out.ChangedContentAlbums[0] != album {
		t.Fatalf("应该报出内容变化的相册 %s，实际 %v", album, out.ChangedContentAlbums)
	}
	if len(out.ChangedContentFiles) != 1 || out.ChangedContentFiles[0] != target {
		t.Fatalf("应该报出内容变化的文件 %s，实际 %v", target, out.ChangedContentFiles)
	}
}

// TestIncrementalScan_OverwriteInPlaceWithSameSizeIsContentChange 验证
// 大小没变、只有内容变了的情况同样能被认出来。
func TestIncrementalScan_OverwriteInPlaceWithSameSizeIsContentChange(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	target := filepath.Join(album, "a.jpg")
	touchAll(t, target)

	before := scanAll(t, root)
	overwriteInPlace(t, target, "fake")

	out := applyIncremental(t, root, before, changeSetFor(target))
	if !out.Changed {
		t.Fatal("大小相同但内容变了也算内容变化")
	}
	if len(out.ChangedContentAlbums) != 1 {
		t.Fatalf("应该报出一个内容变化的相册，实际 %v", out.ChangedContentAlbums)
	}
}

// TestIncrementalScan_TouchDirectoryKeepsLibraryStable 验证只是被碰了一下的
// 目录不会让图库版本跳动。
//
// 目录修改时间不参与结构指纹：否则「碰一下目录」就会触发一次全量
// 资源索引重建，界面白刷一遍。
func TestIncrementalScan_TouchDirectoryKeepsLibraryStable(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	touchAll(t, filepath.Join(album, "a.jpg"))

	before := scanAll(t, root)
	stamp := time.Now().Add(2 * time.Second)
	if err := os.Chtimes(album, stamp, stamp); err != nil {
		t.Fatal(err)
	}

	out := applyIncremental(t, root, before, changeSetFor(filepath.Join(album, "a.jpg")))
	if out.Changed {
		t.Fatal("只是被碰了一下的目录不该让图库版本跳动")
	}
}

// TestIncrementalScan_RootLevelFileIsReported 验证媒体根目录里的散图
// 也进得了变化清单。
//
// 根目录的相册以前不参与比较：根目录里新增或被覆盖的照片既不会进
// 变化清单，也不会被排进分析。
func TestIncrementalScan_RootLevelFileIsReported(t *testing.T) {
	root := t.TempDir()
	before := scanAll(t, root)

	added := filepath.Join(root, "loose.jpg")
	touchAll(t, added)

	out := applyIncremental(t, root, before, changeSetFor(added))
	if len(out.AddedFiles) != 1 || out.AddedFiles[0] != added {
		t.Fatalf("根目录里新增的文件应进变化清单，实际 %v", out.AddedFiles)
	}
}

// TestIncrementalScan_RootLevelOverwriteIsContentChange 验证媒体根目录里
// 被原地覆盖的照片同样能被认出来。
func TestIncrementalScan_RootLevelOverwriteIsContentChange(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(root, "loose.jpg")
	touchAll(t, target)

	before := scanAll(t, root)
	overwriteInPlace(t, target, "brand new content")

	out := applyIncremental(t, root, before, changeSetFor(target))
	if !out.Changed {
		t.Fatal("根目录里原地覆盖也算内容变化")
	}
	if len(out.ChangedContentFiles) != 1 || out.ChangedContentFiles[0] != target {
		t.Fatalf("应该报出内容变化的文件 %s，实际 %v", target, out.ChangedContentFiles)
	}
}

// TestIncrementalScan_AlbumContentSignatureChanges 验证相册的内容指纹会
// 跟着文件内容变化。
func TestIncrementalScan_AlbumContentSignatureChanges(t *testing.T) {
	root := t.TempDir()
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	target := filepath.Join(album, "a.jpg")
	touchAll(t, target)

	before := scanAll(t, root)
	first := ""
	for i := range before.Albums {
		if before.Albums[i].Path == album {
			first = before.Albums[i].ContentSignature
		}
	}
	if first == "" {
		t.Fatal("扫描结果里没有相册的内容指纹")
	}

	overwriteInPlace(t, target, "brand new content")
	after := scanAll(t, root)
	second := ""
	for i := range after.Albums {
		if after.Albums[i].Path == album {
			second = after.Albums[i].ContentSignature
		}
	}
	if first == second {
		t.Fatal("内容变了，内容指纹却没变")
	}
}
