package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func TestSmartAlbumGroupsStayInsideAlbumAndPageValidatedMembers(t *testing.T) {
	root := t.TempDir()
	albumPaths := []string{filepath.Join(root, "album-a"), filepath.Join(root, "album-b")}
	result := &models.ScanResult{Roots: []string{root}, AlbumCount: len(albumPaths)}
	for albumIndex, albumPath := range albumPaths {
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
		files := make([]string, 0, 3)
		for imageIndex := 0; imageIndex < 3; imageIndex++ {
			path := filepath.Join(albumPath, fmt.Sprintf("%d.jpg", imageIndex))
			if err := os.WriteFile(path, []byte(fmt.Sprintf("photo-%d-%d", albumIndex, imageIndex)), 0o600); err != nil {
				t.Fatal(err)
			}
			files = append(files, path)
		}
		result.Albums = append(result.Albums, models.Album{
			Type: "album", Name: filepath.Base(albumPath), Path: albumPath,
			SourceRoot: root, ImageFiles: files, ImageCount: len(files), CoverImage: files[0],
		})
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(result, []string{root})
	jobs := newTestAIJobService(
		t,
		filepath.Join(root, "state", "ai-jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog,
		MetadataAnalyzer{},
	)
	snapshot := catalog.Acquire()
	firstAlbumID := catalog.ExternalID(albumPaths[0], ResourceAlbum)
	secondAlbumID := catalog.ExternalID(albumPaths[1], ResourceAlbum)
	seedMetadataRecords(t, jobs, snapshot, firstAlbumID, "2025-06-18T10:00:00")
	seedMetadataRecords(t, jobs, snapshot, secondAlbumID, "2025-06-18T10:00:00")

	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Groups(context.Background(), firstAlbumID, SmartAlbumDimensionTime, false)
	if err != nil {
		t.Fatal(err)
	}
	second, err := service.Groups(context.Background(), secondAlbumID, SmartAlbumDimensionTime, false)
	if err != nil {
		t.Fatal(err)
	}
	if first.TotalPhotos != 3 || len(first.Groups) != 1 || first.Groups[0].PhotoCount != 3 {
		t.Fatalf("first album groups=%+v", first)
	}
	if second.TotalPhotos != 3 || len(second.Groups) != 1 || second.Groups[0].PhotoCount != 3 {
		t.Fatalf("second album groups=%+v", second)
	}
	encoded, err := json.Marshal(first)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte(`"members"`)) {
		t.Fatalf("group member IDs leaked in summary: %s", encoded)
	}

	page, err := service.PageGroupMedia(context.Background(), snapshot, firstAlbumID, SmartAlbumDimensionTime, first.Groups[0].ID, first.SnapshotKey, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Total != 3 || page.NextCursor == "" {
		t.Fatalf("first smart group page=%+v", page)
	}
	for _, item := range page.Items {
		ref, ok := snapshot.Lookup(item.ID)
		if !ok || filepath.Dir(ref.AbsolutePath) != albumPaths[0] {
			t.Fatalf("group page contains resource outside album A: %+v", item)
		}
	}

	customName := "家人出游"
	hidden := true
	updated, err := service.UpdateOverride(context.Background(), firstAlbumID, SmartAlbumDimensionTime, first.Groups[0].ID, &customName, &hidden)
	if err != nil {
		t.Fatal(err)
	}
	if len(updated.Groups) != 1 || updated.Groups[0].Name != customName || !updated.Groups[0].Hidden || !updated.Groups[0].CustomName {
		t.Fatalf("updated override=%+v", updated.Groups)
	}
	corrections := service.Corrections()
	if !validSmartAlbumCorrections(corrections) || len(corrections.Overrides) != 1 {
		t.Fatalf("corrections=%+v", corrections)
	}
}

func TestAlbumImageIDsReturnsOnlyImagesFromOneAlbum(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "mixed")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(albumPath, "image.jpg")
	videoPath := filepath.Join(albumPath, "video.mp4")
	for _, path := range []string{imagePath, videoPath} {
		if err := os.WriteFile(path, []byte("media"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "mixed", Path: albumPath, SourceRoot: root,
			ImageFiles: []string{imagePath}, VideoFiles: []string{videoPath}, ImageCount: 1, VideoCount: 1,
		}},
	}, []string{root})
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)
	ids, ok := catalog.Acquire().AlbumImageIDs(albumID)
	if !ok || len(ids) != 1 || ids[0] != catalog.ExternalID(imagePath, ResourceFile) {
		t.Fatalf("album images=%v ok=%t", ids, ok)
	}
}

