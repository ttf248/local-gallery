package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

const (
	OCRAnalyzerVersion            = "rapidocr-3.10.0-onnxruntime-1.20.2"
	FaceAnalyzerVersion           = "yunet-2023mar-multiscale+sface-2021dec+quality-v2"
	FaceAnalyzerBuffaloMVersion   = "buffalo-m-scrfd-2.5g-w600k-r50-v1"
	FaceModelQualityV2            = "quality-v2"
	FaceModelBuffaloM             = "buffalo_m"
	DefaultFaceModel              = FaceModelQualityV2
	previousFaceAnalyzerVersion   = "yunet-2023mar-multiscale+sface-2021dec+quality-v1"
	olderFaceAnalyzerVersion      = "yunet-2023mar-multiscale+sface-2021dec"
	legacyFaceAnalyzerVersion     = "yunet-2023mar+sface-2021dec"
	faceDetectionMinimumScore     = float32(0.75)
	faceDetectionMinimumBoxSide   = float32(32)
	faceAnalyzerInputMaxDimension = 2048
)

// SupportsFaceAnalyzerVersion identifies face records that can still be read
// while the current analyzer version is being recomputed.
func SupportsFaceAnalyzerVersion(version string) bool {
	return version == FaceAnalyzerVersion || version == FaceAnalyzerBuffaloMVersion ||
		version == previousFaceAnalyzerVersion ||
		version == olderFaceAnalyzerVersion || version == legacyFaceAnalyzerVersion
}

func FaceAnalyzerVersionForModel(model string) (string, bool) {
	switch model {
	case FaceModelQualityV2:
		return FaceAnalyzerVersion, true
	case FaceModelBuffaloM:
		return FaceAnalyzerBuffaloMVersion, true
	default:
		return "", false
	}
}

func FaceEmbeddingDimensionForVersion(version string) int {
	if version == FaceAnalyzerBuffaloMVersion {
		return 512
	}
	if SupportsFaceAnalyzerVersion(version) {
		return 128
	}
	return 0
}

// OCRAnalyzer stores local text-recognition results in the existing AI metadata batches.
type OCRAnalyzer struct{ worker AIImageAnalysisWorker }

func NewOCRAnalyzer(worker AIImageAnalysisWorker) (*OCRAnalyzer, error) {
	if worker == nil {
		return nil, errors.New("OCR analyzer requires a local image worker")
	}
	return &OCRAnalyzer{worker: worker}, nil
}

func (OCRAnalyzer) Type() string    { return AIJobTypeOCR }
func (OCRAnalyzer) Version() string { return OCRAnalyzerVersion }
func (a *OCRAnalyzer) Available() (bool, string) {
	status := a.worker.ModuleStatus(AIJobTypeOCR)
	return status.Ready, status.Error
}
func (a *OCRAnalyzer) Ready(ctx context.Context) error {
	status, err := a.worker.Status(ctx)
	if err != nil {
		return err
	}
	if !status.Modules[AIJobTypeOCR].Ready {
		return fmt.Errorf("%w: %s", ErrAIAnalyzerUnavailable, status.Modules[AIJobTypeOCR].Error)
	}
	return nil
}
func (a *OCRAnalyzer) ValidateHardware(ctx context.Context, device string) error {
	return validateImageGPU(ctx, a.worker, device)
}
func (a *OCRAnalyzer) Analyze(context.Context, io.ReadSeeker) (AIAnalysisOutput, error) {
	return AIAnalysisOutput{}, errors.New("OCR analyzer requires validated batch inputs")
}
func (a *OCRAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	return analyzeImageBatch(ctx, inputs, func(ctx context.Context, paths []string, device string) ([]AIWorkerAnalysis, error) {
		return runImageAnalysis(a.worker, "ocr", ctx, paths, device)
	}, AIFieldOCRText, func(data json.RawMessage) bool {
		var result struct {
			Text string `json:"text"`
		}
		return json.Unmarshal(data, &result) == nil && result.Text != ""
	})
}
func (a *OCRAnalyzer) RecordCurrent(record AIAnalysisRecord) bool {
	return record.Type == AIJobTypeOCR && (record.Status == "recognized" || record.Status == "no_text") && record.ModuleVersion == a.Version()
}

