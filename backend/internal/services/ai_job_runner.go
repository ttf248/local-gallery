package services

// 本文件管任务执行：按批次跑分析器、把结果原子提交成检查点、
// 在批次边界处理暂停与取消，并把任务收敛到终态。
//
// 取消不提交未完成的批次；暂停只发生在批次边界。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type aiJobRuntime struct {
	ctx            context.Context
	cancel         context.CancelFunc
	resume         chan struct{}
	pauseRequested bool
	stopReason     string
}

func (s *AIJobService) run(id string, runtimeState *aiJobRuntime) {
	defer s.wg.Done()
	defer func() {
		runtimeState.cancel()
		s.mu.Lock()
		delete(s.runtimes, id)
		job := s.jobs[id]
		if s.activeID == id && (job == nil || !isAIJobActive(job.Status)) {
			s.activeID = ""
		}
		s.mu.Unlock()
		s.StartPending()
	}()

	s.mu.Lock()
	job := s.jobs[id]
	if job == nil {
		s.mu.Unlock()
		return
	}
	analyzer := s.analyzers[job.Type]
	computeDevice := job.ComputeDevice
	faceModel := job.FaceModel
	now := s.now()
	job.Status = AIJobStatusRunning
	job.Stage = "waiting_for_library"
	if job.StartedAt == nil {
		job.StartedAt = &now
	}
	job.UpdatedAt = now
	if err := s.persistLocked(); err != nil {
		job.Status = AIJobStatusFailed
		job.Stage = "failed"
		job.Error = "任务状态未能持久化"
		finished := s.now()
		job.FinishedAt = &finished
		s.publishLocked(*job)
		s.mu.Unlock()
		return
	}
	s.publishLocked(*job)
	s.mu.Unlock()

	if analyzer.Type() == AIJobTypeFace {
		if err := probeAnalyzerModelReady(runtimeState.ctx, analyzer, faceModel); err != nil {
			s.finishJobWithCode(id, AIJobStatusFailed, "failed", "face_model_unavailable", "所选人脸模型未就绪")
			return
		}
	}

	if computeDevice == "gpu" {
		if err := s.setJobStage(id, "checking_runtime"); err != nil {
			s.finishJob(id, AIJobStatusFailed, "failed", "任务状态未能持久化")
			return
		}
		validator, ok := analyzer.(AIAnalyzerHardware)
		if !ok {
			s.failGPUJob(id, "gpu_backend_unsupported", "此分析模块没有可用的 GPU 推理实现")
			return
		}
		if err := validator.ValidateHardware(runtimeState.ctx, computeDevice); err != nil {
			code, message := analysisFailure(err, analyzer.Type())
			log.Printf("AI job failed: type=%s code=%s", analyzer.Type(), code)
			s.failGPUJob(id, code, message)
			return
		}
	}

	snapshot, err := s.waitForCatalog(runtimeState.ctx)
	if err != nil {
		s.finishInterrupted(id, runtimeState, err)
		return
	}
	if err := s.setJobStage(id, "building_analysis_plan"); err != nil {
		s.finishJob(id, AIJobStatusFailed, "failed", "任务状态未能持久化")
		return
	}
	s.mu.Lock()
	job = s.jobs[id]
	albumID := ""
	var resourceIDs []string
	if job != nil {
		albumID = job.AlbumID
		resourceIDs = append([]string(nil), job.ResourceIDs...)
	}
	s.mu.Unlock()
	var targets []aiJobTarget
	filter := aiTargetFilterForModule(job.Type)
	if len(resourceIDs) > 0 {
		targets = s.buildTargetsForResources(runtimeState.ctx, snapshot, filter, resourceIDs)
	} else {
		targets = s.buildTargets(runtimeState.ctx, snapshot, filter, albumID)
	}
	if portraits, ok := analyzer.(*PortraitAnalyzer); ok {
		targets = portraits.targets(targets)
	}
	digest := digestAITargets(targets, albumID)
	candidates, err := s.selectTargets(id, targets, digest)
	if err != nil {
		s.finishJob(id, AIJobStatusFailed, "failed", "任务检查点未能持久化")
		return
	}
	if len(candidates) == 0 {
		s.mu.Lock()
		failed := s.jobs[id] != nil && s.jobs[id].Failed > 0
		s.mu.Unlock()
		if failed {
			s.finishJob(id, AIJobStatusFailed, "failed", "部分图片分析失败，可重试失败项")
		} else {
			s.finishJob(id, AIJobStatusCompleted, "completed", "")
		}
		return
	}
	if aiJobModuleUsesGPU(analyzer.Type()) {
		if err := s.setJobStage(id, "loading_model"); err != nil {
			s.finishJob(id, AIJobStatusFailed, "failed", "任务状态未能持久化")
			return
		}
	}

	for start := 0; start < len(candidates); start += AIBatchSize {
		if runtimeState.ctx.Err() != nil {
			s.finishInterrupted(id, runtimeState, runtimeState.ctx.Err())
			return
		}
		if s.pauseAtBoundary(id, runtimeState) {
			if runtimeState.ctx.Err() != nil {
				s.finishInterrupted(id, runtimeState, runtimeState.ctx.Err())
				return
			}
		}
		end := min(start+AIBatchSize, len(candidates))
		batch := candidates[start:end]
		records := s.processBatch(runtimeState.ctx, id, batch)
		if runtimeState.ctx.Err() != nil {
			s.finishInterrupted(id, runtimeState, runtimeState.ctx.Err())
			return
		}
		if err := s.commitBatch(id, runtimeState, batch, records, digest); err != nil {
			s.finishJob(id, AIJobStatusFailed, "failed", "分析结果未能持久化")
			return
		}
	}

	s.mu.Lock()
	job = s.jobs[id]
	failed := job != nil && job.Failed > 0
	s.mu.Unlock()
	if failed {
		s.finishJob(id, AIJobStatusFailed, "failed", "部分图片分析失败，可重试失败项")
	} else {
		s.finishJob(id, AIJobStatusCompleted, "completed", "")
	}
}

