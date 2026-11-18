package services

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func TestSmartAlbumGroupsStayInsideAlbumAndPageValidatedMembers(t *testing.T) {
	root := t.TempDir()
	albumPaths := []string{filepath.Join(root, "album-a"), filepath.Join(root, "album-b")}
	result := &models.ScanResult{Roots: []string{root}, AlbumCount: len(albumPaths)}
	allFiles := make([]string, 0, 6)
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
			allFiles = append(allFiles, path)
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
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
	)
	snapshot := catalog.Acquire()
	firstAlbumID := catalog.ExternalID(albumPaths[0], ResourceAlbum)
	secondAlbumID := catalog.ExternalID(albumPaths[1], ResourceAlbum)
	seedMetadataRecords(t, jobs, snapshot, firstAlbumID, "2025-06-18T10:00:00")
	seedMetadataRecords(t, jobs, snapshot, secondAlbumID, "2025-06-18T10:00:00")
	vectors, err := OpenVectorIndex(filepath.Join(root, "derived", "vectors"), "embedding-test-v1")
	if err != nil {
		t.Fatal(err)
	}
	defer vectors.Close()
	vectorInputs := make([]VectorInput, 0, len(allFiles))
	for _, path := range allFiles {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		vector := make([]float32, AIEmbeddingDimension)
		vector[0] = 1
		vectorInputs = append(vectorInputs, VectorInput{
			ResourceID: catalog.ExternalID(path, ResourceFile), Size: info.Size(),
			MTimeNs: info.ModTime().UnixNano(), Vector: vector,
		})
	}
	if err := vectors.Commit(context.Background(), vectorInputs); err != nil {
		t.Fatal(err)
	}

	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, Vectors: vectors,
		ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	first, err := service.Groups(context.Background(), firstAlbumID, SmartAlbumDimensionTime, false)
	if err != nil {
		t.Fatal(err)
	}
	cached, err := service.Groups(context.Background(), firstAlbumID, SmartAlbumDimensionTime, false)
	if err != nil {
		t.Fatal(err)
	}
	if !cached.CacheHit {
		t.Fatal("repeated album grouping did not reuse its cache")
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
	scenes, err := service.Groups(context.Background(), firstAlbumID, SmartAlbumDimensionScene, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(scenes.Groups) != 1 || scenes.Groups[0].PhotoCount != 3 ||
		scenes.Coverage.Analyzed != 3 || scenes.Coverage.WithEvidence != 3 {
		t.Fatalf("scene groups did not reuse only this album's vectors: %+v", scenes)
	}
	directoryFirst, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionAll, "", 2, "")
	if err != nil {
		t.Fatal(err)
	}
	if directoryFirst.Total != 3 || len(directoryFirst.Items) != 2 || directoryFirst.NextCursor == "" {
		t.Fatalf("first smart album directory page=%+v", directoryFirst)
	}
	directorySecond, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionAll, directoryFirst.NextCursor, 1, "")
	if err != nil {
		t.Fatal(err)
	}
	if directorySecond.Total != 3 || len(directorySecond.Items) != 1 || directorySecond.NextCursor != "" {
		t.Fatalf("second smart album directory page=%+v", directorySecond)
	}
	if directoryFirst.Items[0].AlbumID != firstAlbumID || directorySecond.Items[0].AlbumID != secondAlbumID {
		t.Fatalf("directory pages did not retain source albums: first=%+v second=%+v", directoryFirst.Items, directorySecond.Items)
	}
	for _, dimension := range []string{SmartAlbumDimensionPlace, SmartAlbumDimensionPeople} {
		if _, err := os.Stat(service.cachePath(firstAlbumID, dimension)); !os.IsNotExist(err) {
			t.Fatalf("directory aggregation created an unrequested %s cache: %v", dimension, err)
		}
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
	visibleDirectory, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionTime, "", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if visibleDirectory.Total != 1 || visibleDirectory.Items[0].AlbumID != secondAlbumID {
		t.Fatalf("hidden smart group remained in directory: %+v", visibleDirectory)
	}
	corrections := service.Corrections()
	if !validSmartAlbumCorrections(corrections) || len(corrections.Overrides) != 1 {
		t.Fatalf("corrections=%+v", corrections)
	}

	reopened, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	rebuilt, err := reopened.Groups(context.Background(), firstAlbumID, SmartAlbumDimensionTime, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(rebuilt.Groups) != 1 || rebuilt.Groups[0].Name != customName || !rebuilt.Groups[0].Hidden {
		t.Fatalf("override did not survive restart and forced rebuild: %+v", rebuilt.Groups)
	}
	var sweepProgress []SmartAlbumSweepProgress
	if err := service.SweepSmartAlbums(context.Background(), false, func(progress SmartAlbumSweepProgress) {
		sweepProgress = append(sweepProgress, progress)
	}); err != nil {
		t.Fatalf("SweepSmartAlbums() error = %v", err)
	}
	for _, albumID := range []string{firstAlbumID, secondAlbumID} {
		for _, dimension := range []string{
			SmartAlbumDimensionTime,
			SmartAlbumDimensionPlace,
			SmartAlbumDimensionPeople,
			SmartAlbumDimensionScene,
			SmartAlbumDimensionRecommended,
		} {
			if _, err := os.Stat(service.cachePath(albumID, dimension)); err != nil {
				t.Fatalf("SweepSmartAlbums() did not prepare %s for %s: %v", dimension, albumID, err)
			}
		}
	}
	if len(sweepProgress) != 10 {
		t.Fatalf("sweep progress steps = %d, want 10", len(sweepProgress))
	}
	last := sweepProgress[len(sweepProgress)-1]
	if last.Albums != 2 || last.Total != 10 || last.Completed != 10 {
		t.Fatalf("sweep progress = %+v", last)
	}
	if last.Rebuilt == 0 && last.Reused == 0 {
		t.Fatalf("sweep did not count rebuilt or reused groups: %+v", last)
	}
}

// 目录里还没有任何分组时，接口要给空数组，不能给 null：前端把 items
// 当数组用，null 会被当成一条空分组记录，首页整页落进错误边界。
func TestSmartAlbumDirectoryEmptyPageSerializesAsEmptyArray(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album-a")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	imagePath := filepath.Join(albumPath, "0.jpg")
	if err := os.WriteFile(imagePath, []byte("photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album-a", Path: albumPath, SourceRoot: root,
			ImageFiles: []string{imagePath}, ImageCount: 1, CoverImage: imagePath,
		}},
	}, []string{root})
	jobs := newTestAIJobService(
		t,
		filepath.Join(root, "state", "ai-jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog,
		MetadataAnalyzer{},
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
	)
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs,
		ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	page, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionAll, "", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if page.Items == nil {
		t.Fatal("空目录的 items 不能是 nil")
	}
	if len(page.Items) != 0 || page.Total != 0 {
		t.Fatalf("empty smart album directory page=%+v", page)
	}
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(encoded), `"items":[]`) {
		t.Fatalf("empty directory page must serialize as an empty array: %s", encoded)
	}
}

