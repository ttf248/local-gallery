package services

import (
	"path/filepath"
	"testing"
	"time"
)

// TestAIJobServiceReportsWhenJobSettles 锁定任务收尾的通知。
//
// 人物索引按批次增量攒分组，收尾时要整体重建一次；这个通知就是那个钩子。
func TestAIJobServiceReportsWhenJobSettles(t *testing.T) {
	root := t.TempDir()
	files := writeAIJobImages(t, root, 2)
	catalog := aiJobCatalog(root, files)
	settled := make(chan string, 4)
	service, err := NewAIJobService(AIJobServiceOptions{
		StatePath:    filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		MetadataDir:  filepath.Join(t.TempDir(), "derived", "metadata"),
		Catalog:      catalog,
		ValidatePath: aiTestPathValidator(t, root),
		Analyzers:    []AIAnalyzer{MetadataAnalyzer{}},
		WorkerCount:  2,
		OnJobSettled: func(jobType string) { settled <- jobType },
	})
	if err != nil {
		t.Fatalf("NewAIJobService() error = %v", err)
	}
	t.Cleanup(func() { shutdownAIJobService(t, service) })
	if _, err := service.SetGPUEnabled(false); err != nil {
		t.Fatalf("SetGPUEnabled(false) error = %v", err)
	}

	job, _, err := service.Start(AIJobTypeMetadata, AIJobModeFull)
	if err != nil {
		t.Fatalf("Start(full) error = %v", err)
	}
	waitForAIJob(t, service, job.ID, AIJobStatusCompleted)
	select {
	case jobType := <-settled:
		if jobType != AIJobTypeMetadata {
			t.Fatalf("settled job type = %q, want %q", jobType, AIJobTypeMetadata)
		}
	case <-time.After(10 * time.Second):
		t.Fatal("the settled job was not reported")
	}
}
