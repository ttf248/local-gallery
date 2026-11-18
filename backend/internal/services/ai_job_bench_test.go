package services

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// BenchmarkAIJobStatePersist 记录任务状态落盘的成本。
//
// 每次状态变化都要重写整份状态文件：任务列表、检查点与每日计划都在里面。
// 任务一多、失败项一多，这份文件就是「每提交一个批次就重写一遍历史」
// 的来源，因此单独量一次。
func BenchmarkAIJobStatePersist(b *testing.B) {
	root := b.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		b.Fatal(err)
	}
	files := make([]string, 0, 20)
	for index := 0; index < 20; index++ {
		path := filepath.Join(albumPath, fmt.Sprintf("%04d.jpg", index))
		if err := os.WriteFile(path, testExifJPEG(), 0o600); err != nil {
			b.Fatal(err)
		}
		files = append(files, path)
	}
	catalog := aiJobCatalog(root, files)
	service, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    filepath.Join(root, "state", "ai_jobs.json"),
		MetadataDir:  filepath.Join(root, "derived", "metadata"),
		Catalog:      catalog,
		ValidatePath: aiBenchmarkPathValidator(root),
		Analyzers:    []AIAnalyzer{MetadataAnalyzer{}},
		WorkerCount:  2,
	})
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = service.Shutdown(context.Background()) }()

	// 造一批历史任务：状态文件的大小主要由它们决定。
	service.mu.Lock()
	for index := 0; index < 50; index++ {
		job := service.newJobLocked(AIJobTypeMetadata, AIJobModeIncremental)
		job.Status = AIJobStatusCompleted
		job.Total, job.Processed, job.Done = 200, 200, 200
		job.Errors = make([]AIJobError, 0, 20)
		for errorIndex := 0; errorIndex < 20; errorIndex++ {
			job.Errors = append(job.Errors, AIJobError{
				ResourceID: fmt.Sprintf("f_%03d", errorIndex),
				Code:       "source_unavailable",
				Message:    "无法读取图片或路径校验失败",
				At:         time.Now(),
			})
		}
		service.jobs[job.ID] = &job
		service.order = append(service.order, job.ID)
	}
	service.mu.Unlock()

	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		service.mu.Lock()
		err := service.persistLocked()
		service.mu.Unlock()
		if err != nil {
			b.Fatal(err)
		}
	}
}

// BenchmarkSmartAlbumGroupsCacheHit 记录智能相册命中缓存的读取成本。
//
// 命中路径仍然要走一遍文件指纹采集与缓存键计算：分析指纹要按当前
// 分析结果重算，媒体指纹要逐张 stat。这条路径在目录页翻页时会被反复
// 走到，因此单独量一次。
func BenchmarkSmartAlbumGroupsCacheHit(b *testing.B) {
	root := b.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		b.Fatal(err)
	}
	files := make([]string, 0, 100)
	for index := 0; index < 100; index++ {
		path := filepath.Join(albumPath, fmt.Sprintf("%04d.jpg", index))
		if err := os.WriteFile(path, testExifJPEG(), 0o600); err != nil {
			b.Fatal(err)
		}
		files = append(files, path)
	}
	result := &models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files), CoverImage: files[0],
		}},
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(result, []string{root})
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)

	service, err := OpenSmartAlbumService(SmartAlbumServiceOptions{
		StatePath:    filepath.Join(root, "state", "smart-albums.json"),
		CacheDir:     filepath.Join(root, "derived", "smart-albums"),
		Catalog:      catalog,
		Jobs:         benchmarkAIJobService(b, root, catalog),
		ValidatePath: aiBenchmarkPathValidator(root),
	})
	if err != nil {
		b.Fatal(err)
	}
	if _, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false); err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		summary, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionTime, false)
		if err != nil {
			b.Fatal(err)
		}
		if !summary.CacheHit {
			b.Fatal("expected the derived cache to be reused")
		}
	}
}

// benchmarkAIJobService 造一个只读的任务服务，供智能相册基准使用。
func benchmarkAIJobService(b *testing.B, root string, catalog *ResourceCatalog) *AIJobService {
	b.Helper()
	service, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    filepath.Join(root, "state", "ai_jobs.json"),
		MetadataDir:  filepath.Join(root, "derived", "metadata"),
		Catalog:      catalog,
		ValidatePath: aiBenchmarkPathValidator(root),
		Analyzers:    []AIAnalyzer{MetadataAnalyzer{}},
		WorkerCount:  2,
	})
	if err != nil {
		b.Fatal(err)
	}
	b.Cleanup(func() { _ = service.Shutdown(context.Background()) })
	return service
}

// BenchmarkIncrementalScanDelta 记录大批文件变化后的增量更新成本。
//
// 增量更新的意义在于只重读变动的目录：文件一多，全量重扫就是主要开销。
// 这里量的是「一个目录里加几张照片」之后重建图库要多久。
func BenchmarkIncrementalScanDelta(b *testing.B) {
	root := b.TempDir()
	album := filepath.Join(root, "album")
	if err := os.MkdirAll(album, 0o755); err != nil {
		b.Fatal(err)
	}
	for index := 0; index < 200; index++ {
		path := filepath.Join(album, fmt.Sprintf("%04d.jpg", index))
		if err := os.WriteFile(path, []byte("photo"), 0o600); err != nil {
			b.Fatal(err)
		}
	}
	scanner := NewScanner()
	previous, err := scanner.Scan(ScanOptions{Roots: []string{root}})
	if err != nil {
		b.Fatal(err)
	}
	added := filepath.Join(album, "added.jpg")
	if err := os.WriteFile(added, []byte("added"), 0o600); err != nil {
		b.Fatal(err)
	}
	changes := newSyncChangeSet()
	changes.Files[added] = struct{}{}
	changes.Dirs[album] = struct{}{}

	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		if _, err := NewIncrementalEngine().Apply(previous, changes, ScanOptions{Roots: []string{root}}); err != nil {
			b.Fatal(err)
		}
	}
}