func TestPeopleAlbumGroupsUsesOnlyCurrentAlbumFingerprints(t *testing.T) {
	faces := map[string]PersonFace{
		"f_first#0": {Key: "f_first#0", ResourceID: "f_first", FaceIndex: 0, PersonID: "p_abcdef", Size: 10, MTimeNs: 20, recordHash: "first"},
		"f_stale#0": {Key: "f_stale#0", ResourceID: "f_stale", FaceIndex: 0, PersonID: "p_abcdef", Size: 10, MTimeNs: 20, recordHash: "stale"},
		"f_other#0": {Key: "f_other#0", ResourceID: "f_other", FaceIndex: 0, PersonID: "p_abcdef", Size: 10, MTimeNs: 20, recordHash: "other"},
	}
	people := &PeopleService{
		faces: faces,
		facesByResource: map[string][]string{
			"f_first": []string{"f_first#0"},
			"f_stale": []string{"f_stale#0"},
			"f_other": []string{"f_other#0"},
		},
		manual: emptyPeopleManualState(),
	}
	groups := people.AlbumGroups(map[string]smartAlbumFileFingerprint{
		"f_first": {Size: 10, MTimeNs: 20},
		"f_stale": {Size: 99, MTimeNs: 20},
	})
	if len(groups) != 1 || groups[0].Group.PhotoCount != 1 || len(groups[0].ResourceIDs) != 1 || groups[0].ResourceIDs[0] != "f_first" {
		t.Fatalf("album people groups=%+v", groups)
	}
}

