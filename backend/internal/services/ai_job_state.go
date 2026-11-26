package services

// 本文件管落盘：任务状态（state/ai_jobs.json）、批次结果（derived/metadata）
// 与它们的原子写入、加载和旧格式迁移。
//
// 写入一律先写临时文件再原子改名，读者只会看到改名前后的完整文件。

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type aiJobDiskState struct {
	Version  int           `json:"version"`
	Jobs     []AIJob       `json:"jobs"`
	Queue    []string      `json:"queue,omitempty"`
	Settings AIJobSettings `json:"settings"`
}

// aiJobBatchDir 返回某个任务的批次目录。
//
// 人脸任务按模型分目录：两个模型的权重与分析版本互不相通，
// 批次文件混在一起会让重启后的恢复取到另一个模型的记录。
//
// 目录布局只有这一处决定，提交批次、统计占用与旧格式迁移共用它。
func (s *AIJobService) aiJobBatchDir(jobType, jobID, faceModel string) string {
	if jobType == AIJobTypeFace {
		model := faceModel
		if _, valid := FaceAnalyzerVersionForModel(model); !valid {
			model = DefaultFaceModel
		}
		return filepath.Join(s.metadataDir, AIJobTypeFace, model, "batches", jobID)
	}
	return filepath.Join(s.metadataDir, jobType, "batches", jobID)
}

type aiJobBatch struct {
	JobID          string             `json:"jobId"`
	FaceModel      string             `json:"faceModel,omitempty"`
	Number         int                `json:"number"`
	Offset         int                `json:"offset"`
	LastResourceID string             `json:"lastResourceId"`
	TargetDigest   string             `json:"targetDigest"`
	Records        []AIAnalysisRecord `json:"records"`
}

// migrateLegacyFaceBatches 将旧版共享人脸批次迁移到任务记录对应的模型目录。
// 如果迁移中断，重新启动后可以安全重试。
func (s *AIJobService) migrateLegacyFaceBatches() error {
	legacyRoot := filepath.Join(s.metadataDir, AIJobTypeFace, "batches")
	jobs, err := os.ReadDir(legacyRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	for _, entry := range jobs {
		if !entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			continue
		}
		jobID := entry.Name()
		sourceDir := filepath.Join(legacyRoot, jobID)
		model := s.faceModelForBatch(jobID, sourceDir)
		destinationDir := s.aiJobBatchDir(AIJobTypeFace, jobID, model)
		if err := os.MkdirAll(destinationDir, 0o755); err != nil {
			return err
		}
		files, err := os.ReadDir(sourceDir)
		if err != nil {
			return err
		}
		for _, file := range files {
			if file.IsDir() || file.Type()&os.ModeSymlink != 0 {
				continue
			}
			source := filepath.Join(sourceDir, file.Name())
			destination := filepath.Join(destinationDir, file.Name())
			if _, statErr := os.Stat(destination); statErr == nil {
				sourceData, sourceErr := os.ReadFile(source)
				destinationData, destinationErr := os.ReadFile(destination)
				if sourceErr != nil || destinationErr != nil || string(sourceData) != string(destinationData) {
					return fmt.Errorf("conflicting face batch during profile migration: %s", file.Name())
				}
				if removeErr := os.Remove(source); removeErr != nil {
					return removeErr
				}
			} else if !errors.Is(statErr, os.ErrNotExist) {
				return statErr
			} else if err := os.Rename(source, destination); err != nil {
				return err
			}
		}
		if err := os.Remove(sourceDir); err != nil && !errors.Is(err, os.ErrNotExist) {
			remaining, readErr := os.ReadDir(sourceDir)
			if readErr != nil {
				return readErr
			}
			if len(remaining) == 0 {
				return err
			}
		}
	}
	remaining, err := os.ReadDir(legacyRoot)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if len(remaining) > 0 {
		return nil
	}
	return os.Remove(legacyRoot)
}