func TestSmartAlbumDirectoryListsGeneratedGroups(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album-a")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	// 真实的 JPEG：封面要能读出来，媒体不能只靠扩展名。
	files := make([]string, 0, 3)
	for index, size := range [][2]int{{40, 20}, {20, 40}, {30, 30}} {
		path := filepath.Join(albumPath, fmt.Sprintf("%d.jpg", index))
		writeTestJPEG(t, path, size[0], size[1])
		files = append(files, path)
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album-a", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files), CoverImage: files[0],
		}},
	}, []string{root})
	jobs := newTestAIJobService(
		t,
		filepath.Join(root, "state", "ai-jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog,
		MetadataAnalyzer{},
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
	)
	snapshot := catalog.Acquire()
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)
	seedMetadataRecords(t, jobs, snapshot, albumID, "2025-06-18T10:00:00")
	dimensions, err := NewMediaDimensionService(filepath.Join(root, "derived", "media_dimensions.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, Dimensions: dimensions,
		ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	// 目录只汇总已经生成的分组：先算一次时间分组，再读目录。
	if _, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false); err != nil {
		t.Fatal(err)
	}
	page, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionTime, "", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 1 {
		t.Fatalf("directory items=%+v", page.Items)
	}
	group := page.Items[0].Group
	if group.CoverResourceID == "" {
		t.Fatalf("directory item must carry a cover: %+v", group)
	}
	// 封面尺寸不再随目录下发：封面统一裁成方形，前端不需要原始像素。
	encoded, err := json.Marshal(page)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(encoded), "coverWidth") {
		t.Fatalf("directory page must not carry the cover size: %s", encoded)
	}
}