func (s *AIJobService) setJobStage(id, stage string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return ErrAIJobNotFound
	}
	previousStage, previousUpdated := job.Stage, job.UpdatedAt
	job.Stage = stage
	job.UpdatedAt = s.now()
	if err := s.persistLocked(); err != nil {
		job.Stage, job.UpdatedAt = previousStage, previousUpdated
		return err
	}
	s.publishLocked(*job)
	return nil
}

func (s *AIJobService) waitForCatalog(ctx context.Context) (CatalogSnapshot, error) {
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		snapshot := s.catalog.Acquire()
		if snapshot.Ready() {
			return snapshot, nil
		}
		select {
		case <-ctx.Done():
			return CatalogSnapshot{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func (s *AIJobService) processBatch(ctx context.Context, jobID string, targets []aiJobTarget) []AIAnalysisRecord {
	s.mu.Lock()
	job := s.jobs[jobID]
	var analyzer AIAnalyzer
	computeDevice := "cpu"
	faceModel := ""
	typeName := ""
	version := ""
	if job != nil {
		analyzer = s.analyzers[job.Type]
		computeDevice = job.ComputeDevice
		faceModel = job.FaceModel
		typeName = job.Type
		version = aiAnalyzerVersion(analyzer, faceModel)
	}
	s.mu.Unlock()
	if batchAnalyzer, ok := analyzer.(AIAnalyzerBatch); ok {
		return s.processAnalyzerBatch(ctx, analyzer, batchAnalyzer, computeDevice, faceModel, targets)
	}
	results := make([]AIAnalysisRecord, len(targets))
	workers := min(s.workerCount, len(targets))
	if workerLimit, ok := analyzer.(AIAnalyzerWorkerLimit); ok && workerLimit.MaxWorkers() > 0 {
		workers = min(workers, workerLimit.MaxWorkers())
	}
	queue := make(chan int)
	var workersDone sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		workersDone.Add(1)
		go func() {
			defer workersDone.Done()
			for index := range queue {
				results[index] = s.processTarget(ctx, analyzer, typeName, version, targets[index])
			}
		}()
	}

sendLoop:
	for index := range targets {
		select {
		case <-ctx.Done():
			break sendLoop
		case queue <- index:
		}
	}
	close(queue)
	workersDone.Wait()
	return results
}

func (s *AIJobService) processAnalyzerBatch(ctx context.Context, analyzer AIAnalyzer, batchAnalyzer AIAnalyzerBatch, computeDevice, faceModel string, targets []aiJobTarget) []AIAnalysisRecord {
	version := aiAnalyzerVersion(analyzer, faceModel)
	results := make([]AIAnalysisRecord, len(targets))
	inputs := make([]AIAnalysisInput, 0, len(targets))
	inputPositions := make([]int, 0, len(targets))
	tempDir := ""
	defer func() {
		if tempDir != "" {
			_ = os.RemoveAll(tempDir)
		}
	}()
	for index, target := range targets {
		results[index] = AIAnalysisRecord{
			Type: analyzer.Type(), ResourceID: target.resourceID, Size: target.size,
			MTimeNs: target.mtimeNs, ModuleVersion: version, UpdatedAt: s.now(),
		}
		if err := ctx.Err(); err != nil {
			continue
		}
		if target.statCode != "" {
			results[index] = failedSourceUnavailable(results[index])
			continue
		}
		validated, err := s.validatePath(target.path)
		if err != nil {
			results[index] = failedSourceUnavailable(results[index])
			continue
		}
		info, err := os.Stat(validated)
		if err != nil || !info.Mode().IsRegular() || info.Size() != target.size || info.ModTime().UnixNano() != target.mtimeNs {
			results[index] = failedSourceChanged(results[index])
			continue
		}
		analysisPath := ""
		if aiJobTypeNeedsImageConversion(analyzer.Type()) && isHEIFPath(validated) && s.imageConverter != nil && s.imageConverter.Available() {
			if tempDir == "" {
				tempDir, err = os.MkdirTemp("", "local-gallery-face-")
				if err != nil {
					results[index] = failedConversion(results[index])
					continue
				}
			}
			converted, convertErr := s.imageConverter.ConvertJPEGBytesContext(ctx, validated, aiJobAnalysisMaxDimension(analyzer.Type()))
			if convertErr != nil {
				if ctx.Err() != nil {
					continue
				}
				results[index] = failedConversion(results[index])
				continue
			}
			file, createErr := os.CreateTemp(tempDir, "image-*.jpg")
			if createErr != nil {
				results[index] = failedConversion(results[index])
				continue
			}
			analysisPath = file.Name()
			_, writeErr := file.Write(converted)
			closeErr := file.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(analysisPath)
				results[index] = failedConversion(results[index])
				continue
			}
		}
		inputs = append(inputs, AIAnalysisInput{
			ResourceID: target.resourceID, Path: validated, AnalysisPath: analysisPath,
			Size: target.size, MTimeNs: target.mtimeNs, ComputeDevice: computeDevice, FaceModel: faceModel,
		})
		inputPositions = append(inputPositions, index)
	}
	if len(inputs) == 0 || ctx.Err() != nil {
		return results
	}
	outputs, err := batchAnalyzer.AnalyzeBatch(ctx, inputs)
	if err != nil || len(outputs) != len(inputs) {
		code, message := analysisFailure(err, analyzer.Type())
		for _, index := range inputPositions {
			results[index] = failedAIRecord(results[index], code, message)
		}
		return results
	}
	for inputIndex, output := range outputs {
		position := inputPositions[inputIndex]
		if err := ctx.Err(); err != nil {
			continue
		}
		info, statErr := os.Stat(inputs[inputIndex].Path)
		if statErr != nil || !info.Mode().IsRegular() || info.Size() != inputs[inputIndex].Size || info.ModTime().UnixNano() != inputs[inputIndex].MTimeNs {
			results[position] = failedSourceChanged(results[position])
			continue
		}
		if output.Status == "failed" {
			code, message := output.ErrorCode, output.ErrorMessage
			if code == "" {
				code, message = "analysis_failed", analysisFailureMessage(analyzer.Type())
			}
			results[position] = failedAIRecord(results[position], code, message)
			continue
		}
		if output.Status == "" {
			output.Status = "processed"
		}
		results[position].Status = output.Status
		setRecordPayload(&results[position], output)
	}
	return results
}

// processTarget 逐张跑一个分析模块。
//
// 模块、类型与版本由调用方一次性取好：逐张再取一次会让每个 worker
// 都去抢任务锁，4 个 worker 跑同一批图片时锁竞争比推理本身还密。
func (s *AIJobService) processTarget(
	ctx context.Context,
	analyzer AIAnalyzer,
	typeName, version string,
	target aiJobTarget,
) AIAnalysisRecord {
	record := AIAnalysisRecord{
		Type:          typeName,
		ResourceID:    target.resourceID,
		Size:          target.size,
		MTimeNs:       target.mtimeNs,
		ModuleVersion: version,
		UpdatedAt:     s.now(),
	}
	if err := ctx.Err(); err != nil {
		return record
	}
	if target.statCode != "" {
		return failedSourceUnavailable(record)
	}
	validated, err := s.validatePath(target.path)
	if err != nil {
		return failedSourceUnavailable(record)
	}
	file, err := os.Open(validated)
	if err != nil {
		return failedSourceUnavailable(record)
	}
	defer file.Close()
	before, err := file.Stat()
	if err != nil || !before.Mode().IsRegular() || before.Size() != target.size || before.ModTime().UnixNano() != target.mtimeNs {
		return failedSourceChanged(record)
	}
	output, err := analyzer.Analyze(ctx, file)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return record
		}
		// 与批量路径走同一套错误码映射：GPU 不可用与推理失败要能被区分出来，
		// 否则一次显卡掉线在任务记录里和「文件读不出来」长得一模一样。
		code, message := analysisFailure(err, typeName)
		return failedAIRecord(record, code, message)
	}
	after, err := file.Stat()
	if err != nil || after.Size() != target.size || after.ModTime().UnixNano() != target.mtimeNs {
		return failedSourceChanged(record)
	}
	if output.Status == "" {
		output.Status = "processed"
	}
	record.Status = output.Status
	setRecordPayload(&record, output)
	return record
}

