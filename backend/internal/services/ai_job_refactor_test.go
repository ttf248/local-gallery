package services

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync/atomic"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/middleware"
)

// gpuFailingAnalyzer 在逐张推理路径上返回 GPU 错误。
type gpuFailingAnalyzer struct {
	module string
}

func (a gpuFailingAnalyzer) Type() string  { return a.module }
func (gpuFailingAnalyzer) Version() string { return "gpu-failing-test-v1" }
func (gpuFailingAnalyzer) Analyze(ctx context.Context, _ io.ReadSeeker) (AIAnalysisOutput, error) {
	if err := ctx.Err(); err != nil {
		return AIAnalysisOutput{}, err
	}
	return AIAnalysisOutput{}, ErrAIGPUUnavailable
}

// TestAIJobPerImageFailureKeepsStableErrorCode 守住逐张推理路径的错误码。
//
// 批量路径早就把 GPU 不可用分成 gpu_unavailable 与 gpu_inference_failed，
// 逐张路径却一律报 analysis_failed：一次显卡掉线在任务记录里和
// 「这张图读不出来」长得一模一样，用户没法据此判断该不该重试。
func TestAIJobPerImageFailureKeepsStableErrorCode(t *testing.T) {
	root := t.TempDir()
	files := writeAIJobImages(t, root, 1)
	catalog := aiJobCatalog(root, files)
	service := newTestAIJobService(t, filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		filepath.Join(t.TempDir(), "derived", "metadata"), catalog,
		MetadataAnalyzer{}, gpuFailingAnalyzer{module: AIJobTypeEmbedding})

	job, reused, err := service.Start(AIJobTypeEmbedding, AIJobModeFull)
	if err != nil || reused {
		t.Fatalf("Start() = (%+v, %v, %v)", job, reused, err)
	}
	job = waitForAIJob(t, service, job.ID, AIJobStatusFailed)
	if len(job.Errors) != 1 {
		t.Fatalf("job errors = %+v, want exactly one", job.Errors)
	}
	if job.Errors[0].Code != "gpu_unavailable" {
		t.Fatalf("error code = %q, want gpu_unavailable", job.Errors[0].Code)
	}
}

// TestAIJobEstimateSharesFileFingerprintsAcrossModules 守住规模核算不再重复采集指纹。
//
// 核算一次要看四五个模块，而它们要的其实是同一份文件指纹。
// 照片与漫画的模块范围不同，同一张照片的路径只校验一次。
func TestAIJobEstimateSharesFileFingerprintsAcrossModules(t *testing.T) {
	root := t.TempDir()
	files := writeAIJobImages(t, root, 4)
	catalog := aiJobCatalog(root, files)
	service := newTestAIJobService(t, filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		filepath.Join(t.TempDir(), "derived", "metadata"), catalog,
		MetadataAnalyzer{},
		testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
		testJSONAnalyzer{module: AIJobTypeOCR, version: "ocr-test-v1"},
		testJSONAnalyzer{module: AIJobTypeFace, version: FaceAnalyzerVersion},
	)
	if _, err := service.SetPeopleEnabled(true); err != nil {
		t.Fatalf("SetPeopleEnabled(true) error = %v", err)
	}

	var lookups atomic.Int64
	validate := service.validatePath
	service.validatePath = func(path string) (string, error) {
		lookups.Add(1)
		return validate(path)
	}
	estimate, err := service.Estimate(context.Background())
	if err != nil {
		t.Fatalf("Estimate() error = %v", err)
	}
	if estimate.TotalImages != 4 {
		t.Fatalf("estimate total images = %d, want 4", estimate.TotalImages)
	}
	if got := lookups.Load(); got != int64(len(files)) {
		t.Fatalf("path validations = %d, want one per image (%d)", got, len(files))
	}
}

