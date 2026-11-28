package services

// 本文件是分析任务服务的核心：分析模块的扩展边界、任务与检查点的数据结构、
// 任务生命周期（启动、暂停、取消、重试、清理）以及订阅发布。
//
// 同一 package 内按职责拆成几个文件：
//
//	ai_jobs.go         任务模型、分析模块边界、生命周期与订阅发布
//	ai_job_records.go  可重建的分析结果（derived/metadata）的读写与失效
//	ai_job_state.go    任务状态与批次文件的落盘、加载与迁移
//	ai_job_targets.go  分析目标的收集、文件指纹与「结果是否仍然有效」的判据
//	ai_job_runner.go   任务执行、批次提交与终态收敛
//	ai_job_schedule.go 每日计划与本机时钟调度

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"runtime"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
)

const (
	AIJobTypeMetadata  = "metadata"
	AIJobTypeEmbedding = "embedding"
	AIJobTypeOCR       = "ocr"
	AIJobTypeFace      = "face"
	// AIJobTypeSimilarity 提取相似照片整理需要的本地特征：
	// 内容指纹、感知哈希与质量指标。这一步不依赖本机 AI Worker。
	AIJobTypeSimilarity = "similarity"

	AIJobModeFull        = "full"
	AIJobModeIncremental = "incremental"

	AIJobStatusPending       = "pending"
	AIJobStatusRunning       = "running"
	AIJobStatusPaused        = "paused"
	AIJobStatusCompleted     = "completed"
	AIJobStatusFailed        = "failed"
	AIJobStatusCancelled     = "cancelled"
	faceAnalysisMaxDimension = 4096

	// 分析模块在单条结果里报告的字段标识，用于按字段统计任务产出。
	AIFieldExifTime  = "exifTime"
	AIFieldCamera    = "camera"
	AIFieldGPS       = "gps"
	AIFieldEmbedding = "embedding"
	AIFieldOCRText   = "ocrText"
	AIFieldFaces     = "faces"

	aiJobStoreVersion = 1
	// AIBatchSize 是一批提交的图片数；批次文件按这个粒度落在派生目录里。
	AIBatchSize  = 32
	aiMaxWorkers = 4
	// aiStatWorkerCount 是采集文件指纹时的并发数。stat 是 IO 密集的，
	// 单独于分析 worker 的上限。
	aiStatWorkerCount = 8
)

var ErrAIJobActive = errors.New("an analysis job is already active")

var ErrAIJobNotFound = errors.New("analysis job not found")

var ErrAIJobNotManageable = errors.New("analysis job cannot be managed in its current state")

var ErrAIJobInvalidDirection = errors.New("invalid queue direction")

var ErrAIJobInvalidAlbum = errors.New("analysis album is unavailable or is not a photo album")

var ErrAIAnalyzerUnavailable = errors.New("analysis module runtime or model is unavailable")

var ErrPeopleAnalysisDisabled = errors.New("people analysis is disabled")

var ErrDailyPlanNoMediaRoots = errors.New("daily plan has no configured media roots")

// errAIJobServiceClosed 表示服务正在退出，之后不再接受新的任务。
//
// 它只有一个来源：AIJobService.closed。散落的字符串副本会让上层
// 无法用 errors.Is 判断「服务在关」这件事。
var errAIJobServiceClosed = errors.New("AI job service is shutting down")

// AIAnalysisOutput 是一个分析模块对单个媒体返回的可序列化结果。
type AIAnalysisOutput struct {
	Status       string          `json:"status"`
	Data         json.RawMessage `json:"data,omitempty"`
	ErrorCode    string          `json:"errorCode,omitempty"`
	ErrorMessage string          `json:"errorMessage,omitempty"`
	// Fields 列出这条结果里实际有值的字段标识；任务按字段累计产出。
	Fields []string `json:"fields,omitempty"`
}

// AIAnalyzer 是 metadata / embedding / ocr / face 模块的扩展边界。
// 每个模块提供独立版本号，版本变化只会使本模块的结果失效。
type AIAnalyzer interface {
	Type() string
	Version() string
	Analyze(context.Context, io.ReadSeeker) (AIAnalysisOutput, error)
}

// AIAnalyzerBatch 可选地覆盖同一任务提交批次的推理，供 GPU 模块调用常驻 Worker。
type AIAnalyzerBatch interface {
	AnalyzeBatch(context.Context, []AIAnalysisInput) ([]AIAnalysisOutput, error)
}

// AIAnalyzerHardware validates and executes a task using its captured device mode.
type AIAnalyzerHardware interface {
	ValidateHardware(context.Context, string) error
}

type AIAnalyzerModelVersion interface {
	VersionForModel(string) (string, bool)
}

type AIAnalyzerModelReadiness interface {
	ReadyForModel(context.Context, string) error
}

type AIAnalyzerModelAvailability interface {
	AvailableForModel(string) (bool, string)
}

type AIAnalysisInput struct {
	ResourceID    string
	Path          string
	AnalysisPath  string
	Size          int64
	MTimeNs       int64
	ComputeDevice string
	FaceModel     string
}

// AIImageConverter converts formats that the local image worker cannot decode.
type AIImageConverter interface {
	Available() bool
	ConvertJPEGBytesContext(context.Context, string, int) ([]byte, error)
}

type AIAnalyzerReadiness interface {
	Ready(context.Context) error
}

// AIAnalyzerAvailability reports whether an optional module's local runtime and models are ready.
type AIAnalyzerAvailability interface {
	Available() (bool, string)
}

type AIAnalyzerRecordValidator interface {
	RecordCurrent(AIAnalysisRecord) bool
}

type AIAnalyzerWorkerLimit interface {
	MaxWorkers() int
}

type AIAnalyzerCloser interface {
	Close() error
}

// aiAnalyzerReadyTimeout 是就绪检查的期限。
//
// 就绪检查可能触发模型权重校验或首次加载，不能让它无限期挂着。
const aiAnalyzerReadyTimeout = 20 * time.Second

// probeAnalyzerModelReady 检查人脸任务选中的模型是否就绪。
//
// 没实现模型级就绪检查的分析器一律视为就绪 —— 它没有按模型区分的准备步骤。
func probeAnalyzerModelReady(ctx context.Context, analyzer AIAnalyzer, faceModel string) error {
	readiness, ok := analyzer.(AIAnalyzerModelReadiness)
	if !ok {
		return nil
	}
	readyCtx, cancel := context.WithTimeout(ctx, aiAnalyzerReadyTimeout)
	defer cancel()
	return readiness.ReadyForModel(readyCtx, faceModel)
}

// probeAnalyzerModuleReady 检查模块自身的运行时与权重是否就绪。
//
// 没实现模块级就绪检查的分析器一律视为就绪。
func probeAnalyzerModuleReady(ctx context.Context, analyzer AIAnalyzer) error {
	readiness, ok := analyzer.(AIAnalyzerReadiness)
	if !ok {
		return nil
	}
	readyCtx, cancel := context.WithTimeout(ctx, aiAnalyzerReadyTimeout)
	defer cancel()
	return readiness.Ready(readyCtx)
}