func TestAIJobSequenceScopesModulesAndTargetsToAlbum(t *testing.T) {
	root := t.TempDir()
	firstFiles := writeAIJobImages(t, root, 3)
	secondPath := filepath.Join(root, "second-album")
	if err := os.MkdirAll(secondPath, 0o755); err != nil {
		t.Fatal(err)
	}
	secondFiles := make([]string, 2)
	for index := range secondFiles {
		secondFiles[index] = filepath.Join(secondPath, fmt.Sprintf("%d.jpg", index))
		if err := os.WriteFile(secondFiles[index], []byte("other"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	firstPath := filepath.Join(root, "album")
	result := &models.ScanResult{
		Roots: []string{root}, AlbumCount: 2,
		Albums: []models.Album{
			{Type: "album", Name: "album", Path: firstPath, SourceRoot: root, ImageFiles: firstFiles, ImageCount: len(firstFiles)},
			{Type: "album", Name: "second-album", Path: secondPath, SourceRoot: root, ImageFiles: secondFiles, ImageCount: len(secondFiles)},
		},
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(result, []string{root})
	jobs := newTestAIJobService(
		t,
		filepath.Join(root, "state", "jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog,
		MetadataAnalyzer{},
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
		testJSONAnalyzer{module: AIJobTypeOCR, version: "ocr-test-v1"},
		testJSONAnalyzer{module: AIJobTypeFace, version: "face-test-v1"},
	)
	if _, err := jobs.SetPeopleEnabled(true); err != nil {
		t.Fatal(err)
	}
	firstAlbumID := catalog.ExternalID(firstPath, ResourceAlbum)
	queued, skipped, err := jobs.StartAll(AIJobModeFull, firstAlbumID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 || len(queued) != 3 {
		t.Fatalf("scoped sequence jobs=%+v skipped=%+v", queued, skipped)
	}
	wantTypes := []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeFace}
	for index, job := range queued {
		if job.Type != wantTypes[index] || job.AlbumID != firstAlbumID {
			t.Fatalf("sequence job[%d]=%+v", index, job)
		}
	}
	for _, job := range queued {
		completed := waitForAIJob(t, jobs, job.ID, AIJobStatusCompleted)
		if completed.Total != len(firstFiles) {
			t.Fatalf("job %s target count=%d, want %d", job.Type, completed.Total, len(firstFiles))
		}
	}
}

func seedMetadataRecords(t *testing.T, jobs *AIJobService, snapshot CatalogSnapshot, albumID, captured string) {
	t.Helper()
	ids, ok := snapshot.AlbumImageIDs(albumID)
	if !ok {
		t.Fatalf("album %s missing image IDs", albumID)
	}
	data, err := json.Marshal(ImageMetadata{DateTimeOriginal: captured})
	if err != nil {
		t.Fatal(err)
	}
	jobs.mu.Lock()
	defer jobs.mu.Unlock()
	for _, id := range ids {
		ref, exists := snapshot.Lookup(id)
		if !exists {
			t.Fatalf("resource %s missing", id)
		}
		info, err := os.Stat(ref.AbsolutePath)
		if err != nil {
			t.Fatal(err)
		}
		jobs.records[aiRecordKey(AIJobTypeMetadata, id)] = AIAnalysisRecord{
			Type: AIJobTypeMetadata, ResourceID: id, Size: info.Size(), MTimeNs: info.ModTime().UnixNano(),
			ModuleVersion: MetadataAnalyzer{}.Version(), Status: MetadataParseParsed, Data: data,
		}
	}
}

func TestSmartAlbumTimeSessionsUseRobustGapCut(t *testing.T) {
	base := time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC)
	photos := []smartCapture{
		{resourceID: "a", captured: base},
		{resourceID: "b", captured: base.Add(2 * time.Minute)},
		{resourceID: "c", captured: base.Add(5 * time.Minute)},
		{resourceID: "d", captured: base.Add(3 * time.Hour)},
		{resourceID: "e", captured: base.Add(3*time.Hour + 2*time.Minute)},
		{resourceID: "f", captured: base.Add(3*time.Hour + 5*time.Minute)},
	}
	segments := splitSmartCaptureSessions(photos)
	if len(segments) != 2 || len(segments[0]) != 3 || len(segments[1]) != 3 {
		t.Fatalf("sessions sizes=%v", []int{len(segments[0]), len(segments[1])})
	}
}

func TestSmartSceneClustersCanFormThreePhotoGroup(t *testing.T) {
	vectors := make([]smartSceneVector, 3)
	for index := range vectors {
		vector := make([]float32, AIEmbeddingDimension)
		vector[0] = 1
		vectors[index] = smartSceneVector{id: fmt.Sprintf("f_%d", index), vector: vector}
	}
	clusters := clusterSmartScenes(vectors)
	if len(clusters) != 1 || len(clusters[0].members) != 3 {
		t.Fatalf("clusters=%+v", clusters)
	}
	for index := range vectors {
		vector := make([]float32, AIEmbeddingDimension)
		vector[index] = 1
		vectors[index].vector = vector
	}
	if clusters := clusterSmartScenes(vectors); len(clusters) != 0 {
		t.Fatalf("unrelated orthogonal scene vectors were grouped: %+v", clusters)
	}
}

func TestSmartSceneClustersPreserveDenseSyntheticScenes(t *testing.T) {
	clusters := clusterSmartScenes(smartSceneBenchmarkVectors(1000))
	if len(clusters) != 50 {
		t.Fatalf("clusters=%d, want 50", len(clusters))
	}
	grouped := 0
	sizes := make(map[int]int)
	for _, cluster := range clusters {
		grouped += len(cluster.members)
		sizes[len(cluster.members)]++
	}
	t.Logf("grouped=%d cluster sizes=%v", grouped, sizes)
	if grouped < 990 {
		t.Fatalf("grouped=%d of 1000 synthetic scene photos, want at least 990", grouped)
	}
}

func BenchmarkSmartSceneClusters(b *testing.B) {
	for _, count := range []int{100, 1000, 5000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			vectors := smartSceneBenchmarkVectors(count)
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				_ = clusterSmartScenes(vectors)
			}
		})
	}
}

func smartSceneBenchmarkVectors(count int) []smartSceneVector {
	rng := rand.New(rand.NewSource(20261115))
	centerCount := min(50, max(1, count/5))
	centers := make([][]float32, centerCount)
	for index := range centers {
		center := make([]float32, AIEmbeddingDimension)
		for dimension := range center {
			center[dimension] = rng.Float32()*2 - 1
		}
		centers[index] = normalizeSmartVector(center)
	}
	result := make([]smartSceneVector, count)
	for index := range result {
		vector := append([]float32(nil), centers[index%centerCount]...)
		for dimension := range vector {
			vector[dimension] += (rng.Float32() - .5) * .02
		}
		result[index] = smartSceneVector{
			id: fmt.Sprintf("f_%06d", index), vector: normalizeSmartVector(vector),
		}
	}
	return result
}