// writeTestJPEG 写一张指定尺寸的真实 JPEG：尺寸探测读的是图片头。
func writeTestJPEG(t *testing.T, path string, width, height int) {
	t.Helper()
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	image := image.NewRGBA(image.Rect(0, 0, width, height))
	if err := jpeg.Encode(file, image, nil); err != nil {
		t.Fatal(err)
	}
}

// 目录里的相册块按「这本相册最新的一组」排：新的相册在前。
func TestSmartAlbumDirectoryOrdersAlbumsByRecency(t *testing.T) {
	root := t.TempDir()
	// 两本相册，拍摄时间一新一旧；相册名故意与时间相反，
	// 这样「按名字排」与「按新旧排」不会碰巧一致。
	albums := []struct {
		name     string
		captured string
	}{
		{name: "旧相册", captured: "2019-05-04T10:00:00"},
		{name: "新相册", captured: "2024-11-30T10:00:00"},
	}
	result := &models.ScanResult{Roots: []string{root}, AlbumCount: len(albums)}
	for _, album := range albums {
		albumPath := filepath.Join(root, album.name)
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
		files := make([]string, 0, 3)
		for imageIndex := 0; imageIndex < 3; imageIndex++ {
			path := filepath.Join(albumPath, fmt.Sprintf("%d.jpg", imageIndex))
			writeTestJPEG(t, path, 40, 20)
			files = append(files, path)
		}
		result.Albums = append(result.Albums, models.Album{
			Type: "album", Name: album.name, Path: albumPath,
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
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
	)
	snapshot := catalog.Acquire()
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs,
		ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, album := range albums {
		albumID := catalog.ExternalID(filepath.Join(root, album.name), ResourceAlbum)
		seedMetadataRecords(t, jobs, snapshot, albumID, album.captured)
		if _, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false); err != nil {
			t.Fatal(err)
		}
	}
	page, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionTime, "", 10, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 {
		t.Fatalf("directory items=%+v", page.Items)
	}
	if page.Items[0].AlbumName != "新相册" || page.Items[1].AlbumName != "旧相册" {
		t.Fatalf("albums are not ordered by recency: %+v", page.Items)
	}
}

// 精选推荐这一页排的是跨相册的主题，不按相册分块。
//
// 两本相册故意反着来：拍得新的那本照片少、推荐分低 —— 于是「按时间」
// 与「按张数」「按推荐分」排出的顺序各不相同，三种排法都验得到。
func TestSmartAlbumDirectorySortsRecommendationsAcrossAlbums(t *testing.T) {
	root := t.TempDir()
	albums := []struct {
		name     string
		captured string
		photos   int
		quality  float64
	}{
		{name: "新相册", captured: "2025-06-18T10:00:00", photos: 2, quality: 0.90},
		{name: "旧相册", captured: "2019-05-04T10:00:00", photos: 4, quality: 0.95},
	}
	result := &models.ScanResult{Roots: []string{root}, AlbumCount: len(albums)}
	for _, album := range albums {
		albumPath := filepath.Join(root, album.name)
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
		files := make([]string, 0, album.photos)
		for index := 0; index < album.photos; index++ {
			path := filepath.Join(albumPath, fmt.Sprintf("%d.jpg", index))
			writeTestJPEG(t, path, 40, 20)
			files = append(files, path)
		}
		result.Albums = append(result.Albums, models.Album{
			Type: "album", Name: album.name, Path: albumPath,
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
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
	)
	snapshot := catalog.Acquire()
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs,
		ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, album := range albums {
		albumID := catalog.ExternalID(filepath.Join(root, album.name), ResourceAlbum)
		seedMetadataRecords(t, jobs, snapshot, albumID, album.captured)
		members, ok := snapshot.AlbumImageIDs(albumID)
		if !ok || len(members) == 0 {
			t.Fatalf("album %s has no images", albumID)
		}
		seedRecommendedGroup(t, service, albumID, "sg_"+album.name, album.name, members, album.quality)
	}

	// 时间倒序：拍得新的那本在前。
	page, err := service.DirectoryPage(context.Background(), SmartAlbumDimensionRecommended, "", 10, SmartAlbumSortTime)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].AlbumName != "新相册" {
		t.Fatalf("recommendations are not ordered by capture time: %+v", page.Items)
	}
	// 张数倒序：照片多的那本在前。
	page, err = service.DirectoryPage(context.Background(), SmartAlbumDimensionRecommended, "", 10, SmartAlbumSortPhotos)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].AlbumName != "旧相册" {
		t.Fatalf("recommendations are not ordered by photo count: %+v", page.Items)
	}
	// 推荐分倒序：分高的那本在前。
	page, err = service.DirectoryPage(context.Background(), SmartAlbumDimensionRecommended, "", 10, SmartAlbumSortQuality)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].AlbumName != "旧相册" {
		t.Fatalf("recommendations are not ordered by quality: %+v", page.Items)
	}
	// 认不出来的排序参数按时间倒序处理，不报错。
	page, err = service.DirectoryPage(context.Background(), SmartAlbumDimensionRecommended, "", 10, "nonsense")
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Items) != 2 || page.Items[0].AlbumName != "新相册" {
		t.Fatalf("unknown sort did not fall back to capture time: %+v", page.Items)
	}
}