// probeAnalyzerReady 检查一个分析模块是否可以开跑。
//
// 人脸任务先按选中的模型探：两个模型的权重不同，准备步骤也不同。
// 模型级检查不存在时退回模块级检查；两者都没有就认为就绪。
//
// 启动任务、按序启动全部任务与每日计划都走这一条判据。
func probeAnalyzerReady(ctx context.Context, analyzer AIAnalyzer, moduleType, faceModel string) error {
	if analyzer == nil {
		return ErrAIAnalyzerUnavailable
	}
	if moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait {
		if _, ok := analyzer.(AIAnalyzerModelReadiness); ok {
			return probeAnalyzerModelReady(ctx, analyzer, faceModel)
		}
	}
	return probeAnalyzerModuleReady(ctx, analyzer)
}

// MetadataAnalyzer 使用 EXIF 解析器实现 metadata 模块。
type MetadataAnalyzer struct{}

func (MetadataAnalyzer) Type() string { return AIJobTypeMetadata }

func (MetadataAnalyzer) Version() string { return MetadataParserVersion }

func (MetadataAnalyzer) Analyze(ctx context.Context, reader io.ReadSeeker) (AIAnalysisOutput, error) {
	if err := ctx.Err(); err != nil {
		return AIAnalysisOutput{}, err
	}
	metadata, err := ParseImageMetadata(reader)
	if err != nil {
		return AIAnalysisOutput{}, err
	}
	data, err := json.Marshal(metadata)
	if err != nil {
		return AIAnalysisOutput{}, err
	}
	return AIAnalysisOutput{Status: metadata.Status, Data: data, Fields: metadataFields(metadata)}, nil
}

// metadataFields 报告这条元数据里实际有值的字段。
func metadataFields(metadata ImageMetadata) []string {
	fields := make([]string, 0, 3)
	if metadata.DateTimeOriginal != "" {
		fields = append(fields, AIFieldExifTime)
	}
	if metadata.CameraMake != "" || metadata.CameraModel != "" {
		fields = append(fields, AIFieldCamera)
	}
	if metadata.GPS != nil {
		fields = append(fields, AIFieldGPS)
	}
	return fields
}

// AIJobCheckpoint 是某个模块任务的独立恢复游标。
type AIJobCheckpoint struct {
	Offset         int    `json:"offset"`
	LastResourceID string `json:"lastResourceId,omitempty"`
	TargetDigest   string `json:"targetDigest,omitempty"`
	Batch          int    `json:"batch"`
	ModuleVersion  string `json:"moduleVersion"`
}

// AIJobError 保存资源 ID、根目录别名下的相对路径和脱敏原因，不保存绝对路径。
type AIJobError struct {
	ResourceID string    `json:"resourceId"`
	Path       string    `json:"path,omitempty"`
	Code       string    `json:"code"`
	Message    string    `json:"message"`
	At         time.Time `json:"at"`
}

// AIJob 是用户可查看的持久化任务记录。
type AIJob struct {
	ID      string `json:"id"`
	AlbumID string `json:"albumId,omitempty"`
	// ResourceIDs 限定本任务只处理这些资源。为空表示按相册或全库处理。
	//
	// 文件变化触发的自动分析用它把范围收窄到真正变动的照片：
	// 一次文件新增不该让整个图库重新排队。
	ResourceIDs           []string        `json:"resourceIds,omitempty"`
	Type                  string          `json:"type"`
	Mode                  string          `json:"mode"`
	Status                string          `json:"status"`
	Stage                 string          `json:"stage"`
	ModuleVersion         string          `json:"moduleVersion"`
	FaceModel             string          `json:"faceModel,omitempty"`
	Total                 int             `json:"total"`
	Processed             int             `json:"processed"`
	Skipped               int             `json:"skipped"`
	Failed                int             `json:"failed"`
	Done                  int             `json:"done"`
	CurrentResourceID     string          `json:"currentResourceId,omitempty"`
	Checkpoint            AIJobCheckpoint `json:"checkpoint"`
	RecoveredAfterRestart bool            `json:"recoveredAfterRestart,omitempty"`
	Errors                []AIJobError    `json:"errors,omitempty"`
	Error                 string          `json:"error,omitempty"`
	ErrorCode             string          `json:"errorCode,omitempty"`
	ComputeDevice         string          `json:"computeDevice"`
	Scheduled             bool            `json:"scheduled,omitempty"`
	RetryOf               string          `json:"retryOf,omitempty"`
	RetryFailedOnly       bool            `json:"retryFailedOnly,omitempty"`
	RetryFromOffset       int             `json:"retryFromOffset,omitempty"`
	StartedAt             *time.Time      `json:"startedAt,omitempty"`
	FinishedAt            *time.Time      `json:"finishedAt,omitempty"`
	CreatedAt             time.Time       `json:"createdAt"`
	UpdatedAt             time.Time       `json:"updatedAt"`
	ElapsedMs             int64           `json:"elapsedMs"`
	SpeedPerSecond        float64         `json:"speedPerSecond"`
	// Planned 是本次任务实际要处理的张数，Completed 是已处理张数。
	// 两者由快照按持久化计数推导，不作为事实落盘。
	Planned   int `json:"planned"`
	Completed int `json:"completed"`
	// EstimatedRemainingMs 是运行中任务的预计剩余毫秒，同样是快照派生值。
	EstimatedRemainingMs int64 `json:"estimatedRemainingMs"`
	// Results 按解析结果分类计数，Fields 按字段统计产出；两者是事实，落盘保留。
	Results map[string]int `json:"results,omitempty"`
	Fields  map[string]int `json:"fields,omitempty"`
}

// AIJobSettings 放在 state/，不属于可重建的 derived 数据。
type AIJobSettings struct {
	DailyEnabled        bool     `json:"dailyEnabled"`
	DailyTime           string   `json:"dailyTime"`
	DailyModules        []string `json:"dailyModules"`
	DailyScan           bool     `json:"dailyScan"`
	DailySmartAlbums    bool     `json:"dailySmartAlbums"`
	PeopleEnabled       bool     `json:"peopleEnabled"`
	GPUEnabled          bool     `json:"gpuEnabled"`
	FaceModel           string   `json:"faceModel"`
	LastScheduledDate   string   `json:"lastScheduledDate,omitempty"`
	LastScheduledStatus string   `json:"lastScheduledStatus,omitempty"`
	LastScheduledStage  string   `json:"lastScheduledStage,omitempty"`
	LastScheduledError  string   `json:"lastScheduledError,omitempty"`
	gpuEnabledSet       bool
}

func (s *AIJobSettings) UnmarshalJSON(data []byte) error {
	type plain AIJobSettings
	var value plain
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	*s = AIJobSettings(value)
	var fields map[string]json.RawMessage
	if err := json.Unmarshal(data, &fields); err != nil {
		return err
	}
	_, s.gpuEnabledSet = fields["gpuEnabled"]
	if _, exists := fields["dailyScan"]; !exists {
		s.DailyScan = true
	}
	if _, exists := fields["dailySmartAlbums"]; !exists {
		s.DailySmartAlbums = true
	}
	return nil
}

type AIJobSnapshot struct {
	Jobs     []AIJob       `json:"jobs"`
	Active   *AIJob        `json:"active,omitempty"`
	Queue    []string      `json:"queue"`
	Settings AIJobSettings `json:"settings"`
	// Modules 列出全部已知分析模块及其安装状态，前端不再硬编码模块名。
	Modules []AIJobModule `json:"modules"`
}