func failedAIRecord(record AIAnalysisRecord, code, message string) AIAnalysisRecord {
	record.Status = "failed"
	record.ErrorCode = code
	record.ErrorMessage = message
	return record
}

// setRecordPayload 把一次分析输出写进结果记录。
//
// 载荷与字段都复制一份：分析器可能复用同一块缓冲区，
// 直接挂上去会让后一条结果改掉前一条。
func setRecordPayload(record *AIAnalysisRecord, output AIAnalysisOutput) {
	record.Data = append(json.RawMessage(nil), output.Data...)
	record.Fields = append([]string(nil), output.Fields...)
}

// 单条分析失败的稳定错误码与文案。
//
// 同一份失败在两条执行路径（批量推理与逐张推理）里必须报同一个码，
// 否则任务记录里按「错误码 + 原因」分组的失败项会漏掉一半。
const (
	aiFailureSourceUnavailable = "source_unavailable"
	aiFailureSourceChanged     = "source_changed"
	aiFailureConversionFailed  = "image_conversion_failed"
	aiFailureAnalysisFailed    = "analysis_failed"
)

const (
	aiMessageSourceUnavailable = "无法读取图片或路径校验失败"
	aiMessageSourceChanged     = "分析期间图片已发生变化"
	aiMessageConversionFailed  = "图片格式转换失败"
)