// FaceAnalyzer stores YuNet boxes and SFace embeddings for local face similarity search.
type FaceAnalyzer struct{ worker AIImageAnalysisWorker }

func NewFaceAnalyzer(worker AIImageAnalysisWorker) (*FaceAnalyzer, error) {
	if worker == nil {
		return nil, errors.New("face analyzer requires a local image worker")
	}
	return &FaceAnalyzer{worker: worker}, nil
}

func (FaceAnalyzer) Type() string    { return AIJobTypeFace }
func (FaceAnalyzer) Version() string { return FaceAnalyzerVersion }
func (FaceAnalyzer) VersionForModel(model string) (string, bool) {
	return FaceAnalyzerVersionForModel(model)
}
func (a *FaceAnalyzer) Available() (bool, string) {
	status := a.worker.ModuleStatus(AIJobTypeFace)
	return status.Ready, status.Error
}
func (a *FaceAnalyzer) AvailableForModel(model string) (bool, string) {
	if _, valid := FaceAnalyzerVersionForModel(model); !valid {
		return false, "invalid_face_model"
	}
	if status, ok := a.worker.(AIWorkerFaceModelStatus); ok {
		profile := status.FaceModelStatus(model)
		return profile.Ready, profile.Error
	}
	if model == FaceModelQualityV2 {
		return a.Available()
	}
	return false, "face_model_status_unavailable"
}
func (a *FaceAnalyzer) Ready(ctx context.Context) error {
	return a.ReadyForModel(ctx, FaceModelQualityV2)
}
func (a *FaceAnalyzer) ReadyForModel(ctx context.Context, model string) error {
	status, err := a.worker.Status(ctx)
	if err != nil {
		return err
	}
	profile, known := status.FaceModels[model]
	if !known && model == FaceModelQualityV2 {
		profile = status.Modules[AIJobTypeFace]
		known = true
	}
	if _, valid := FaceAnalyzerVersionForModel(model); !valid || !known || !profile.Ready {
		reason := profile.Error
		if reason == "" {
			reason = "face_model_unavailable"
		}
		return fmt.Errorf("%w: %s", ErrAIAnalyzerUnavailable, reason)
	}
	return nil
}
func (a *FaceAnalyzer) ValidateHardware(ctx context.Context, device string) error {
	return validateImageGPU(ctx, a.worker, device)
}
func (a *FaceAnalyzer) Analyze(context.Context, io.ReadSeeker) (AIAnalysisOutput, error) {
	return AIAnalysisOutput{}, errors.New("face analyzer requires validated batch inputs")
}
func (a *FaceAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	return analyzeImageBatch(ctx, inputs, func(ctx context.Context, paths []string, device string) ([]AIWorkerAnalysis, error) {
		return runImageAnalysisForFaceModel(a.worker, ctx, paths, device, inputs[0].FaceModel)
	}, AIFieldFaces, func(data json.RawMessage) bool {
		var result struct {
			Faces []json.RawMessage `json:"faces"`
		}
		return json.Unmarshal(data, &result) == nil && len(result.Faces) > 0
	})
}
func (a *FaceAnalyzer) RecordCurrent(record AIAnalysisRecord) bool {
	return record.Type == AIJobTypeFace && (record.Status == "faces_found" || record.Status == "no_faces") &&
		SupportsFaceAnalyzerVersion(record.ModuleVersion)
}

type imageBatchAnalyzer func(context.Context, []string, string) ([]AIWorkerAnalysis, error)