// AIJobModule 描述一个分析模块的安装情况。
type AIJobModule struct {
	Type      string `json:"type"`
	Name      string `json:"name"`
	Installed bool   `json:"installed"`
	Version   string `json:"version,omitempty"`
	Reason    string `json:"reason,omitempty"`
}

// AIAnalysisRecord 是 derived/metadata 中可重建的单资源分析结果。
type AIAnalysisRecord struct {
	Type          string          `json:"type"`
	ResourceID    string          `json:"resourceId"`
	Size          int64           `json:"size"`
	MTimeNs       int64           `json:"mtimeNs"`
	ModuleVersion string          `json:"moduleVersion"`
	Status        string          `json:"status"`
	Data          json.RawMessage `json:"data,omitempty"`
	ErrorCode     string          `json:"errorCode,omitempty"`
	ErrorMessage  string          `json:"errorMessage,omitempty"`
	UpdatedAt     time.Time       `json:"updatedAt"`
	// Fields 记录这条结果里实际有值的字段；批次重放要靠它还原任务产出。
	Fields []string `json:"fields,omitempty"`
}

// AIAnalysisRecordSummary exposes only the small freshness fields needed by a
// folder-scoped index; it deliberately omits the potentially large face data.
type AIAnalysisRecordSummary struct {
	Type          string `json:"type"`
	ResourceID    string `json:"resourceId"`
	Size          int64  `json:"size"`
	MTimeNs       int64  `json:"mtimeNs"`
	ModuleVersion string `json:"moduleVersion"`
	Status        string `json:"status"`
}

type AIJobServiceOptions struct {
	StatePath          string
	MetadataDir        string
	Catalog            *ResourceCatalog
	ValidatePath       func(string) (string, error)
	Analyzers          []AIAnalyzer
	WorkerCount        int
	Now                func() time.Time
	OnRecordsCommitted func([]AIAnalysisRecord)
	// OnJobSettled 在任务走到终态（完成、失败、取消）时调用一次，
	// 让按批次攒出来的派生数据在任务收尾时整体重建一次。
	OnJobSettled func(jobType string)
	// OnRecordsCleared 在某个模块的派生结果被整体删除后调用，
	// 让按目录统计的占用缓存重新扫描。
	OnRecordsCleared func()
	ImageConverter   AIImageConverter
}

// AIJobService 持久化分析任务，并通过有界 worker 处理图片元数据。
type AIJobService struct {
	mu                 sync.Mutex
	statePath          string
	metadataDir        string
	catalog            *ResourceCatalog
	validatePath       func(string) (string, error)
	imageConverter     AIImageConverter
	analyzers          map[string]AIAnalyzer
	workerCount        int
	now                func() time.Time
	onRecordsCommitted func([]AIAnalysisRecord)
	onJobSettled       func(jobType string)
	onRecordsCleared   func()
	jobs               map[string]*AIJob
	order              []string
	queue              []string
	records            map[string]AIAnalysisRecord
	// recordFiles 记录每条分析结果落在哪个批次文件里。
	// 资源从图库里消失后要能把它的结果从批次文件里一并删掉，
	// 否则重启时旧结果会被重新读回来。
	recordFiles map[string]string
	// recordsRevision 在分析结果增删改时递增。
	// 依赖分析结果的派生数据（如离线地点图谱）用它判断缓存是否过期。
	recordsRevision  uint64
	runtimes         map[string]*aiJobRuntime
	subs             map[string]map[chan AIJob]struct{}
	activeID         string
	closed           bool
	settings         AIJobSettings
	stopSchedule     context.CancelFunc
	scheduleContext  context.Context
	dailyPlanActive  bool
	dailyScan        func(context.Context) error
	dailySmartAlbums func(context.Context) error
	closeOnce        sync.Once
	wg               sync.WaitGroup
	// targetCache 是文件指纹清单的短时缓存，只服务空闲时的规模预估。
	// 它有自己的锁，避免把 stat 的等待混进任务状态锁。
	targetCacheMu sync.Mutex
	targetCache   *aiTargetCache
}

func NewAIJobService(options AIJobServiceOptions) (*AIJobService, error) {
	if options.StatePath == "" || options.MetadataDir == "" || options.Catalog == nil || options.ValidatePath == nil {
		return nil, errors.New("AI job service requires state, metadata, catalog, and path validation")
	}
	if options.Now == nil {
		options.Now = time.Now
	}
	if options.WorkerCount <= 0 {
		options.WorkerCount = aiWorkerCount()
	}
	options.WorkerCount = min(options.WorkerCount, aiMaxWorkers)

	service := &AIJobService{
		statePath:          options.StatePath,
		metadataDir:        options.MetadataDir,
		catalog:            options.Catalog,
		validatePath:       options.ValidatePath,
		imageConverter:     options.ImageConverter,
		analyzers:          make(map[string]AIAnalyzer, len(options.Analyzers)),
		workerCount:        options.WorkerCount,
		now:                options.Now,
		onRecordsCommitted: options.OnRecordsCommitted,
		onJobSettled:       options.OnJobSettled,
		onRecordsCleared:   options.OnRecordsCleared,
		jobs:               make(map[string]*AIJob),
		records:            make(map[string]AIAnalysisRecord),
		recordFiles:        make(map[string]string),
		runtimes:           make(map[string]*aiJobRuntime),
		subs:               make(map[string]map[chan AIJob]struct{}),
		settings: AIJobSettings{
			DailyEnabled: true, DailyTime: "03:00", DailyModules: []string{AIJobTypeMetadata},
			DailyScan: true, DailySmartAlbums: true, GPUEnabled: true, FaceModel: DefaultFaceModel,
		},
	}
	for _, analyzer := range options.Analyzers {
		if analyzer == nil || !validAIJobType(analyzer.Type()) || strings.TrimSpace(analyzer.Version()) == "" {
			return nil, errors.New("AI analyzer has invalid type or version")
		}
		if _, exists := service.analyzers[analyzer.Type()]; exists {
			return nil, fmt.Errorf("duplicate AI analyzer type %q", analyzer.Type())
		}
		service.analyzers[analyzer.Type()] = analyzer
	}
	if _, exists := service.analyzers[AIJobTypeMetadata]; !exists {
		return nil, errors.New("metadata analyzer is required")
	}
	if err := os.MkdirAll(options.MetadataDir, 0o755); err != nil {
		return nil, fmt.Errorf("create metadata directory: %w", err)
	}
	if err := service.loadState(); err != nil {
		return nil, err
	}
	if err := service.migrateLegacyFaceBatches(); err != nil {
		return nil, err
	}
	if err := service.loadRecords(); err != nil {
		return nil, err
	}
	service.recoverInterruptedJobs()
	return service, nil
}

// Start 创建并启动已注册分析模块的全量或增量任务。
func (s *AIJobService) Start(moduleType, mode string, albumIDs ...string) (AIJob, bool, error) {
	albumID, err := s.analysisAlbumID(albumIDs)
	if err != nil {
		return AIJob{}, false, err
	}
	return s.startAnalysis(moduleType, mode, albumID, nil)
}

