package services

import (
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"testing"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// mkdirAll / touchAll 是测试辅助：创建多层级目录结构与空图片占位文件。
func mkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o755); err != nil {
		t.Fatal(err)
	}
}

func touchAll(t *testing.T, paths ...string) {
	t.Helper()
	for _, p := range paths {
		if err := os.WriteFile(p, []byte("fake"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

func TestExtractAuthor(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"[作者A] Vol.1", "作者A"},
		{"[ 作者B ] Chapter 3", "作者B"},
		{"[作者 C] Book", "作者 C"},
		{"[Unclosed", ""},
		{"Unbracketed", ""},
		{"prefix[]empty", ""},
		{"", ""},
		{"[ ]", ""},
		{"[a][b]", "a"},
	}
	for _, tc := range cases {
		if got := ExtractAuthor(tc.in); got != tc.want {
			t.Errorf("ExtractAuthor(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestScan_MissingRoot(t *testing.T) {
	s := NewScanner()
	_, err := s.Scan(ScanOptions{Root: filepath.Join(t.TempDir(), "nope")})
	if err == nil {
		t.Fatal("expected error for missing root")
	}
	se, ok := err.(*ScanError)
	if !ok {
		t.Fatalf("expected *ScanError, got %T", err)
	}
	if se.Kind != ScanRootMissing {
		t.Errorf("expected ScanRootMissing, got %v", se.Kind)
	}
}

func TestScan_FileNotDir(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "f.txt")
	os.WriteFile(file, []byte("x"), 0o644)

	s := NewScanner()
	_, err := s.Scan(ScanOptions{Root: file})
	se, ok := err.(*ScanError)
	if !ok || se.Kind != ScanRootNotDir {
		t.Fatalf("expected ScanRootNotDir, got %v", err)
	}
}

// 构造：
//   root/
//     single/                 <- album
//       1.jpg
//     [作者A] vol1/           <- album
//       p1.png
//     [作者A] vol2/           <- album
//       p2.jpg
//     [作者B] single/         <- album
//       p3.gif
//     coll/                   <- collection
//       albumX/
//         a.jpg
//       albumY/               <- 子目录但无图片 → 应忽略
//     empty/
func TestScan_TopLevelAlbumsAndCollections(t *testing.T) {
	root := t.TempDir()
	mkdirAll(t, filepath.Join(root, "single"))
	touchAll(t, filepath.Join(root, "single", "1.jpg"))

	mkdirAll(t, filepath.Join(root, "[作者A] vol1"))
	touchAll(t, filepath.Join(root, "[作者A] vol1", "p1.png"))

	mkdirAll(t, filepath.Join(root, "[作者A] vol2"))
	touchAll(t, filepath.Join(root, "[作者A] vol2", "p2.jpg"))

	mkdirAll(t, filepath.Join(root, "[作者B] single"))
	touchAll(t, filepath.Join(root, "[作者B] single", "p3.gif"))

	mkdirAll(t, filepath.Join(root, "coll"))
	mkdirAll(t, filepath.Join(root, "coll", "albumX"))
	touchAll(t, filepath.Join(root, "coll", "albumX", "a.jpg"))
	mkdirAll(t, filepath.Join(root, "coll", "albumY")) // 空

	mkdirAll(t, filepath.Join(root, "empty")) // 完全空

	s := NewScanner()
	res, err := s.Scan(ScanOptions{Root: root, MaxDepth: 2})
	if err != nil {
		t.Fatalf("Scan: %v", err)
	}

	// 顶层应有 4 个相册 + 1 个集合
	if len(res.Albums) != 4 {
		t.Errorf("expected 4 top-level albums, got %d: %v", len(res.Albums), namesOf(res.Albums))
	}
	if len(res.Collections) != 1 {
		t.Errorf("expected 1 collection, got %d", len(res.Collections))
	}
	if res.Collections[0].AlbumCount != 1 {
		t.Errorf("collection album count: got %d", res.Collections[0].AlbumCount)
	}
	if len(res.Collections[0].Albums) != 1 || res.Collections[0].Albums[0].Name != "albumX" {
		t.Errorf("collection should contain albumX only, got %+v", res.Collections[0].Albums)
	}

	// smartCollection：[作者A] 有 2 个相册，[作者B] 仅 1 个
	if len(res.SmartCollections) != 1 {
		t.Fatalf("expected 1 smartCollection, got %d", len(res.SmartCollections))
	}
	if res.SmartCollections[0].Author != "作者A" {
		t.Errorf("smart author: got %q", res.SmartCollections[0].Author)
	}
	if res.SmartCollections[0].AlbumCount != 2 {
		t.Errorf("smart album count: got %d", res.SmartCollections[0].AlbumCount)
	}

	// 总相册数：4 顶层 + 1 集合内 = 5
	if res.AlbumCount != 5 {
		t.Errorf("total albums: got %d, want 5", res.AlbumCount)
	}
}

// 构造深度超过 maxDepth 的集合 → 内层应被忽略或视为相册（若无图片）。
func TestScan_DepthLimit(t *testing.T) {
	root := t.TempDir()

	// 顶层集合
	mkdirAll(t, filepath.Join(root, "L0"))
	// L0/L1/L2 三层深度
	mkdirAll(t, filepath.Join(root, "L0", "L1"))
	mkdirAll(t, filepath.Join(root, "L0", "L1", "L2"))
	touchAll(t, filepath.Join(root, "L0", "L1", "L2", "x.jpg"))

	s := NewScanner()
	res, err := s.Scan(ScanOptions{Root: root, MaxDepth: 2})
	if err != nil {
		t.Fatal(err)
	}

	// depth 0: 扫描 root
	// depth 1: 进入 L0 (集合)，再扫 L0 内部
	// depth 2: 进入 L1 (集合)，再扫 L1 内部
	// depth 3: 不会进入 L2
	// 因此 L2/x.jpg 永远不会被发现。
	if len(res.Albums) != 0 {
		t.Errorf("expected 0 albums at top, got %d", len(res.Albums))
	}
	if len(res.Collections) != 1 || res.Collections[0].Name != "L0" {
		t.Errorf("expected L0 collection, got %+v", res.Collections)
	}
	if len(res.Collections[0].Albums) != 0 {
		t.Errorf("L0 should have no albums (L2 unreachable), got %d",
			len(res.Collections[0].Albums))
	}
}

func TestScan_CoverSelection(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "album")
	mkdirAll(t, dir)
	// 故意打乱命名顺序，确保 CoverImage 是按排序后的首张
	touchAll(t,
		filepath.Join(dir, "z.jpg"),
		filepath.Join(dir, "a.jpg"),
		filepath.Join(dir, "m.jpg"),
	)

	s := NewScanner()
	res, err := s.Scan(ScanOptions{Root: root})
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Albums) != 1 {
		t.Fatalf("expected 1 album, got %d", len(res.Albums))
	}
	want := filepath.Join(dir, "a.jpg")
	if res.Albums[0].CoverImage != want {
		t.Errorf("cover: got %q, want %q", res.Albums[0].CoverImage, want)
	}
	if res.Albums[0].ImageCount != 3 {
		t.Errorf("image count: got %d", res.Albums[0].ImageCount)
	}
}

func TestScan_IgnoresNonImages(t *testing.T) {
	root := t.TempDir()
	dir := filepath.Join(root, "album")
	mkdirAll(t, dir)
	touchAll(t,
		filepath.Join(dir, "1.jpg"),
		filepath.Join(dir, "notes.txt"),
		filepath.Join(dir, "sub.srt"),
	)

	s := NewScanner()
	res, _ := s.Scan(ScanOptions{Root: root})
	if res.Albums[0].ImageCount != 1 {
		t.Errorf("expected 1 image, got %d", res.Albums[0].ImageCount)
	}
}

// 集合内的相册也应进入 smart grouping。
func TestGroupByTag_AcrossCollections(t *testing.T) {
	albums := []models.Album{
		{Name: "[A] 1", Author: "A", ImageCount: 5},
		{Name: "[A] 2", Author: "A", ImageCount: 3},
		{Name: "[A] 3", Author: "A", ImageCount: 1},
		{Name: "[B] 1", Author: "B", ImageCount: 2},
		{Name: "NoAuthor", Author: "", ImageCount: 1},
	}
	smart := GroupByTag(albums)
	if len(smart) != 1 || smart[0].Author != "A" {
		t.Fatalf("expected 1 smart collection for A, got %+v", smart)
	}
	if smart[0].AlbumCount != 3 {
		t.Errorf("smart album count: got %d", smart[0].AlbumCount)
	}
	// CoverImage 应该是图片数最多的相册的封面（这里就是第一项）
	if smart[0].CoverImage != albums[0].CoverImage {
		t.Errorf("smart cover should be from largest album")
	}
}

func TestGroupByTag_BelowThreshold(t *testing.T) {
	albums := []models.Album{
		{Name: "[A] 1", Author: "A", ImageCount: 1},
	}
	if got := GroupByTag(albums); len(got) != 0 {
		t.Errorf("expected no smart collection with 1 album, got %d", len(got))
	}
}

// 一本相册带多标签时应同时进入多个合集。
func TestGroupByTag_MultiTagAlbum(t *testing.T) {
	albums := []models.Album{
		{Name: "[A][B] 1", Author: "A", Tags: []string{"A", "B"}, ImageCount: 5},
		{Name: "[A] 2", Author: "A", Tags: []string{"A"}, ImageCount: 3},
		{Name: "[B] 3", Author: "B", Tags: []string{"B"}, ImageCount: 1},
	}
	smart := GroupByTag(albums)
	if len(smart) != 2 {
		t.Fatalf("expected 2 smart collections (A and B), got %d: %+v", len(smart), smart)
	}
	var aCount, bCount int
	for _, s := range smart {
		switch s.Tag {
		case "A":
			aCount = s.AlbumCount
		case "B":
			bCount = s.AlbumCount
		}
	}
	if aCount != 2 {
		t.Errorf("tag A should have 2 albums, got %d", aCount)
	}
	if bCount != 2 {
		t.Errorf("tag B should have 2 albums (第一本同时打 A+B 标签), got %d", bCount)
	}
}

// ExtractTags 行为：返回所有 [tag] 内容，按出现顺序，去空去重 trim。
func TestExtractTags(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want []string
	}{
		{"no brackets", "我的图集", nil},
		{"single", "[A] 我的图集", []string{"A"}},
		{"multi", "[A][B] 名字", []string{"A", "B"}},
		{"trimmed", "[ A ] 名字", []string{"A"}},
		{"skip empty", "[] [A] []", []string{"A"}},
		{"unclosed", "[A 名字", nil},
		{"comic-style author", "[作者 (A)] 标题", []string{"作者 (A)"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := ExtractTags(tc.in)
			if !reflect.DeepEqual(got, tc.want) {
				t.Errorf("ExtractTags(%q) = %v, want %v", tc.in, got, tc.want)
			}
		})
	}
}

// helper: 提取所有 album 的 Name。
func namesOf(albums []models.Album) []string {
	out := make([]string, 0, len(albums))
	for _, a := range albums {
		out = append(out, a.Name)
	}
	sort.Strings(out)
	return out
}