// failedSourceUnavailable 记一条「读不到源文件」的失败。
func failedSourceUnavailable(record AIAnalysisRecord) AIAnalysisRecord {
	return failedAIRecord(record, aiFailureSourceUnavailable, aiMessageSourceUnavailable)
}

// failedSourceChanged 记一条「分析期间源文件变了」的失败。
func failedSourceChanged(record AIAnalysisRecord) AIAnalysisRecord {
	return failedAIRecord(record, aiFailureSourceChanged, aiMessageSourceChanged)
}

// failedConversion 记一条「格式转换失败」的失败。
func failedConversion(record AIAnalysisRecord) AIAnalysisRecord {
	return failedAIRecord(record, aiFailureConversionFailed, aiMessageConversionFailed)
}

func isHEIFPath(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".heic", ".heif":
		return true
	default:
		return false
	}
}

func analysisFailureMessage(moduleType string) string {
	switch moduleType {
	case AIJobTypeMetadata:
		return "EXIF 数据损坏或无法解析"
	default:
		return "分析模块处理失败"
	}
}

func analysisFailure(err error, moduleType string) (string, string) {
	if errors.Is(err, ErrAIGPUUnavailable) {
		return "gpu_unavailable", "未检测到可用的 NVIDIA CUDA 推理环境；已按 GPU 强制模式停止任务"
	}
	if errors.Is(err, ErrAIGPUInferenceFailed) {
		return "gpu_inference_failed", "GPU 推理失败；已按 GPU 强制模式停止任务"
	}
	return "analysis_failed", analysisFailureMessage(moduleType)
}