// StartForResources 启动一个只处理给定资源的增量任务。
//
// 文件变化触发的自动分析走这条路径：范围收窄到真正变动的照片，
// 一次文件新增不会让整个图库重新排队。任务内部仍按文件指纹判断，
// 没变过的照片会被跳过而不是重算。
func (s *AIJobService) StartForResources(moduleType string, resourceIDs []string) (AIJob, bool, error) {
	unique := make([]string, 0, len(resourceIDs))
	seen := make(map[string]struct{}, len(resourceIDs))
	for _, id := range resourceIDs {
		if id == "" {
			continue
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		unique = append(unique, id)
	}
	if len(unique) == 0 {
		return AIJob{}, false, errors.New("analysis resource list is empty")
	}
	sort.Strings(unique)
	return s.startAnalysis(moduleType, AIJobModeIncremental, "", unique)
}

// startAnalysis 是创建分析任务的唯一入口。
func (s *AIJobService) startAnalysis(moduleType, mode, albumID string, resourceIDs []string) (AIJob, bool, error) {
	if mode != AIJobModeFull && mode != AIJobModeIncremental {
		return AIJob{}, false, errors.New("unknown analysis mode")
	}
	if albumID != "" {
		if err := s.validateAnalysisAlbum(albumID); err != nil {
			return AIJob{}, false, err
		}
	}
	if (moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait) && !s.PeopleEnabled() {
		return AIJob{}, false, ErrPeopleAnalysisDisabled
	}
	analyzer, exists := s.analyzers[moduleType]
	if !exists {
		if validAIJobType(moduleType) {
			return AIJob{}, false, fmt.Errorf("analysis module %q is not installed", moduleType)
		}
		return AIJob{}, false, errors.New("unknown analysis module")
	}
	faceModel := DefaultFaceModel
	if moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait {
		faceModel = s.FaceModel()
	}
	if available, _ := aiAnalyzerAvailabilityForModel(analyzer, faceModel); !available {
		return AIJob{}, false, ErrAIAnalyzerUnavailable
	}
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return AIJob{}, false, errAIJobServiceClosed
	}
	if err := probeAnalyzerReady(context.Background(), analyzer, moduleType, faceModel); err != nil {
		return AIJob{}, false, err
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJob{}, false, errAIJobServiceClosed
	}
	if (moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait) && s.settings.FaceModel != faceModel {
		return AIJob{}, false, ErrAIJobActive
	}
	if s.dailyPlanActive {
		return AIJob{}, false, ErrAIJobActive
	}
	if (moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait) && !s.settings.PeopleEnabled {
		return AIJob{}, false, ErrPeopleAnalysisDisabled
	}
	if s.activeID != "" {
		active := s.jobs[s.activeID]
		if active != nil && active.Type == moduleType && active.Mode == mode &&
			active.AlbumID == albumID && sameResourceSet(active.ResourceIDs, resourceIDs) &&
			isAIJobActive(active.Status) {
			return s.snapshotLocked(active), true, nil
		}
		return AIJob{}, false, ErrAIJobActive
	}
	if s.hasPendingJobsLocked() {
		return AIJob{}, false, ErrAIJobActive
	}
	job := s.newJobLocked(moduleType, mode)
	job.AlbumID = albumID
	job.ResourceIDs = append([]string(nil), resourceIDs...)
	s.jobs[job.ID] = &job
	s.order = append(s.order, job.ID)
	s.activeID = job.ID
	if err := s.persistLocked(); err != nil {
		delete(s.jobs, job.ID)
		s.order = s.order[:len(s.order)-1]
		s.activeID = ""
		return AIJob{}, false, err
	}
	s.launchLocked(job.ID)
	return s.snapshotLocked(&job), false, nil
}

// sameResourceSet 比较两个资源集合是否一致。
func sameResourceSet(left, right []string) bool {
	return slices.Equal(left, right)
}

// StartAll 按固定模块顺序把所有已就绪的分析任务写入现有任务队列。
func (s *AIJobService) StartAll(mode string, albumIDs ...string) ([]AIJob, []AIJobModule, error) {
	albumID, err := s.analysisAlbumID(albumIDs)
	if err != nil {
		return nil, nil, err
	}
	if mode != AIJobModeFull && mode != AIJobModeIncremental {
		return nil, nil, errors.New("unknown analysis mode")
	}
	if albumID != "" {
		if err := s.validateAnalysisAlbum(albumID); err != nil {
			return nil, nil, err
		}
	}
	moduleTypes := []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypeSimilarity}
	if albumID == "" {
		for _, t := range []string{AIJobTypeComicCover, AIJobTypeComicMeta} {
			if s.analyzers[t] != nil {
				moduleTypes = append(moduleTypes, t)
			}
		}
	}
	if albumID == "" && s.analyzers[AIJobTypeAlbumCover] != nil {
		moduleTypes = append(moduleTypes, AIJobTypeAlbumCover)
	}
	if albumID != "" {
		// Album regrouping only needs EXIF/GPS, scene vectors, and face groups.
		// OCR remains a separate user-requested task.
		moduleTypes = []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeFace, AIJobTypeSimilarity}
	}
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil, nil, errAIJobServiceClosed
	}
	if s.dailyPlanActive {
		s.mu.Unlock()
		return nil, nil, ErrAIJobActive
	}
	if s.hasPendingJobsLocked() {
		s.mu.Unlock()
		return nil, nil, ErrAIJobActive
	}
	peopleEnabled := s.settings.PeopleEnabled
	faceModel := s.settings.FaceModel
	analyzers := make(map[string]AIAnalyzer, len(moduleTypes))
	for _, moduleType := range moduleTypes {
		analyzers[moduleType] = s.analyzers[moduleType]
	}
	s.mu.Unlock()

	readyModules := make([]string, 0, len(moduleTypes))
	skippedModules := make([]AIJobModule, 0)
	for _, moduleType := range moduleTypes {
		if (moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait) && !peopleEnabled {
			skippedModules = append(skippedModules, AIJobModule{
				Type: moduleType, Name: aiJobModuleName(moduleType), Reason: "people_analysis_disabled",
			})
			continue
		}
		analyzer := analyzers[moduleType]
		if analyzer == nil {
			skippedModules = append(skippedModules, AIJobModule{
				Type: moduleType, Name: aiJobModuleName(moduleType), Reason: "module_not_registered",
			})
			continue
		}
		if available, reason := aiAnalyzerAvailabilityForModel(analyzer, faceModel); !available {
			skippedModules = append(skippedModules, AIJobModule{
				Type: moduleType, Name: aiJobModuleName(moduleType), Reason: reason,
			})
			continue
		}
		if err := probeAnalyzerReady(context.Background(), analyzer, moduleType, faceModel); err != nil {
			_, reason := aiAnalyzerAvailabilityForModel(analyzer, faceModel)
			if reason == "" {
				reason = "runtime_unavailable"
			}
			skippedModules = append(skippedModules, AIJobModule{
				Type: moduleType, Name: aiJobModuleName(moduleType), Reason: reason,
			})
			continue
		}
		readyModules = append(readyModules, moduleType)
	}
	if len(readyModules) == 0 {
		return nil, skippedModules, ErrAIAnalyzerUnavailable
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return nil, nil, errAIJobServiceClosed
	}
	if s.dailyPlanActive {
		return nil, nil, ErrAIJobActive
	}
	if s.settings.FaceModel != faceModel {
		return nil, nil, ErrAIJobActive
	}
	if s.hasPendingJobsLocked() {
		return nil, nil, ErrAIJobActive
	}
	previousOrderLength := len(s.order)
	previousQueue := append([]string(nil), s.queue...)
	jobIDs := make([]string, 0, len(readyModules))
	for _, moduleType := range readyModules {
		job := s.newJobLocked(moduleType, mode)
		job.AlbumID = albumID
		s.jobs[job.ID] = &job
		s.order = append(s.order, job.ID)
		jobIDs = append(jobIDs, job.ID)
	}
	s.activeID = jobIDs[0]
	s.queue = append([]string(nil), jobIDs[1:]...)
	if err := s.persistLocked(); err != nil {
		for _, id := range jobIDs {
			delete(s.jobs, id)
		}
		s.order = s.order[:previousOrderLength]
		s.queue = previousQueue
		s.activeID = ""
		return nil, nil, err
	}
	s.launchLocked(jobIDs[0])
	jobs := make([]AIJob, 0, len(jobIDs))
	for _, id := range jobIDs {
		jobs = append(jobs, s.snapshotLocked(s.jobs[id]))
	}
	return jobs, skippedModules, nil
}