// TestAIJobBatchDirectoryLayoutHasSingleSource 守住批次目录只有一处决定。
//
// 提交批次、统计任务占用与旧格式迁移都读同一个目录；一旦有人改了其中
// 一处，用户点开任务详情看到的就是一个不存在的目录。
func TestAIJobBatchDirectoryLayoutHasSingleSource(t *testing.T) {
	root := t.TempDir()
	files := writeAIJobImages(t, root, 1)
	catalog := aiJobCatalog(root, files)
	service := newTestAIJobService(t, filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		filepath.Join(t.TempDir(), "derived", "metadata"), catalog, MetadataAnalyzer{})

	job := AIJob{ID: "job-layout", Type: AIJobTypeFace, FaceModel: FaceModelBuffaloM}
	expected := service.aiJobBatchDir(AIJobTypeFace, job.ID, job.FaceModel)
	if got := service.jobBatchPath(&job, 1); filepath.Dir(got) != expected {
		t.Fatalf("jobBatchPath dir = %q, want %q", filepath.Dir(got), expected)
	}
	service.mu.Lock()
	service.jobs[job.ID] = &job
	service.mu.Unlock()
	directory, moduleType, ok := service.JobOutputDir(job.ID)
	if !ok {
		t.Fatal("JobOutputDir() reported the job as missing")
	}
	if moduleType != AIJobTypeFace || directory != expected {
		t.Fatalf("JobOutputDir() = (%q, %q), want (%q, face)", directory, moduleType, expected)
	}
}

// TestAIJobServiceClosedReportsSingleError 守住服务退出后的错误可被识别。
//
// 之前有十一处各自新建同一个错误字符串，上层没法用 errors.Is 判断
// 「服务正在退出」这件事，只能比对文案。
func TestAIJobServiceClosedReportsSingleError(t *testing.T) {
	root := t.TempDir()
	files := writeAIJobImages(t, root, 1)
	catalog := aiJobCatalog(root, files)
	service := newTestAIJobService(t, filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		filepath.Join(t.TempDir(), "derived", "metadata"), catalog, MetadataAnalyzer{})

	if err := service.Shutdown(context.Background()); err != nil {
		t.Fatalf("Shutdown() error = %v", err)
	}
	if _, _, err := service.Start(AIJobTypeMetadata, AIJobModeFull); !errors.Is(err, errAIJobServiceClosed) {
		t.Fatalf("Start() after shutdown error = %v, want errAIJobServiceClosed", err)
	}
}

// BenchmarkAIJobEstimate 记录空闲时规模核算的成本。
//
// 核算要走一遍全库文件指纹采集；改动前同一个指纹清单按模块缓存，
// 一次核算会 stat 六遍，这里用同一份服务状态反复调用。
func BenchmarkAIJobEstimate(b *testing.B) {
	root := b.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		b.Fatal(err)
	}
	files := make([]string, 0, 200)
	for index := 0; index < 200; index++ {
		path := filepath.Join(albumPath, fmt.Sprintf("%04d.jpg", index))
		if err := os.WriteFile(path, testExifJPEG(), 0o600); err != nil {
			b.Fatal(err)
		}
		files = append(files, path)
	}
	catalog := aiJobCatalog(root, files)
	service, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    filepath.Join(b.TempDir(), "state", "ai_jobs.json"),
		MetadataDir:  filepath.Join(b.TempDir(), "derived", "metadata"),
		Catalog:      catalog,
		ValidatePath: aiBenchmarkPathValidator(root),
		Analyzers: []AIAnalyzer{
			MetadataAnalyzer{},
			testJSONAnalyzer{module: AIJobTypeEmbedding, version: "embedding-test-v1"},
			testJSONAnalyzer{module: AIJobTypeOCR, version: "ocr-test-v1"},
		},
		WorkerCount: 2,
	})
	if err != nil {
		b.Fatal(err)
	}
	defer func() { _ = service.Shutdown(context.Background()) }()

	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		// 每次都让指纹清单失效：核算的冷路径才是采集指纹的那一段，
		// 缓存命中时只是查表，测不出重复采集的代价。
		service.targetCacheMu.Lock()
		service.targetCache = nil
		service.targetCacheMu.Unlock()
		if _, err := service.Estimate(context.Background()); err != nil {
			b.Fatal(err)
		}
	}
}

func aiBenchmarkPathValidator(root string) func(string) (string, error) {
	_, state := middleware.PathSafetyMiddleware([]string{root})
	return state.Validate
}
