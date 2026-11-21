package services

import (
	"context"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// similarityServiceFixture 搭一套相似照片整理的真实环境：
// 真图片、真特征分析、真重建。
func similarityServiceFixture(t *testing.T, files map[string][]byte) (string, *ResourceCatalog, *AIJobService, *SimilarityService) {
	t.Helper()
	root := t.TempDir()
	albumPath := filepath.Join(root, "photos")
	mkdirAll(t, albumPath)
	paths := make([]string, 0, len(files))
	for name, data := range files {
		path := filepath.Join(albumPath, name)
		if err := os.WriteFile(path, data, 0o644); err != nil {
			t.Fatal(err)
		}
		paths = append(paths, path)
	}
	sort.Strings(paths)

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
	t.Cleanup(func() { _ = jobs.Shutdown(context.Background()) })

	similarity, err := OpenSimilarityService(SimilarityServiceOptions{
		StatePath:   filepath.Join(t.TempDir(), "state", "similarity.json"),
		DerivedPath: filepath.Join(t.TempDir(), "derived", "similarity", "groups.json"),
		Catalog:     catalog,
		Jobs:        jobs,
	})
	if err != nil {
		t.Fatalf("open similarity service: %v", err)
	}
	t.Cleanup(similarity.Close)
	return albumPath, catalog, jobs, similarity
}

// runSimilarityAnalysis 跑一次相似照片特征分析并等它结束。
func runSimilarityAnalysis(t *testing.T, jobs *AIJobService) {
	t.Helper()
	job, _, err := jobs.Start(AIJobTypeSimilarity, AIJobModeFull)
	if err != nil {
		t.Fatalf("start similarity analysis: %v", err)
	}
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		current, exists := jobs.Get(job.ID)
		if !exists {
			t.Fatal("analysis job disappeared")
		}
		switch current.Status {
		case AIJobStatusCompleted:
			return
		case AIJobStatusFailed, AIJobStatusCancelled:
			t.Fatalf("analysis job ended as %s", current.Status)
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("analysis job did not finish")
}

// findExactGroup 找出完全重复的那一组。
func findExactGroup(t *testing.T, similarity *SimilarityService) SimilarityGroup {
	t.Helper()
	page := similarity.Groups(SimilarityGroupFilter{Kind: string(SimilarityGroupKindExact)})
	if page.Total == 0 {
		t.Fatal("没有算出完全重复的分组")
	}
	for _, group := range page.Groups {
		if group.Kind == string(SimilarityGroupKindExact) {
			return group
		}
	}
	t.Fatal("没有找到完全重复的分组")
	return SimilarityGroup{}
}

// TestSimilarityServiceDecisionsSurviveMemberChanges 验证组内照片变化后
// 人工决定仍然对得上。
//
// 组里的照片被删掉一张（删掉的正好是锚点）时，组的标识会变。
// 人工决定必须跟着照片走：已看过、忽略与手动指定的代表都要还在。
func TestSimilarityServiceDecisionsSurviveMemberChanges(t *testing.T) {
	pattern := similarityTestJPEG(t, similarityTestPattern(320, 240, 0), 92)
	other := similarityTestJPEG(t, similarityTestPattern(320, 240, 5), 92)
	albumPath, catalog, jobs, similarity := similarityServiceFixture(t, map[string][]byte{
		"a.jpg": pattern,
		"b.jpg": pattern,
		"c.jpg": pattern,
		"d.jpg": other,
	})

	runSimilarityAnalysis(t, jobs)
	if _, err := similarity.RebuildNow(); err != nil {
		t.Fatalf("rebuild: %v", err)
	}
	group := findExactGroup(t, similarity)
	if len(group.Members) != 3 {
		t.Fatalf("完全重复组应有 3 个成员，实际 %d", len(group.Members))
	}

	// 人工决定：已看过 + 手动指定代表。
	representative := ""
	for _, member := range group.Members {
		if member.ResourceID != group.Recommended {
			representative = member.ResourceID
			break
		}
	}
	if representative == "" {
		t.Fatal("没有可用于手动指定的代表照片")
	}
	if _, err := similarity.SetStatus(group.ID, SimilarityStatusReviewed); err != nil {
		t.Fatalf("set reviewed: %v", err)
	}
	if err := similarity.SetRepresentative(group.ID, representative); err != nil {
		t.Fatalf("set representative: %v", err)
	}

	// 删掉组里最小标识的那张照片：组还在，标识会变。
	members := append([]string(nil), group.ResourceIDs...)
	sort.Strings(members)
	anchor := members[0]
	anchorPath := ""
	for _, id := range group.Members {
		if id.ResourceID == anchor {
			ref, exists := catalog.Acquire().Lookup(id.ResourceID)
			if exists {
				anchorPath = ref.AbsolutePath
			}
		}
	}
	if anchorPath == "" {
		t.Fatal("找不到锚点照片的路径")
	}
	if err := os.Remove(anchorPath); err != nil {
		t.Fatal(err)
	}
	remaining := make([]string, 0, len(group.Members)-1)
	for _, member := range group.Members {
		if member.ResourceID != anchor {
			ref, exists := catalog.Acquire().Lookup(member.ResourceID)
			if exists {
				remaining = append(remaining, ref.AbsolutePath)
			}
		}
	}
	catalog.Publish(&models.ScanResult{
		Roots: []string{filepath.Dir(albumPath)}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: albumPath, SourceRoot: filepath.Dir(albumPath),
			ImageFiles: remaining, ImageCount: len(remaining),
		}},
	}, []string{filepath.Dir(albumPath)})

	if _, err := similarity.RebuildNow(); err != nil {
		t.Fatalf("rebuild after member change: %v", err)
	}
	after := findExactGroup(t, similarity)
	if after.Status != SimilarityStatusReviewed {
		t.Fatalf("删掉一张照片后已看过的状态应保持，实际 %q", after.Status)
	}
	if after.Representative != representative {
		t.Fatalf("删掉一张照片后手动指定的代表应保持：期望 %q，实际 %q", representative, after.Representative)
	}
	if !after.RepresentativeIsManual {
		t.Fatal("手动指定的代表应仍被标记为手动")
	}
}