func (s *AIJobService) hasPendingJobsLocked() bool {
	if s.activeID != "" {
		return true
	}
	for _, job := range s.jobs {
		if isAIJobActive(job.Status) || job.Status == AIJobStatusPending {
			return true
		}
	}
	return false
}

// Pause 请求在当前批次原子提交后暂停任务。
func (s *AIJobService) Pause(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	runtimeState := s.runtimes[id]
	if job == nil || !isAIJobActive(job.Status) || job.Status == AIJobStatusPaused {
		return false
	}
	if runtimeState == nil {
		if job.Status != AIJobStatusRunning {
			return false
		}
		previousStage, previousStatus, previousUpdated, previousActive := job.Stage, job.Status, job.UpdatedAt, s.activeID
		job.Status = AIJobStatusPaused
		job.Stage = AIJobStatusPaused
		job.UpdatedAt = s.now()
		if s.activeID == "" {
			s.activeID = id
		}
		if err := s.persistLocked(); err != nil {
			job.Stage, job.Status, job.UpdatedAt = previousStage, previousStatus, previousUpdated
			s.activeID = previousActive
			return false
		}
		s.publishLocked(*job)
		return true
	}
	previousStage, previousUpdated := job.Stage, job.UpdatedAt
	runtimeState.pauseRequested = true
	job.Stage = "pausing"
	job.UpdatedAt = s.now()
	if err := s.persistLocked(); err != nil {
		runtimeState.pauseRequested = false
		job.Stage, job.UpdatedAt = previousStage, previousUpdated
		return false
	}
	s.publishLocked(*job)
	return true
}

// Resume 恢复一个暂停任务；重启后持久化的 paused 任务会新建 runner。
func (s *AIJobService) Resume(id string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil || job.Status != AIJobStatusPaused || s.closed {
		return false
	}
	if s.activeID != "" && s.activeID != id {
		return false
	}
	s.activeID = id
	if runtimeState := s.runtimes[id]; runtimeState != nil {
		previousStage, previousStatus, previousUpdated := job.Stage, job.Status, job.UpdatedAt
		runtimeState.pauseRequested = false
		job.Status = AIJobStatusRunning
		job.Stage = "processing"
		job.UpdatedAt = s.now()
		if err := s.persistLocked(); err != nil {
			runtimeState.pauseRequested = true
			job.Status, job.Stage, job.UpdatedAt = previousStatus, previousStage, previousUpdated
			return false
		}
		s.publishLocked(*job)
		select {
		case runtimeState.resume <- struct{}{}:
		default:
		}
		return true
	}
	job.Status = AIJobStatusPending
	job.Stage = "pending"
	job.UpdatedAt = s.now()
	if err := s.persistLocked(); err != nil {
		job.Status = AIJobStatusPaused
		return false
	}
	s.publishLocked(*job)
	s.launchLocked(id)
	return true
}

// Cancel 取消任务；已提交批次保留，未提交的当前批次会幂等重跑。
func (s *AIJobService) Cancel(id string) bool {
	s.mu.Lock()
	job := s.jobs[id]
	runtimeState := s.runtimes[id]
	if job == nil || !isAIJobActive(job.Status) {
		s.mu.Unlock()
		return false
	}
	if job.Status == AIJobStatusPending && runtimeState == nil {
		queueIndex := slices.Index(s.queue, id)
		if queueIndex < 0 {
			s.mu.Unlock()
			return false
		}
		previousQueue := append([]string(nil), s.queue...)
		previousStatus, previousStage, previousUpdated, previousFinished := job.Status, job.Stage, job.UpdatedAt, job.FinishedAt
		s.queue = slices.Delete(s.queue, queueIndex, queueIndex+1)
		job.Status = AIJobStatusCancelled
		job.Stage = AIJobStatusCancelled
		finished := s.now()
		job.FinishedAt = &finished
		job.UpdatedAt = finished
		if err := s.persistLocked(); err != nil {
			s.queue = previousQueue
			job.Status, job.Stage, job.UpdatedAt, job.FinishedAt = previousStatus, previousStage, previousUpdated, previousFinished
			s.mu.Unlock()
			return false
		}
		s.publishLocked(*job)
		s.mu.Unlock()
		return true
	}
	if runtimeState == nil {
		if job.Status != AIJobStatusPaused {
			s.mu.Unlock()
			return false
		}
		previousStatus, previousStage, previousUpdated, previousFinished, previousActive := job.Status, job.Stage, job.UpdatedAt, job.FinishedAt, s.activeID
		job.Status = AIJobStatusCancelled
		job.Stage = AIJobStatusCancelled
		finished := s.now()
		job.FinishedAt = &finished
		job.UpdatedAt = finished
		if s.activeID == id {
			s.activeID = ""
		}
		if err := s.persistLocked(); err != nil {
			job.Status, job.Stage, job.UpdatedAt, job.FinishedAt = previousStatus, previousStage, previousUpdated, previousFinished
			s.activeID = previousActive
			s.mu.Unlock()
			return false
		}
		s.publishLocked(*job)
		s.mu.Unlock()
		s.StartPending()
		return true
	}
	runtimeState.stopReason = "user"
	runtimeState.cancel()
	s.mu.Unlock()
	return true
}

// MovePending moves a queued task one position up or down.
func (s *AIJobService) MovePending(id, direction string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return ErrAIJobNotFound
	}
	if job.Status != AIJobStatusPending {
		return ErrAIJobNotManageable
	}
	index := slices.Index(s.queue, id)
	if index < 0 {
		return ErrAIJobNotManageable
	}
	target := index
	switch direction {
	case "up":
		target--
	case "down":
		target++
	default:
		return ErrAIJobInvalidDirection
	}
	if target < 0 || target >= len(s.queue) {
		return ErrAIJobNotManageable
	}
	s.queue[index], s.queue[target] = s.queue[target], s.queue[index]
	if err := s.persistLocked(); err != nil {
		s.queue[index], s.queue[target] = s.queue[target], s.queue[index]
		return err
	}
	return nil
}