func (s *AIJobService) commitBatch(jobID string, runtimeState *aiJobRuntime, targets []aiJobTarget, records []AIAnalysisRecord, digest string) error {
	if runtimeState.ctx.Err() != nil {
		return runtimeState.ctx.Err()
	}
	s.mu.Lock()
	job := s.jobs[jobID]
	if job == nil {
		s.mu.Unlock()
		return ErrAIJobNotFound
	}
	batchNumber := job.Checkpoint.Batch + 1
	s.mu.Unlock()

	lastIndex := len(records) - 1
	batchFile := aiJobBatch{
		JobID:          jobID,
		FaceModel:      job.FaceModel,
		Number:         batchNumber,
		Offset:         targets[lastIndex].position + 1,
		LastResourceID: records[lastIndex].ResourceID,
		TargetDigest:   digest,
		Records:        records,
	}
	path := s.jobBatchPath(job, batchNumber)
	if err := writeAIJSONAtomic(path, batchFile); err != nil {
		return err
	}

	s.mu.Lock()
	job = s.jobs[jobID]
	if job == nil {
		s.mu.Unlock()
		return ErrAIJobNotFound
	}
	for index, record := range records {
		if record.ResourceID == "" {
			continue
		}
		key := aiRecordKeyForRecord(record)
		s.records[key] = record
		s.recordFiles[key] = path
		s.recordsRevision++
		if record.Status == "failed" {
			job.Failed++
			job.Errors = append(job.Errors, AIJobError{
				ResourceID: record.ResourceID,
				Path:       targets[index].displayPath,
				Code:       record.ErrorCode,
				Message:    record.ErrorMessage,
				At:         record.UpdatedAt,
			})
		} else {
			job.Processed++
		}
		accumulateAIJobOutput(job, record)
		job.Done++
		job.CurrentResourceID = record.ResourceID
		job.Checkpoint.Offset = targets[index].position + 1
		job.Checkpoint.LastResourceID = record.ResourceID
	}
	job.Checkpoint.Batch = batchNumber
	job.Checkpoint.TargetDigest = digest
	job.Checkpoint.ModuleVersion = job.ModuleVersion
	job.UpdatedAt = s.now()
	job.Stage = job.Type
	if err := s.persistLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	s.publishLocked(*job)
	onRecordsCommitted := s.onRecordsCommitted
	s.mu.Unlock()
	if onRecordsCommitted != nil {
		onRecordsCommitted(cloneRecords(records))
	}
	return nil
}

func (s *AIJobService) jobBatchPath(job *AIJob, batchNumber int) string {
	directory := s.aiJobBatchDir(job.Type, job.ID, job.FaceModel)
	return filepath.Join(directory, fmt.Sprintf("%08d.json", batchNumber))
}