func analyzeImageBatch(
	ctx context.Context,
	inputs []AIAnalysisInput,
	analyze imageBatchAnalyzer,
	field string,
	hasResult func(json.RawMessage) bool,
) ([]AIAnalysisOutput, error) {
	if len(inputs) == 0 {
		return []AIAnalysisOutput{}, nil
	}
	paths := make([]string, len(inputs))
	for index, input := range inputs {
		paths[index] = input.AnalysisPath
		if paths[index] == "" {
			paths[index] = input.Path
		}
	}
	device := inputs[0].ComputeDevice
	results, err := analyze(ctx, paths, device)
	if err != nil {
		return nil, err
	}
	if len(results) != len(inputs) {
		return nil, errors.New("local image worker returned an incomplete batch")
	}
	outputs := make([]AIAnalysisOutput, len(results))
	for index, result := range results {
		if result.Error != "" || !json.Valid(result.Data) {
			code := "image_analysis_failed"
			message := "图片无法读取或分析失败"
			if result.Error == "gpu_unavailable" {
				code = "gpu_unavailable"
				message = "GPU 推理环境不可用；已按 GPU 强制模式停止任务"
			} else if result.Error == "gpu_inference_failed" || result.Error == "gpu_out_of_memory" {
				code = "gpu_inference_failed"
				message = "GPU 推理失败；未切换到 CPU"
			}
			outputs[index] = AIAnalysisOutput{
				Status: "failed", ErrorCode: code, ErrorMessage: message,
			}
			continue
		}
		status := "no_text"
		if field == AIFieldFaces {
			status = "no_faces"
		}
		fields := []string(nil)
		if hasResult(result.Data) {
			status = "recognized"
			if field == AIFieldFaces {
				status = "faces_found"
			}
			fields = []string{field}
		}
		outputs[index] = AIAnalysisOutput{Status: status, Data: result.Data, Fields: fields}
	}
	return outputs, nil
}

func runImageAnalysis(worker AIImageAnalysisWorker, module string, ctx context.Context, paths []string, device string) ([]AIWorkerAnalysis, error) {
	if device == "" {
		switch module {
		case AIJobTypeOCR:
			return worker.AnalyzeOCR(ctx, paths)
		default:
			return worker.AnalyzeFaces(ctx, paths)
		}
	}
	computeWorker, ok := worker.(AIWorkerCompute)
	if !ok {
		if device == "gpu" {
			return nil, ErrAIGPUUnavailable
		}
		return runImageAnalysis(worker, module, ctx, paths, "")
	}
	if module == AIJobTypeOCR {
		return computeWorker.AnalyzeOCROnDevice(ctx, paths, device)
	}
	return computeWorker.AnalyzeFacesOnDevice(ctx, paths, device)
}

func runImageAnalysisForFaceModel(worker AIImageAnalysisWorker, ctx context.Context, paths []string, device, model string) ([]AIWorkerAnalysis, error) {
	if model == "" || model == FaceModelQualityV2 {
		return runImageAnalysis(worker, AIJobTypeFace, ctx, paths, device)
	}
	if _, valid := FaceAnalyzerVersionForModel(model); !valid {
		return nil, ErrAIAnalyzerUnavailable
	}
	computeWorker, ok := worker.(AIWorkerFaceModelCompute)
	if !ok {
		return nil, ErrAIAnalyzerUnavailable
	}
	if device == "" {
		device = "auto"
	}
	return computeWorker.AnalyzeFacesWithModelOnDevice(ctx, paths, device, model)
}

func validateImageGPU(ctx context.Context, worker AIImageAnalysisWorker, device string) error {
	if device != "gpu" {
		return nil
	}
	status, err := worker.Status(ctx)
	if err != nil || (!status.Portable && (!status.CUDAAvailable || !status.CUDAExecutionProviderAvailable)) {
		return ErrAIGPUUnavailable
	}
	return nil
}

var _ AIAnalyzer = (*OCRAnalyzer)(nil)
var _ AIAnalyzerBatch = (*OCRAnalyzer)(nil)
var _ AIAnalyzerReadiness = (*OCRAnalyzer)(nil)
var _ AIAnalyzerAvailability = (*OCRAnalyzer)(nil)
var _ AIAnalyzerRecordValidator = (*OCRAnalyzer)(nil)
var _ AIAnalyzer = (*FaceAnalyzer)(nil)
var _ AIAnalyzerBatch = (*FaceAnalyzer)(nil)
var _ AIAnalyzerReadiness = (*FaceAnalyzer)(nil)
var _ AIAnalyzerAvailability = (*FaceAnalyzer)(nil)
var _ AIAnalyzerRecordValidator = (*FaceAnalyzer)(nil)
var _ AIAnalyzerHardware = (*OCRAnalyzer)(nil)
var _ AIAnalyzerHardware = (*FaceAnalyzer)(nil)