// ClearPending cancels all waiting tasks while leaving the active task untouched.
func (s *AIJobService) ClearPending() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.queue) == 0 {
		return 0, nil
	}
	previousQueue := append([]string(nil), s.queue...)
	type previousJobState struct {
		job      *AIJob
		status   string
		stage    string
		updated  time.Time
		finished *time.Time
	}
	previous := make([]previousJobState, 0, len(s.queue))
	finished := s.now()
	for _, id := range s.queue {
		job := s.jobs[id]
		if job == nil || job.Status != AIJobStatusPending {
			continue
		}
		previous = append(previous, previousJobState{job: job, status: job.Status, stage: job.Stage, updated: job.UpdatedAt, finished: job.FinishedAt})
		job.Status = AIJobStatusCancelled
		job.Stage = AIJobStatusCancelled
		job.FinishedAt = &finished
		job.UpdatedAt = finished
	}
	s.queue = nil
	if err := s.persistLocked(); err != nil {
		s.queue = previousQueue
		for _, state := range previous {
			state.job.Status, state.job.Stage, state.job.UpdatedAt, state.job.FinishedAt = state.status, state.stage, state.updated, state.finished
		}
		return 0, err
	}
	for _, state := range previous {
		s.publishLocked(*state.job)
	}
	return len(previous), nil
}

// DeleteHistory deletes one terminal task record without touching its analysis results.
func (s *AIJobService) DeleteHistory(id string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return ErrAIJobNotFound
	}
	if !isAIJobTerminal(job.Status) {
		return ErrAIJobNotManageable
	}
	previousOrder := append([]string(nil), s.order...)
	delete(s.jobs, id)
	s.order = slices.DeleteFunc(s.order, func(value string) bool { return value == id })
	if err := s.persistLocked(); err != nil {
		s.jobs[id] = job
		s.order = previousOrder
		return err
	}
	return nil
}

// ClearHistory deletes terminal task records while preserving pending and active tasks.
func (s *AIJobService) ClearHistory() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	deleted := make(map[string]*AIJob)
	keptOrder := make([]string, 0, len(s.order))
	for _, id := range s.order {
		job := s.jobs[id]
		if job != nil && isAIJobTerminal(job.Status) {
			deleted[id] = job
			continue
		}
		keptOrder = append(keptOrder, id)
	}
	if len(deleted) == 0 {
		return 0, nil
	}
	previousOrder := s.order
	for id := range deleted {
		delete(s.jobs, id)
	}
	s.order = keptOrder
	if err := s.persistLocked(); err != nil {
		for id, job := range deleted {
			s.jobs[id] = job
		}
		s.order = previousOrder
		return 0, err
	}
	return len(deleted), nil
}

func isAIJobTerminal(status string) bool {
	return status == AIJobStatusCompleted || status == AIJobStatusFailed || status == AIJobStatusCancelled
}

// Retry 从失败或取消任务创建新的历史项，只重试失败记录与未提交尾段。
func (s *AIJobService) Retry(id string) (AIJob, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJob{}, errAIJobServiceClosed
	}
	if s.hasPendingJobsLocked() {
		return AIJob{}, ErrAIJobActive
	}
	previous := s.jobs[id]
	if previous == nil {
		return AIJob{}, ErrAIJobNotFound
	}
	if previous.Status != AIJobStatusFailed && previous.Status != AIJobStatusCancelled {
		return AIJob{}, errors.New("only failed or cancelled jobs can be retried")
	}
	job := s.newJobLocked(previous.Type, previous.Mode)
	if previous.Type == AIJobTypeFace {
		job.FaceModel = previous.FaceModel
		if job.FaceModel == "" {
			job.FaceModel = DefaultFaceModel
		}
		job.ModuleVersion = aiAnalyzerVersion(s.analyzers[previous.Type], job.FaceModel)
		job.Checkpoint.ModuleVersion = job.ModuleVersion
	}
	job.AlbumID = previous.AlbumID
	job.RetryOf = previous.ID
	job.RetryFailedOnly = true
	job.RetryFromOffset = previous.Checkpoint.Offset
	s.jobs[job.ID] = &job
	s.order = append(s.order, job.ID)
	s.activeID = job.ID
	if err := s.persistLocked(); err != nil {
		delete(s.jobs, job.ID)
		s.order = s.order[:len(s.order)-1]
		s.activeID = ""
		return AIJob{}, err
	}
	s.launchLocked(job.ID)
	return s.snapshotLocked(&job), nil
}

func (s *AIJobService) Get(id string) (AIJob, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[id]
	if job == nil {
		return AIJob{}, false
	}
	return s.snapshotLocked(job), true
}

func (s *AIJobService) List() AIJobSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := AIJobSnapshot{
		Settings: s.copySettingsLocked(),
		Jobs:     make([]AIJob, 0, len(s.order)),
		Queue:    append([]string{}, s.queue...),
		Modules:  s.modulesLocked(),
	}
	for index := len(s.order) - 1; index >= 0; index-- {
		if job := s.jobs[s.order[index]]; job != nil {
			copy := s.snapshotLocked(job)
			result.Jobs = append(result.Jobs, copy)
			if job.ID == s.activeID && isAIJobActive(job.Status) {
				active := copy
				result.Active = &active
			} else if result.Active == nil && (job.Status == AIJobStatusRunning || job.Status == AIJobStatusPaused) {
				active := copy
				result.Active = &active
			}
		}
	}
	return result
}

// modulesLocked 列出全部已知分析模块及其安装情况。
func (s *AIJobService) modulesLocked() []AIJobModule {
	known := []string{AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypeSimilarity}
	for _, t := range []string{AIJobTypeComicCover, AIJobTypeComicMeta} {
		if s.analyzers[t] != nil {
			known = append(known, t)
		}
	}
	if s.analyzers[AIJobTypePortrait] != nil {
		known = append(known, AIJobTypePortrait)
	}
	if s.analyzers[AIJobTypeAlbumCover] != nil {
		known = append(known, AIJobTypeAlbumCover)
	}
	modules := make([]AIJobModule, 0, len(known))
	for _, moduleType := range known {
		module := AIJobModule{Type: moduleType, Name: aiJobModuleName(moduleType)}
		if analyzer, exists := s.analyzers[moduleType]; exists {
			module.Installed, module.Reason = aiAnalyzerAvailabilityForModel(analyzer, s.settings.FaceModel)
			if module.Installed {
				module.Version = aiAnalyzerVersion(analyzer, s.settings.FaceModel)
			}
		}
		modules = append(modules, module)
	}
	return modules
}

func aiAnalyzerAvailable(analyzer AIAnalyzer) bool {
	available, _ := aiAnalyzerAvailability(analyzer)
	return available
}

func aiAnalyzerAvailability(analyzer AIAnalyzer) (bool, string) {
	if availability, ok := analyzer.(AIAnalyzerAvailability); ok {
		return availability.Available()
	}
	return true, ""
}

func aiAnalyzerAvailabilityForModel(analyzer AIAnalyzer, model string) (bool, string) {
	if availability, ok := analyzer.(AIAnalyzerModelAvailability); ok && (analyzer.Type() == AIJobTypeFace || analyzer.Type() == AIJobTypePortrait) {
		return availability.AvailableForModel(model)
	}
	return aiAnalyzerAvailability(analyzer)
}