// seedRecommendedGroup 直接写一份精选推荐的缓存：目录只汇总已生成的
// 分组，这里要的是「排出来的顺序」，不必把推荐算法整套跑一遍。
func seedRecommendedGroup(
	t *testing.T,
	service *SmartAlbumService,
	albumID, groupID, name string,
	members []string,
	quality float64,
) {
	t.Helper()
	cache := smartAlbumCache{
		Version: smartAlbumCacheVersion, AlbumID: albumID,
		Dimension: SmartAlbumDimensionRecommended, Key: "seed-" + groupID,
		Groups: []smartAlbumCachedGroup{{
			ID: groupID, Dimension: SmartAlbumDimensionRecommended,
			Name: name, SuggestedName: name, PhotoCount: len(members),
			QualityScore: quality, Members: members,
			CoverResourceID: members[0],
		}},
	}
	data, err := json.Marshal(cache)
	if err != nil {
		t.Fatal(err)
	}
	path := service.cachePath(albumID, SmartAlbumDimensionRecommended)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		t.Fatal(err)
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
		testJSONAnalyzer{module: AIJobTypeSimilarity, version: "similarity-test-v1"},
	)
	if _, err := jobs.SetPeopleEnabled(true); err != nil {
		t.Fatal(err)
	}
	firstAlbumID := catalog.ExternalID(firstPath, ResourceAlbum)
	queued, skipped, err := jobs.StartAll(AIJobModeFull, firstAlbumID)
	if err != nil {
		t.Fatal(err)
	}
	if len(skipped) != 0 || len(queued) != 4 {
		t.Fatalf("scoped sequence jobs=%+v skipped=%+v", queued, skipped)
	}
	wantTypes := []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeFace, AIJobTypeSimilarity}
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

func TestSmartAlbumTimeSessionsLeaveSparseOutliersUngrouped(t *testing.T) {
	base := time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC)
	photos := []smartCapture{
		{resourceID: "a", captured: base},
		{resourceID: "b", captured: base.Add(2 * time.Minute)},
		{resourceID: "c", captured: base.Add(5 * time.Minute)},
		{resourceID: "d", captured: base.Add(12 * time.Hour)},
		{resourceID: "e", captured: base.Add(12*time.Hour + 2*time.Minute)},
	}
	segments := splitSmartCaptureSessions(photos)
	if len(segments) != 2 || len(segments[0]) != 3 || len(segments[1]) != 2 {
		t.Fatalf("sparse session was merged across a long gap: sizes=%v", []int{len(segments[0]), len(segments[1])})
	}
}