func (s *AIJobService) faceModelForBatch(jobID, directory string) string {
	if job := s.jobs[jobID]; job != nil {
		if _, valid := FaceAnalyzerVersionForModel(job.FaceModel); valid {
			return job.FaceModel
		}
	}
	files, _ := os.ReadDir(directory)
	for _, file := range files {
		if file.IsDir() || filepath.Ext(file.Name()) != ".json" || file.Type()&os.ModeSymlink != 0 {
			continue
		}
		data, err := os.ReadFile(filepath.Join(directory, file.Name()))
		if err != nil {
			continue
		}
		var batch aiJobBatch
		if json.Unmarshal(data, &batch) != nil {
			continue
		}
		if _, valid := FaceAnalyzerVersionForModel(batch.FaceModel); valid {
			return batch.FaceModel
		}
		for _, record := range batch.Records {
			if record.Type != AIJobTypeFace {
				continue
			}
			if record.ModuleVersion == FaceAnalyzerBuffaloMVersion {
				return FaceModelBuffaloM
			}
			if SupportsFaceAnalyzerVersion(record.ModuleVersion) {
				return FaceModelQualityV2
			}
		}
	}
	return DefaultFaceModel
}

func (s *AIJobService) loadState() error {
	data, err := os.ReadFile(s.statePath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	var state aiJobDiskState
	if err := json.Unmarshal(data, &state); err != nil {
		return fmt.Errorf("decode AI job state: %w", err)
	}
	if state.Version != aiJobStoreVersion {
		return fmt.Errorf("unsupported AI job state version %d", state.Version)
	}
	settingsChanged := false
	if state.Settings.DailyTime != "" {
		if _, err := time.Parse("15:04", state.Settings.DailyTime); err != nil {
			return errors.New("invalid daily analysis time in state")
		}
		s.settings = state.Settings
		if s.settings.FaceModel == "" {
			s.settings.FaceModel = DefaultFaceModel
			settingsChanged = true
		}
		if _, valid := FaceAnalyzerVersionForModel(s.settings.FaceModel); !valid {
			return errors.New("invalid face model in state")
		}
		if !state.Settings.gpuEnabledSet {
			s.settings.GPUEnabled = true
			s.settings.gpuEnabledSet = true
			settingsChanged = true
		}
	}
	if s.settings.DailyModules == nil {
		s.settings.DailyModules = []string{AIJobTypeMetadata}
	}
	if s.settings.LastScheduledStatus == "running" {
		s.settings.LastScheduledStatus = "interrupted"
		settingsChanged = true
	}
	if !s.settings.PeopleEnabled {
		modules := withoutModule(withoutModule(s.settings.DailyModules, AIJobTypeFace), AIJobTypePortrait)
		if len(modules) != len(s.settings.DailyModules) {
			s.settings.DailyModules = modules
			settingsChanged = true
		}
	}
	for _, job := range state.Jobs {
		if job.ID == "" || !validAIJobType(job.Type) || (job.Mode != AIJobModeFull && job.Mode != AIJobModeIncremental) {
			continue
		}
		if job.ComputeDevice == "" || (job.ComputeDevice != "cpu" && job.ComputeDevice != "gpu") {
			job.ComputeDevice = "cpu"
			if job.Type != AIJobTypeMetadata && s.settings.GPUEnabled && isAIJobActive(job.Status) {
				job.ComputeDevice = "gpu"
			}
			settingsChanged = true
		}
		if job.Type == AIJobTypeFace && job.FaceModel == "" {
			job.FaceModel = DefaultFaceModel
			settingsChanged = true
		}
		if job.Type == AIJobTypeFace {
			if _, valid := FaceAnalyzerVersionForModel(job.FaceModel); !valid {
				continue
			}
		}
		if job.Errors == nil {
			job.Errors = []AIJobError{}
		}
		copy := job
		s.jobs[job.ID] = &copy
		s.order = append(s.order, job.ID)
	}
	if state.Queue == nil {
		for _, id := range s.order {
			if job := s.jobs[id]; job != nil && job.Status == AIJobStatusPending {
				s.queue = append(s.queue, id)
			}
		}
	} else {
		seen := make(map[string]struct{}, len(state.Queue))
		for _, id := range state.Queue {
			job := s.jobs[id]
			if job == nil || job.Status != AIJobStatusPending {
				continue
			}
			if _, exists := seen[id]; exists {
				continue
			}
			seen[id] = struct{}{}
			s.queue = append(s.queue, id)
		}
		activePending := make([]string, 0, len(s.order))
		for _, id := range s.order {
			job := s.jobs[id]
			if job == nil || job.Status != AIJobStatusPending {
				continue
			}
			if _, exists := seen[id]; !exists {
				activePending = append(activePending, id)
			}
		}
		s.queue = append(activePending, s.queue...)
	}
	if settingsChanged {
		return s.persistLocked()
	}
	return nil
}

func (s *AIJobService) recoverInterruptedJobs() {
	s.mu.Lock()
	defer s.mu.Unlock()
	changed := false
	for _, id := range s.order {
		job := s.jobs[id]
		minimumTotal := max(job.Done, job.Checkpoint.Offset)
		if job.Total < minimumTotal {
			job.Total = minimumTotal
			changed = true
		}
		if (job.Type == AIJobTypeFace || job.Type == AIJobTypePortrait) && !s.settings.PeopleEnabled && isAIJobActive(job.Status) {
			job.Status = AIJobStatusCancelled
			job.Stage = string(AIJobStatusCancelled)
			job.Error = ErrPeopleAnalysisDisabled.Error()
			finished := s.now()
			job.FinishedAt = &finished
			job.CurrentResourceID = ""
			job.UpdatedAt = finished
			changed = true
			continue
		}
		if job.Status == AIJobStatusRunning {
			job.Status = AIJobStatusPending
			job.Stage = "pending"
			job.CurrentResourceID = ""
			job.UpdatedAt = s.now()
			job.RecoveredAfterRestart = true
			s.queue = append([]string{id}, s.queue...)
			changed = true
		}
		if job.Status == AIJobStatusPaused && s.activeID == "" {
			s.activeID = id
		}
	}
	if changed {
		_ = s.persistLocked()
	}
}

func (s *AIJobService) loadRecords() error {
	reconciled := false
	err := filepath.WalkDir(s.metadataDir, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || filepath.Ext(path) != ".json" || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if err != nil || !info.Mode().IsRegular() {
			return nil
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var batch aiJobBatch
		if err := json.Unmarshal(data, &batch); err != nil {
			return fmt.Errorf("decode metadata batch: %w", err)
		}
		for _, record := range batch.Records {
			if !validAIJobType(record.Type) || record.ResourceID == "" || record.ModuleVersion == "" {
				continue
			}
			key := aiRecordKeyForRecord(record)
			current, exists := s.records[key]
			if !exists || record.UpdatedAt.After(current.UpdatedAt) {
				s.records[key] = record
				s.recordFiles[key] = path
				s.recordsRevision++
			}
		}
		if job := s.jobs[batch.JobID]; job != nil && batch.Number > job.Checkpoint.Batch {
			for _, record := range batch.Records {
				if record.Status == "failed" {
					job.Failed++
					job.Errors = append(job.Errors, AIJobError{
						ResourceID: record.ResourceID,
						Code:       record.ErrorCode,
						Message:    record.ErrorMessage,
						At:         record.UpdatedAt,
					})
				} else {
					job.Processed++
				}
				accumulateAIJobOutput(job, record)
				job.Done++
			}
			job.Checkpoint.Batch = batch.Number
			job.Checkpoint.Offset = batch.Offset
			job.Checkpoint.LastResourceID = batch.LastResourceID
			job.Checkpoint.TargetDigest = batch.TargetDigest
			job.UpdatedAt = s.now()
			reconciled = true
		}
		return nil
	})
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if reconciled {
		return s.persistLocked()
	}
	return nil
}

func (s *AIJobService) persistLocked() error {
	state := aiJobDiskState{
		Version:  aiJobStoreVersion,
		Settings: s.settings,
		Queue:    append([]string(nil), s.queue...),
		Jobs:     make([]AIJob, 0, len(s.order)),
	}
	for _, id := range s.order {
		if job := s.jobs[id]; job != nil {
			copy := *job
			copy.ElapsedMs = 0
			copy.SpeedPerSecond = 0
			copy.Planned = 0
			copy.Completed = 0
			copy.EstimatedRemainingMs = 0
			state.Jobs = append(state.Jobs, copy)
		}
	}
	return writeAIJSONAtomic(s.statePath, state)
}

func writeAIJSONAtomic(path string, value any) error {
	data, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	temporary, err := os.CreateTemp(filepath.Dir(path), ".ai-job-*.tmp")
	if err != nil {
		return err
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if _, err := temporary.Write(data); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return err
	}
	if err := temporary.Close(); err != nil {
		return err
	}
	var renameErr error
	// Windows 实时扫描可能短暂占用目标文件；原子替换失败时做有限退避重试。
	for attempt := 0; attempt < 6; attempt++ {
		renameErr = os.Rename(temporaryPath, path)
		if renameErr == nil {
			return nil
		}
		if attempt < 5 {
			time.Sleep(time.Duration(10<<attempt) * time.Millisecond)
		}
	}
	return renameErr
}