func aiAnalyzerVersion(analyzer AIAnalyzer, model string) string {
	if versioner, ok := analyzer.(AIAnalyzerModelVersion); ok && (analyzer.Type() == AIJobTypeFace || analyzer.Type() == AIJobTypePortrait) {
		if version, valid := versioner.VersionForModel(model); valid {
			return version
		}
	}
	return analyzer.Version()
}

// aiJobModuleName 给分析模块一个中文显示名。
func aiJobModuleName(moduleType string) string {
	switch moduleType {
	case AIJobTypeMetadata:
		return "照片元数据"
	case AIJobTypeEmbedding:
		return "向量索引"
	case AIJobTypeOCR:
		return "文字识别"
	case AIJobTypeComicCover:
		return "漫画封面精选"
	case AIJobTypeComicMeta:
		return "漫画内容识别"
	case AIJobTypeAlbumCover:
		return "相册封面精选"
	case AIJobTypePortrait:
		return "精选人物头像"
	case AIJobTypeFace:
		return "人脸识别"
	case AIJobTypeSimilarity:
		return "相似照片特征"
	default:
		return moduleType
	}
}

// SetGPUEnabled updates the hardware plan for newly created jobs. Existing queued
// jobs keep the device mode captured when they were created.
func (s *AIJobService) ComicGPUEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings.GPUEnabled
}
func (s *AIJobService) SetGPUEnabled(enabled bool) (AIJobSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJobSettings{}, errAIJobServiceClosed
	}
	previous := s.settings
	s.settings.GPUEnabled = enabled
	s.settings.gpuEnabledSet = true
	if err := s.persistLocked(); err != nil {
		s.settings = previous
		return AIJobSettings{}, err
	}
	return s.copySettingsLocked(), nil
}

func (s *AIJobService) FaceModel() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.settings.FaceModel == "" {
		return DefaultFaceModel
	}
	return s.settings.FaceModel
}

// SetFaceModel updates the profile used by newly created face analysis jobs.
func (s *AIJobService) SetFaceModel(model string) (AIJobSettings, error) {
	if _, valid := FaceAnalyzerVersionForModel(model); !valid {
		return AIJobSettings{}, errors.New("unknown face model")
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJobSettings{}, errAIJobServiceClosed
	}
	if s.dailyPlanActive || (hasActiveAIJobType(s.jobs, AIJobTypeFace) || hasActiveAIJobType(s.jobs, AIJobTypePortrait)) {
		return AIJobSettings{}, ErrAIJobActive
	}
	if s.settings.FaceModel == model {
		return s.copySettingsLocked(), nil
	}
	previous := s.settings
	s.settings.FaceModel = model
	if err := s.persistLocked(); err != nil {
		s.settings = previous
		return AIJobSettings{}, err
	}
	return s.copySettingsLocked(), nil
}

// PeopleEnabled reports whether face analysis has been explicitly enabled.
func (s *AIJobService) PeopleEnabled() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.settings.PeopleEnabled
}

// SetPeopleEnabled controls face analysis without changing other schedule settings.
func (s *AIJobService) SetPeopleEnabled(enabled bool) (AIJobSettings, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return AIJobSettings{}, errAIJobServiceClosed
	}
	if !enabled && (hasActiveAIJobType(s.jobs, AIJobTypeFace) || hasActiveAIJobType(s.jobs, AIJobTypePortrait)) {
		return AIJobSettings{}, ErrAIJobActive
	}
	previous := s.copySettingsLocked()
	s.settings.PeopleEnabled = enabled
	if !enabled {
		s.settings.DailyModules = withoutModule(withoutModule(s.settings.DailyModules, AIJobTypeFace), AIJobTypePortrait)
	}
	if err := s.persistLocked(); err != nil {
		s.settings = previous
		return AIJobSettings{}, err
	}
	return s.copySettingsLocked(), nil
}

// Subscribe 为单个客户端创建独立缓冲订阅，并立即发送任务快照。
func (s *AIJobService) Subscribe(id string) (<-chan AIJob, func(), bool) {
	s.mu.Lock()
	job := s.jobs[id]
	if job == nil {
		s.mu.Unlock()
		return nil, func() {}, false
	}
	channel := make(chan AIJob, 8)
	channel <- s.snapshotLocked(job)
	if isAIJobActive(job.Status) {
		if s.subs[id] == nil {
			s.subs[id] = make(map[chan AIJob]struct{})
		}
		s.subs[id][channel] = struct{}{}
	} else {
		close(channel)
	}
	s.mu.Unlock()

	unsubscribe := func() {
		s.mu.Lock()
		defer s.mu.Unlock()
		if subscribers := s.subs[id]; subscribers != nil {
			if _, exists := subscribers[channel]; exists {
				delete(subscribers, channel)
				close(channel)
			}
			if len(subscribers) == 0 {
				delete(s.subs, id)
			}
		}
	}
	return channel, unsubscribe, true
}

// StartPending 恢复启动时持久化的 pending 任务；调用时应已加载扫描快照。
func (s *AIJobService) StartPending() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed || s.activeID != "" {
		return
	}
	queue := s.queue
	if len(queue) == 0 {
		for _, id := range s.order {
			if job := s.jobs[id]; job != nil && job.Status == AIJobStatusPending {
				s.queue = append(s.queue, id)
			}
		}
		queue = s.queue
	}
	if len(queue) == 0 {
		return
	}
	id := queue[0]
	job := s.jobs[id]
	if job == nil || job.Status != AIJobStatusPending {
		s.queue = slices.Delete(s.queue, 0, 1)
		_ = s.persistLocked()
		return
	}
	previousQueue := append([]string(nil), s.queue...)
	s.queue = slices.Delete(s.queue, 0, 1)
	s.activeID = id
	if err := s.persistLocked(); err != nil {
		s.queue = previousQueue
		s.activeID = ""
		return
	}
	s.launchLocked(id)
}

// StartScheduler 启动本地时钟调度器；服务关闭或 context 取消时退出。
func (s *AIJobService) StartScheduler(ctx context.Context) {
	s.mu.Lock()
	if s.closed || s.stopSchedule != nil {
		s.mu.Unlock()
		return
	}
	schedulerCtx, cancel := context.WithCancel(ctx)
	s.stopSchedule = cancel
	s.scheduleContext = schedulerCtx
	s.wg.Add(1)
	s.mu.Unlock()
	go func() {
		defer s.wg.Done()
		s.scheduleTickWithContext(schedulerCtx, s.now())
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-schedulerCtx.Done():
				return
			case <-ticker.C:
				s.scheduleTickWithContext(schedulerCtx, s.now())
			}
		}
	}()
}

// Shutdown 停止调度并让当前批次以 pending 检查点退出，供下次启动续跑。
func (s *AIJobService) Shutdown(ctx context.Context) error {
	s.mu.Lock()
	if s.dailyPlanActive {
		s.settings.LastScheduledStatus = "interrupted"
		_ = s.persistLocked()
	}
	s.closed = true
	if s.stopSchedule != nil {
		s.stopSchedule()
	}
	for id, runtimeState := range s.runtimes {
		if job := s.jobs[id]; job != nil && job.Status == AIJobStatusPaused {
			runtimeState.stopReason = "shutdown_paused"
		} else {
			runtimeState.stopReason = "shutdown"
		}
		runtimeState.cancel()
	}
	if err := s.persistLocked(); err != nil {
		s.mu.Unlock()
		return err
	}
	s.mu.Unlock()

	done := make(chan struct{})
	go func() {
		s.wg.Wait()
		close(done)
	}()
	select {
	case <-done:
		s.closeAnalyzers()
		return nil
	case <-ctx.Done():
		s.closeAnalyzers()
		return ctx.Err()
	}
}

