package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// 相册照片墙的筛选在大库上的代价。
//
// 筛选作用在整本相册的数据上，因此代价必须与相册里的张数成正比，
// 而不是与前端已加载的那几页成正比。这个基准量的是三种典型相册：
// 小相册（100 张）、中相册（1000 张）与大相册（5000 张）。
//
// 素材是合成的：只建目录索引与分析记录，不真的落几千张图 ——
// 基准要量的是筛选本身的算法代价，不是磁盘。
func benchmarkAlbumFilter(b *testing.B, count int) {
	b.Helper()
	root := b.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		b.Fatal(err)
	}
	files := make([]string, 0, count)
	for index := 0; index < count; index++ {
		files = append(files, filepath.Join(albumPath, fmt.Sprintf("%05d.jpg", index)))
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)
	snapshot := catalog.Acquire()

	jobs := newBenchmarkAIJobService(b,
		filepath.Join(root, "state", "jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog, MetadataAnalyzer{})

	// 每张照片都有拍摄时间：一半在 2024 年，一半没有可信时间。
	ids, ok := snapshot.AlbumImageIDs(albumID)
	if !ok {
		b.Fatal("album has no images")
	}
	data, err := json.Marshal(ImageMetadata{Status: MetadataParseParsed, DateTimeOriginal: "2024-06-01T10:00:00"})
	if err != nil {
		b.Fatal(err)
	}
	jobs.mu.Lock()
	for index, id := range ids {
		if index%2 == 1 {
			continue
		}
		jobs.records[aiRecordKey(AIJobTypeMetadata, id)] = AIAnalysisRecord{
			Type: AIJobTypeMetadata, ResourceID: id,
			ModuleVersion: MetadataAnalyzer{}.Version(), Status: MetadataParseParsed, Data: data,
		}
	}
	jobs.mu.Unlock()

	engine := NewAlbumFilterEngine(catalog, jobs, nil, nil, nil)
	query := AlbumFilterQuery{From: "2024-01", To: "2024-12"}
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		page, err := engine.Page(snapshot, albumID, query, "", 200)
		if err != nil {
			b.Fatal(err)
		}
		if page.Total == 0 {
			b.Fatal("filtered page is empty")
		}
	}
}

func BenchmarkAlbumFilterPage100(b *testing.B)  { benchmarkAlbumFilter(b, 100) }
func BenchmarkAlbumFilterPage1000(b *testing.B) { benchmarkAlbumFilter(b, 1000) }
func BenchmarkAlbumFilterPage5000(b *testing.B) { benchmarkAlbumFilter(b, 5000) }

// newBenchmarkAIJobService 给基准建一个分析任务服务。
//
// 既有辅助只接受 *testing.T；基准要的是同样的装配。
func newBenchmarkAIJobService(b *testing.B, statePath, metadataDir string, catalog *ResourceCatalog, analyzers ...AIAnalyzer) *AIJobService {
	b.Helper()
	service, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    statePath,
		MetadataDir:  metadataDir,
		Catalog:      catalog,
		ValidatePath: func(path string) (string, error) { return path, nil },
		Analyzers:    analyzers,
	})
	if err != nil {
		b.Fatalf("NewAIJobService() error = %v", err)
	}
	return service
}