func (s *AIJobService) pauseAtBoundary(id string, runtimeState *aiJobRuntime) bool {
	s.mu.Lock()
	if !runtimeState.pauseRequested || runtimeState.ctx.Err() != nil {
		s.mu.Unlock()
		return false
	}
	job := s.jobs[id]
	if job == nil {
		s.mu.Unlock()
		return false
	}
	previousStatus, previousStage, previousUpdated := job.Status, job.Stage, job.UpdatedAt
	job.Status = AIJobStatusPaused
	job.Stage = "paused"
	job.UpdatedAt = s.now()
	if err := s.persistLocked(); err != nil {
		runtimeState.pauseRequested = false
		job.Status, job.Stage, job.UpdatedAt = previousStatus, previousStage, previousUpdated
		s.mu.Unlock()
		return false
	}
	s.publishLocked(*job)
	s.mu.Unlock()

	select {
	case <-runtimeState.ctx.Done():
		return true
	case <-runtimeState.resume:
		return true
	}
}

func (s *AIJobService) finishInterrupted(id string, runtimeState *aiJobRuntime, err error) {
	s.mu.Lock()
	job := s.jobs[id]
	if job == nil {
		s.mu.Unlock()
		return
	}
	if runtimeState.stopReason == "shutdown" {
		job.Status = AIJobStatusPending
		job.Stage = "pending"
		job.Error = ""
		job.RecoveredAfterRestart = true
	} else if runtimeState.stopReason == "shutdown_paused" {
		job.Status = AIJobStatusPaused
		job.Stage = "paused"
		job.Error = ""
	} else if runtimeState.stopReason == "user" || errors.Is(err, context.Canceled) {
		job.Status = AIJobStatusCancelled
		job.Stage = "cancelled"
		job.Error = ""
		finished := s.now()
		job.FinishedAt = &finished
	} else {
		job.Status = AIJobStatusFailed
		job.Stage = "failed"
		job.Error = "后台任务已中断"
		finished := s.now()
		job.FinishedAt = &finished
	}
	job.UpdatedAt = s.now()
	if !isAIJobActive(job.Status) && s.activeID == id {
		s.activeID = ""
	}
	_ = s.persistLocked()
	s.publishLocked(*job)
	jobType := job.Type
	settled := !isAIJobActive(job.Status)
	s.mu.Unlock()
	if settled {
		s.notifyJobSettled(jobType)
	}
}

func (s *AIJobService) finishJob(id, status, stage, message string) {
	s.finishJobWithCode(id, status, stage, "", message)
}

func (s *AIJobService) failGPUJob(id, code, message string) {
	s.finishJobWithCode(id, AIJobStatusFailed, "failed", code, message)
}

func (s *AIJobService) finishJobWithCode(id, status, stage, errorCode, message string) {
	s.mu.Lock()
	job := s.jobs[id]
	if job == nil {
		s.mu.Unlock()
		return
	}
	job.Status = status
	job.Stage = stage
	job.Error = message
	job.ErrorCode = errorCode
	finished := s.now()
	job.FinishedAt = &finished
	job.UpdatedAt = finished
	if s.activeID == id {
		s.activeID = ""
	}
	if err := s.persistLocked(); err != nil {
		job.Status = AIJobStatusFailed
		job.Stage = "failed"
		job.Error = "任务状态未能持久化"
		job.ErrorCode = "job_state_persist_failed"
		job.FinishedAt = &finished
		_ = s.persistLocked()
	}
	s.publishLocked(*job)
	jobType := job.Type
	s.mu.Unlock()
	// 任务收尾了：按批次攒出来的派生数据可以整体重建一次。
	s.notifyJobSettled(jobType)
}

// notifyJobSettled 告诉外部任务已经收尾。
//
// 重建可能要在整库上跑几十秒，放在后台做，不挡任务收尾。
func (s *AIJobService) notifyJobSettled(jobType string) {
	if callback := s.onJobSettled; callback != nil {
		go callback(jobType)
	}
}