func TestSmartAlbumGroupsDegradeWithoutAnalysisAndInvalidateChangedFiles(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := make([]string, 3)
	for index := range files {
		files[index] = filepath.Join(albumPath, fmt.Sprintf("%d.jpg", index))
		if err := os.WriteFile(files[index], []byte("photo"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})
	jobs := newTestAIJobService(
		t,
		filepath.Join(root, "state", "ai-jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog,
		MetadataAnalyzer{},
	)
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:  filepath.Join(root, "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, ValidatePath: aiTestPathValidator(t, root),
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, dimension := range []string{
		SmartAlbumDimensionTime, SmartAlbumDimensionPlace,
		SmartAlbumDimensionPeople, SmartAlbumDimensionScene,
	} {
		summary, err := service.Groups(context.Background(), albumID, dimension, false)
		if err != nil {
			t.Fatalf("dimension %s without records: %v", dimension, err)
		}
		if len(summary.Groups) != 0 || summary.UngroupedPhotos != len(files) || summary.Coverage.Missing != len(files) {
			t.Fatalf("dimension %s did not degrade to ungrouped photos: %+v", dimension, summary)
		}
	}
	cached, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false)
	if err != nil || !cached.CacheHit {
		t.Fatalf("empty result cache was not reused: cacheHit=%t err=%v", cached.CacheHit, err)
	}
	seedMetadataRecords(t, jobs, catalog.Acquire(), albumID, "2025-06-18T10:00:00")
	seeded, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false)
	if err != nil || seeded.CacheHit || len(seeded.Groups) != 1 {
		t.Fatalf("new metadata did not rebuild a time group: summary=%+v err=%v", seeded, err)
	}
	if err := os.WriteFile(files[0], []byte("changed photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	changed, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false)
	if err != nil || changed.CacheHit || changed.AvailablePhotos != len(files) || len(changed.Groups) != 0 || changed.Coverage.Analyzed != len(files)-1 {
		t.Fatalf("changed file did not invalidate cache: summary=%+v err=%v", changed, err)
	}
}

func TestSmartAlbumPlaceGroupsNearbyGPSWithoutReturningCoordinates(t *testing.T) {
	drafts := make(map[string]*smartAlbumDraft)
	media := make([]smartAlbumMedia, 3)
	records := make(map[string]AIAnalysisRecord, len(media))
	for index := range media {
		id := fmt.Sprintf("f_%d", index)
		media[index].id = id
		data, err := json.Marshal(ImageMetadata{GPS: &GPSMetadata{Latitude: 40.7128, Longitude: -74.0060}})
		if err != nil {
			t.Fatal(err)
		}
		records[id] = AIAnalysisRecord{Status: MetadataParseParsed, Data: data}
	}
	addPlaceDrafts(context.Background(), drafts, media, records)
	if len(drafts) != 1 {
		t.Fatalf("nearby GPS photos formed %d drafts, want one", len(drafts))
	}
	for key, draft := range drafts {
		if !strings.HasPrefix(key, "place:") || len(draft.members) != 3 || strings.Contains(draft.name, "40.7128") || strings.Contains(draft.name, "-74.0060") {
			t.Fatalf("unexpected location draft: key=%q draft=%+v", key, draft)
		}
	}
}

func TestSmartAlbumPlaceGroupsChooseCoarserNearbyAdminLevel(t *testing.T) {
	coordinates := [][2]float64{
		{30.259242, 120.130396},
		{30.260000, 120.131000},
		{30.258500, 120.129500},
		{30.186000, 120.266000},
		{30.187000, 120.265000},
		{30.185000, 120.267000},
	}
	media := make([]smartAlbumMedia, len(coordinates))
	records := make(map[string]AIAnalysisRecord, len(coordinates))
	for index, coordinate := range coordinates {
		id := fmt.Sprintf("f_%d", index)
		media[index].id = id
		data, err := json.Marshal(ImageMetadata{GPS: &GPSMetadata{
			Latitude: coordinate[0], Longitude: coordinate[1], MapDatum: "GCJ-02",
		}})
		if err != nil {
			t.Fatal(err)
		}
		records[id] = AIAnalysisRecord{Status: MetadataParseParsed, Data: data}
	}
	drafts := make(map[string]*smartAlbumDraft)
	addPlaceDrafts(context.Background(), drafts, media, records)
	if len(drafts) != 1 {
		t.Fatalf("nearby district evidence made %d place groups, want one city-level group", len(drafts))
	}
	for key, draft := range drafts {
		if len(draft.members) != len(coordinates) || !strings.Contains(draft.name, "杭州市") ||
			strings.Contains(draft.name, "西湖区") || strings.Contains(draft.name, "萧山区") ||
			!strings.HasPrefix(key, "place:admin:") {
			t.Fatalf("place group did not choose a useful shared level: key=%q draft=%+v", key, draft)
		}
	}
}

func TestSmartSceneClustersCanFormThreePhotoGroup(t *testing.T) {
	vectors := make([]smartSceneVector, 3)
	for index := range vectors {
		vector := make([]float32, AIEmbeddingDimension)
		vector[0] = 1
		vectors[index] = smartSceneVector{id: fmt.Sprintf("f_%d", index), vector: vector}
	}
	clusters, err := clusterSmartScenes(context.Background(), vectors)
	if err != nil {
		t.Fatal(err)
	}
	if len(clusters) != 1 || len(clusters[0].members) != 3 {
		t.Fatalf("clusters=%+v", clusters)
	}
	for index := range vectors {
		vector := make([]float32, AIEmbeddingDimension)
		vector[index] = 1
		vectors[index].vector = vector
	}
	clusters, err = clusterSmartScenes(context.Background(), vectors)
	if err != nil {
		t.Fatal(err)
	}
	if len(clusters) != 0 {
		t.Fatalf("unrelated orthogonal scene vectors were grouped: %+v", clusters)
	}
}

func TestSmartSceneClustersPreserveDenseSyntheticScenes(t *testing.T) {
	clusters, err := clusterSmartScenes(context.Background(), smartSceneBenchmarkVectors(1000))
	if err != nil {
		t.Fatal(err)
	}
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
				_, _ = clusterSmartScenes(context.Background(), vectors)
			}
		})
	}
}