func (s *AIJobService) closeAnalyzers() {
	s.closeOnce.Do(func() {
		for _, analyzer := range s.analyzers {
			if closer, ok := analyzer.(AIAnalyzerCloser); ok {
				_ = closer.Close()
			}
		}
	})
}

func (s *AIJobService) newJobLocked(moduleType, mode string) AIJob {
	now := s.now()
	faceModel := ""
	if moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait {
		faceModel = s.settings.FaceModel
		if faceModel == "" {
			faceModel = DefaultFaceModel
		}
	}
	version := aiAnalyzerVersion(s.analyzers[moduleType], faceModel)
	computeDevice := "cpu"
	if aiJobModuleUsesGPU(moduleType) && s.settings.GPUEnabled {
		computeDevice = "gpu"
	}
	return AIJob{
		ID:            uuid.NewString(),
		Type:          moduleType,
		Mode:          mode,
		FaceModel:     faceModel,
		ComputeDevice: computeDevice,
		Status:        AIJobStatusPending,
		Stage:         "pending",
		ModuleVersion: version,
		CreatedAt:     now,
		UpdatedAt:     now,
		Checkpoint:    AIJobCheckpoint{ModuleVersion: version},
	}
}

func (s *AIJobService) launchLocked(id string) {
	if s.closed || s.runtimes[id] != nil {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	runtimeState := &aiJobRuntime{ctx: ctx, cancel: cancel, resume: make(chan struct{}, 1)}
	s.runtimes[id] = runtimeState
	s.wg.Add(1)
	go s.run(id, runtimeState)
}

func (s *AIJobService) snapshotLocked(job *AIJob) AIJob {
	copy := *job
	copy.Errors = append([]AIJobError(nil), job.Errors...)
	copy.Results = copyAIJobCounts(job.Results)
	copy.Fields = copyAIJobCounts(job.Fields)
	catalogSnapshot := s.catalog.Acquire()
	for index := range copy.Errors {
		copy.Errors[index].Path = catalogSnapshot.RelativeLabel(copy.Errors[index].ResourceID)
	}
	// Planned 是本次任务真正要处理的张数：增量任务的 total 是整库规模，
	// 拿 total 当分母会让进度一上来就接近满格。
	copy.Planned = max(0, job.Total-job.Skipped)
	copy.Completed = job.Processed + job.Failed
	copy.ElapsedMs = 0
	copy.SpeedPerSecond = 0
	copy.EstimatedRemainingMs = 0
	if job.StartedAt != nil {
		end := s.now()
		if job.FinishedAt != nil {
			end = *job.FinishedAt
		}
		copy.ElapsedMs = max(0, end.Sub(*job.StartedAt).Milliseconds())
		if copy.ElapsedMs > 0 {
			copy.SpeedPerSecond = float64(copy.Completed) * 1000 / float64(copy.ElapsedMs)
		}
	}
	// 预计剩余只在运行时给出：暂停时耗时仍在增长，速度已经失真。
	if job.Status == AIJobStatusRunning && copy.ElapsedMs > 0 && copy.Completed > 0 {
		if remaining := copy.Planned - copy.Completed; remaining > 0 {
			copy.EstimatedRemainingMs = int64(remaining) * copy.ElapsedMs / int64(copy.Completed)
		}
	}
	return copy
}

// copyAIJobCounts 复制计数表，避免调用方改到任务自身的状态。
func copyAIJobCounts(counts map[string]int) map[string]int {
	if len(counts) == 0 {
		return nil
	}
	result := make(map[string]int, len(counts))
	for key, value := range counts {
		result[key] = value
	}
	return result
}

// accumulateAIJobOutput 累计一条分析结果：按解析状态与字段统计产出。
func accumulateAIJobOutput(job *AIJob, record AIAnalysisRecord) {
	if record.Status != "" {
		if job.Results == nil {
			job.Results = make(map[string]int)
		}
		job.Results[record.Status]++
	}
	for _, field := range record.Fields {
		if job.Fields == nil {
			job.Fields = make(map[string]int)
		}
		job.Fields[field]++
	}
}

func (s *AIJobService) publishLocked(job AIJob) {
	subscribers := s.subs[job.ID]
	if len(subscribers) == 0 {
		if !isAIJobActive(job.Status) {
			delete(s.subs, job.ID)
		}
		return
	}
	// 快照只算一次：每个订阅者各算一次会把失败列表与计数表复制 N 遍，
	// 而一个任务失败几百条时这个复制量并不小。
	// 快照交出去之后只会被序列化，不会被改写。
	snapshot := s.snapshotLocked(&job)
	for channel := range subscribers {
		select {
		case channel <- snapshot:
		default:
			select {
			case <-channel:
			default:
			}
			select {
			case channel <- snapshot:
			default:
			}
		}
	}
	if !isAIJobActive(job.Status) {
		for channel := range subscribers {
			close(channel)
			delete(subscribers, channel)
		}
		delete(s.subs, job.ID)
	}
}

func aiWorkerCount() int {
	return min(aiMaxWorkers, max(1, runtime.NumCPU()/2))
}

func isAIJobActive(status string) bool {
	return status == AIJobStatusPending || status == AIJobStatusRunning || status == AIJobStatusPaused
}

func validAIJobType(moduleType string) bool {
	switch moduleType {
	case AIJobTypeMetadata, AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypePortrait, AIJobTypeComicMeta, AIJobTypeComicCover, AIJobTypeAlbumCover, AIJobTypeSimilarity:
		return true
	default:
		return false
	}
}

// aiJobModuleUsesGPU 判断分析模块是否走 GPU 推理。
//
// 只有需要模型推理的模块才占用 GPU：元数据与相似照片特征都在本机
// 用标准库算，强制 GPU 只会让它们因为没有 CUDA 环境而失败。
func aiJobModuleUsesGPU(moduleType string) bool {
	switch moduleType {
	case AIJobTypeEmbedding, AIJobTypeOCR, AIJobTypeFace, AIJobTypePortrait, AIJobTypeComicMeta, AIJobTypeComicCover, AIJobTypeAlbumCover:
		return true
	default:
		return false
	}
}

// aiJobTypeNeedsImageConversion 判断分析模块是否需要先把 HEIC 转成 JPEG。
func aiJobTypeNeedsImageConversion(moduleType string) bool {
	return (moduleType == AIJobTypeFace || moduleType == AIJobTypePortrait) || moduleType == AIJobTypeSimilarity || moduleType == AIJobTypeComicMeta || moduleType == AIJobTypeComicCover || moduleType == AIJobTypeAlbumCover
}

// aiJobAnalysisMaxDimension 返回格式转换时保留的最大边长。
//
// 人脸识别要看清脸，需要更大的图；相似照片只取灰度缩略副本，
// 2048 已经够用，转得更大只是白费时间和磁盘。
func aiJobAnalysisMaxDimension(moduleType string) int {
	if moduleType == AIJobTypeSimilarity {
		return 2048
	}
	return faceAnalysisMaxDimension
}
