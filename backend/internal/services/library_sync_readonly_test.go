package services

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// TestLibrarySync_DoesNotTouchOriginalMedia 验证自动同步不会改动原始媒体。
//
// 图库是只读视图：扫描、监听、分析都只读媒体文件。写回原始照片
// （哪怕只是改个时间戳）都会破坏用户的资料。
func TestLibrarySync_DoesNotTouchOriginalMedia(t *testing.T) {
	sync, catalog, analyzer, root := newAnalysisHarness(t)
	album := filepath.Join(root, "album")
	mkdirAll(t, album)
	existing := filepath.Join(album, "a.jpg")
	touchAll(t, existing)
	before, err := os.Stat(existing)
	if err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	if err := sync.Start(ctx); err != nil {
		t.Fatalf("start library sync: %v", err)
	}
	defer sync.Shutdown()
	if _, err := sync.Update(ctx, LibrarySyncSettings{Enabled: true, AutoAnalyze: true}); err != nil {
		t.Fatalf("update library sync: %v", err)
	}

	scanner := NewScanner()
	initial, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		t.Fatalf("scan failed: %v", err)
	}
	catalog.Publish(initial, []string{root})

	// 新增一张照片，触发一轮完整的「发现变化 → 更新图库 → 自动分析」。
	added := filepath.Join(album, "b.jpg")
	touchAll(t, added)
	waitForAnalyzed(t, analyzer, 1)

	after, err := os.Stat(existing)
	if err != nil {
		t.Fatal(err)
	}
	if !after.ModTime().Equal(before.ModTime()) || after.Size() != before.Size() {
		t.Fatalf("原始媒体被改动了：改动前 %v，改动后 %v", before, after)
	}
	content, err := os.ReadFile(existing)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "fake" {
		t.Fatalf("原始媒体内容被改动了：%q", string(content))
	}
}

// TestSimilarityBackupRestoresManualDecisions 验证备份与恢复会带上
// 相似照片的人工决定，重启后决定仍在。
func TestSimilarityBackupRestoresManualDecisions(t *testing.T) {
	pattern := similarityTestJPEG(t, similarityTestPattern(320, 240, 0), 92)
	_, catalog, jobs, similarity := similarityServiceFixture(t, map[string][]byte{
		"a.jpg": pattern,
		"b.jpg": pattern,
	})
	runSimilarityAnalysis(t, jobs)
	if _, err := similarity.RebuildNow(); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	group := findExactGroup(t, similarity)
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed); err != nil {
		t.Fatalf("set reviewed: %v", err)
	}

	layout, err := EnsureCacheLayout(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	backupService := &StateBackupService{
		Prefs:      store.NewPrefsStore(layout.PreferencesPath),
		Activities: store.NewActivityStore(layout.ActivityPath),
		Covers:     NewCoverOverrideStore(layout.CoverOverridesPath),
		Picks:      store.NewPickStore(layout.PicksPath),
		Similarity: similarity,
		Catalog:    catalog,
		BackupDir:  StateBackupDirectory(layout),
		ValidatePath: func(path string) (string, error) {
			_, err := os.Stat(path)
			return path, err
		},
	}
	backup, err := backupService.Export()
	if err != nil {
		t.Fatalf("export: %v", err)
	}
	if backup.Similarity == nil || len(backup.Similarity.Reviewed) != 1 {
		t.Fatalf("备份里没有相似照片的人工决定：%+v", backup.Similarity)
	}

	// 清掉决定，再从备份恢复。
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusPending); err != nil {
		t.Fatalf("clear reviewed: %v", err)
	}
	preview, err := backupService.Preview(backup)
	if err != nil {
		t.Fatalf("preview: %v", err)
	}
	result, err := backupService.Restore(backup, []string{"similarity"}, preview.Versions, preview.LibraryRevision)
	if err != nil || result.Failed != "" {
		t.Fatalf("restore: %+v %v", result, err)
	}
	restored := similarity.Groups(SimilarityGroupFilter{Kind: string(SimilarityGroupKindExact)})
	if restored.Total == 0 {
		t.Fatal("恢复之后分组不见了")
	}
	for _, item := range restored.Groups {
		if item.Status != SimilarityStatusReviewed {
			t.Fatalf("恢复之后已看过的状态没回来：%q", item.Status)
		}
	}
}

// TestSimilarityStateSurvivesRestart 验证人工决定跨重启保留。
func TestSimilarityStateSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "photos")
	mkdirAll(t, albumPath)
	pattern := similarityTestJPEG(t, similarityTestPattern(320, 240, 0), 92)
	files := map[string][]byte{"a.jpg": pattern, "b.jpg": pattern}
	paths := make([]string, 0, len(files))
	for name, data := range files {
		path := filepath.Join(albumPath, name)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}

	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: albumPath, SourceRoot: root,
			ImageFiles: paths, ImageCount: len(paths),
		}},
	}, []string{root})

	jobs, err := NewAIJobService(AIJobServiceOptions{
		StatePath:   filepath.Join(t.TempDir(), "state", "jobs.json"),
		MetadataDir: filepath.Join(t.TempDir(), "derived", "metadata"),
		Catalog:     catalog,
		ValidatePath: func(path string) (string, error) {
			return path, nil
		},
		Analyzers: []AIAnalyzer{MetadataAnalyzer{}, SimilarityAnalyzer{}},
	})
	if err != nil {
		t.Fatalf("create ai job service: %v", err)
	}
	defer jobs.Shutdown(context.Background())

	cacheDir := t.TempDir()
	statePath := filepath.Join(cacheDir, "state", "similarity.json")
	derivedPath := filepath.Join(cacheDir, "derived", "similarity", "groups.json")
	similarity, err := OpenSimilarityService(SimilarityServiceOptions{
		StatePath:   statePath,
		DerivedPath: derivedPath,
		Catalog:     catalog,
		Jobs:        jobs,
	})
	if err != nil {
		t.Fatalf("open similarity service: %v", err)
	}
	runSimilarityAnalysis(t, jobs)
	if _, err := similarity.RebuildNow(); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	group := findExactGroup(t, similarity)
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed); err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	similarity.Close()

	// 重启：决定必须还在。
	reopened, err := OpenSimilarityService(SimilarityServiceOptions{
		StatePath:   statePath,
		DerivedPath: derivedPath,
		Catalog:     catalog,
		Jobs:        jobs,
	})
	if err != nil {
		t.Fatalf("reopen similarity service: %v", err)
	}
	defer reopened.Close()
	restored := reopened.Groups(SimilarityGroupFilter{Kind: string(SimilarityGroupKindExact)})
	if restored.Total == 0 {
		t.Fatal("重启之后分组不见了")
	}
	for _, item := range restored.Groups {
		if item.Status != SimilarityStatusReviewed {
			t.Fatalf("重启之后已看过的状态丢了：%q", item.Status)
		}
	}
}