func BenchmarkSmartAlbumSceneGroups(b *testing.B) {
	for _, count := range []int{100, 1000, 5000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			service, albumID := newSmartSceneBenchmarkService(b, count)
			b.ReportAllocs()
			b.ReportMetric(float64(count), "photos/op")
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				if _, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionScene, true); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}

func newSmartSceneBenchmarkService(b testing.TB, count int) (*SmartAlbumService, string) {
	b.Helper()
	root := filepath.Join(b.TempDir(), "media")
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		b.Fatal(err)
	}
	files := make([]string, count)
	for index := range files {
		files[index] = filepath.Join(albumPath, fmt.Sprintf("photo-%06d.jpg", index))
		if err := os.WriteFile(files[index], []byte("photo"), 0o600); err != nil {
			b.Fatal(err)
		}
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})

	validatePath := func(path string) (string, error) { return filepath.Clean(path), nil }
	jobs, err := NewAIJobService(AIJobServiceOptions{
		StatePath:   filepath.Join(b.TempDir(), "state", "jobs.json"),
		MetadataDir: filepath.Join(b.TempDir(), "derived", "metadata"),
		Catalog:     catalog, ValidatePath: validatePath, WorkerCount: 1,
		Analyzers: []AIAnalyzer{MetadataAnalyzer{}},
	})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = jobs.Shutdown(context.Background()) })

	vectors, err := OpenVectorIndex(filepath.Join(b.TempDir(), "derived", "vectors"), "smart-scene-benchmark-v1")
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(vectors.Close)
	items := smartSceneBenchmarkVectors(count)
	inputs := make([]VectorInput, len(files))
	for index, path := range files {
		info, err := os.Stat(path)
		if err != nil {
			b.Fatal(err)
		}
		inputs[index] = VectorInput{
			ResourceID: catalog.ExternalID(path, ResourceFile), Size: info.Size(),
			MTimeNs: info.ModTime().UnixNano(), Vector: items[index].vector,
		}
	}
	if err := vectors.Commit(context.Background(), inputs); err != nil {
		b.Fatal(err)
	}
	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath: filepath.Join(b.TempDir(), "state", "smart-albums.json"),
		CacheDir:  filepath.Join(b.TempDir(), "derived", "smart-albums"),
		Catalog:   catalog, Jobs: jobs, Vectors: vectors, ValidatePath: validatePath,
	})
	if err != nil {
		b.Fatal(err)
	}
	return service, catalog.ExternalID(albumPath, ResourceAlbum)
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
