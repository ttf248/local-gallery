package services

// 本文件是人物服务的核心：数据模型、服务本身、模型切换与注入的资源查询。
//
// 同一 package 内按职责拆成几个文件：
//
//	people.go         数据模型、服务装配与模型切换
//	people_state.go   人工纠错（命名、隐藏、合并、拆分）与它们的持久化
//	people_index.go   可重建的人物索引：聚类重建、增量更新与失效
//	people_query.go   分组查询、列表与照片统计
//
// 人工纠错在 state/，索引在 derived/：前者不可重建，后者可以。

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const (
	peopleIndexVersion                        = 1
	peopleGroupingVersion                     = 18
	peopleEmbeddingDimension                  = 128
	peopleBuffaloMDimension                   = 512
	faceDetectionMinScoreM                    = float32(0.5)
	peopleMaxSplitFaces                       = 200
	PeopleMaxFacesPerPhoto                    = 256
	PeopleGroupPhotoMinimumFaces              = 8
	PeopleGroupPhotoRelativeFaceSizeThreshold = 0.04
	PeopleCommonMinimumPhotoCount             = 3
	// PeopleGroupPhotoFaceThreshold 是判合照的脸数门槛：超过它就算合照，
	// 不足八张不算，中间那一档看人脸相对尺寸。
	PeopleGroupPhotoFaceThreshold = 20
)

// PeopleGroupingCentroidThreshold is the quality-v2 starting value retained
// for API compatibility. Each model has an independent policy.
const PeopleGroupingCentroidThreshold = 0.52

// PeopleGroupingAnchorThreshold prevents slowly drifting centroids from
// chaining identities. This is the quality-v2 starting value.
const PeopleGroupingAnchorThreshold = 0.72

// PeopleGroupingMergeCentroidThreshold is the quality-v2 starting value for
// the separate-cluster review pass.
const PeopleGroupingMergeCentroidThreshold = 0.82

// PeopleGroupingMergeFaceThreshold is the quality-v2 starting value for
// reciprocal nearest-face evidence.
const PeopleGroupingMergeFaceThreshold = 0.72

type peopleGroupingThresholds struct {
	centroidThreshold          float64
	annScoreMargin             float64
	anchorThreshold            float64
	mergeCentroidThreshold     float64
	mergeFaceThreshold         float64
	mergeCandidateLimit        int
	mergeMaximumSampleFaces    int
	mergeMinimumFaces          int
	mergeMinimumMutual         int
	mergeMutualRatio           float64
	mergeMinimumMeanSimilarity float64
}

// Keep model policies separate so calibration can use each model's own
// annotated pairs without comparing vectors across feature spaces. The
// starting values intentionally match until local labels justify a change.
var (
	qualityV2GroupingThresholds = peopleGroupingThresholds{
		centroidThreshold: 0.52, annScoreMargin: 0.001, anchorThreshold: 0.72,
		mergeCentroidThreshold: 0.82, mergeFaceThreshold: 0.72,
		mergeCandidateLimit: 64, mergeMaximumSampleFaces: 256, mergeMinimumFaces: 10,
		mergeMinimumMutual: 2, mergeMutualRatio: 0.05, mergeMinimumMeanSimilarity: 0.75,
	}
	buffaloMGroupingThresholds = peopleGroupingThresholds{
		centroidThreshold: 0.52, annScoreMargin: 0.001, anchorThreshold: 0.72,
		mergeCentroidThreshold: 0.82, mergeFaceThreshold: 0.72,
		mergeCandidateLimit: 64, mergeMaximumSampleFaces: 256, mergeMinimumFaces: 10,
		mergeMinimumMutual: 2, mergeMutualRatio: 0.05, mergeMinimumMeanSimilarity: 0.75,
	}
)

func peopleGroupingThresholdsForModel(model string) peopleGroupingThresholds {
	if model == FaceModelBuffaloM {
		return buffaloMGroupingThresholds
	}
	return qualityV2GroupingThresholds
}

var (
	ErrPersonNotFound = errors.New("person not found")
	ErrInvalidPerson  = errors.New("invalid person change")
)

type PersonFace struct {
	Key        string    `json:"key"`
	ResourceID string    `json:"resourceId"`
	FaceIndex  int       `json:"faceIndex"`
	PersonID   string    `json:"personId"`
	Box        []float32 `json:"box"`
	Score      float32   `json:"score"`
	Size       int64     `json:"-"`
	MTimeNs    int64     `json:"-"`
	embedding  []float32
	recordHash string
	originID   string
}

type PersonGroup struct {
	ID              string              `json:"id"`
	Name            string              `json:"name"`
	FaceCount       int                 `json:"faceCount"`
	PhotoCount      int                 `json:"photoCount"`
	CoverResourceID string              `json:"coverResourceId,omitempty"`
	Confirmed       bool                `json:"confirmed"`
	Hidden          bool                `json:"hidden"`
	Quality         *PersonGroupQuality `json:"quality,omitempty"`
}

// IsCommon reports whether a group belongs in the regular people list.
func (group PersonGroup) IsCommon() bool {
	return group.Confirmed || group.PhotoCount >= PeopleCommonMinimumPhotoCount
}

// PersonGroupPhotoStats counts distinct photos, group-photo appearances and
// low-resolution face evidence for one person group.
type PersonGroupPhotoStats struct {
	PhotoCount           int     `json:"photoCount"`
	LargeGroupPhotoCount int     `json:"groupPhotoCount"`
	OrdinaryPhotoCount   int     `json:"ordinaryPhotoCount"`
	RelativeFaceSizeP10  float64 `json:"relativeFaceSizeP10"`
	DetectionP10         float64 `json:"detectionP10"`
}

// PersonGroupQuality describes the lower tenth percentile of each group's
// stored similarity and detector confidence scores. It prioritizes manual
// review; it is not an identity probability.
type PersonGroupQuality struct {
	AnchorP10    float64 `json:"anchorP10"`
	CentroidP10  float64 `json:"centroidP10"`
	DetectionP10 float64 `json:"detectionP10"`
}

// PeopleAlbumGroup is a person's current photo membership inside one album.
// It contains no face embedding or file path.
type PeopleAlbumGroup struct {
	Group       PersonGroup
	ResourceIDs []string
	Fingerprint string
}

// PeopleCorrections contains user-owned labels and assignments, never embeddings.
// PeopleCorrectionProfile 是一套人物纠错：命名、隐藏、人工分配、
// 钉住的脸、保留的分组与排除的匹配对。
type PeopleCorrectionProfile struct {
	Version         int                    `json:"version"`
	Names           map[string]string      `json:"names"`
	Hidden          map[string]bool        `json:"hidden"`
	Assignments     map[string]string      `json:"assignments"`
	PinnedFaces     map[string]string      `json:"pinnedFaces,omitempty"`
	RetainedGroups  map[string]bool        `json:"retainedGroups,omitempty"`
	ExcludedMatches []PeopleMatchExclusion `json:"excludedMatches,omitempty"`
}

// PeopleCorrections 是当前模型的一套纠错，加上其它模型各自的同名数据。
//
// 纠错内容直接内嵌 PeopleCorrectionProfile：这两套字段曾经各写一遍，
// 复制、归一化与备份恢复各写一遍，加一个字段要改五处，漏一处就丢用户数据。
// JSON 形状不变 —— 内嵌结构在编码时摊平。
type PeopleCorrections struct {
	PeopleCorrectionProfile
	Profiles map[string]PeopleCorrectionProfile `json:"profiles,omitempty"`
}

// PeopleMatchExclusion stores the two stable face keys a user chose to keep
// separate. The relation is model-specific and survives rebuilding clusters.
type PeopleMatchExclusion struct {
	FirstFaceKey  string `json:"firstFaceKey"`
	SecondFaceKey string `json:"secondFaceKey"`
}

// PeopleCorrectionProfile 保存单个人脸模型的名称与人工分配。
type peopleFaceDisk struct {
	Key        string    `json:"key"`
	ResourceID string    `json:"resourceId"`
	FaceIndex  int       `json:"faceIndex"`
	ClusterID  string    `json:"clusterId"`
	OriginID   string    `json:"originId"`
	Box        []float32 `json:"box"`
	Score      float32   `json:"score"`
	Size       int64     `json:"size"`
	MTimeNs    int64     `json:"mtimeNs"`
	RecordHash string    `json:"recordHash"`
}

type peopleIndexDisk struct {
	Version         int              `json:"version"`
	GroupingVersion int              `json:"groupingVersion"`
	Faces           []peopleFaceDisk `json:"faces"`
}

type peopleManualState = PeopleCorrections

type peopleCluster struct {
	sum       []float64
	centroid  []float32
	anchor    peopleClusterAnchor
	count     int
	members   map[string]struct{}
	resources map[string]struct{}
}

type peopleClusterAnchor struct {
	key        string
	resourceID string
	embedding  []float32
}

// PeopleService keeps a rebuildable face grouping index separate from the small
// user-owned names, visibility flags, and corrections stored under state/.
type PeopleService struct {
	mu                 sync.RWMutex
	persistMu          sync.Mutex
	statePath          string
	derivedPath        string
	stateBasePath      string
	derivedBasePath    string
	legacyPending      bool
	activeModel        string
	sourceIsPhoto      func(string) bool
	sourceDimensions   func(string) MediaDimensions
	sourceCaptureYear  func(string) int
	faces              map[string]PersonFace
	facesByResource    map[string][]string
	clusters           map[string]*peopleCluster
	ann                *peopleANNIndex
	previousIDs        map[string]string
	cachedIDs          map[string]string
	cachedHashes       map[string]string
	cachedOrigins      map[string]string
	manual             peopleManualState
	manualByModel      map[string]peopleManualState
	comparisons        int
	faceModelVersion   string
	embeddingDimension int
	// matchRelations 记录分组之间「可能重复」的近邻关系。
	// 它是复核候选的来源，索引变化后需要重算一次。
	matchRelations      map[string][]string
	matchRelationsStale bool
	// matchPolicy 决定复核口径。生产用默认值，评测工具会覆盖成旧口径做对照。
	matchPolicy PeopleMatchPolicy
}

func OpenPeopleService(statePath, derivedPath string) (*PeopleService, error) {
	if statePath == "" || derivedPath == "" {
		return nil, os.ErrInvalid
	}
	service := &PeopleService{
		statePath: statePath, derivedPath: derivedPath,
		stateBasePath: statePath, derivedBasePath: derivedPath,
		faces: make(map[string]PersonFace), facesByResource: make(map[string][]string),
		clusters: make(map[string]*peopleCluster), ann: newPeopleANNIndex(),
		embeddingDimension: peopleEmbeddingDimension,
		previousIDs:        make(map[string]string),
		cachedIDs:          make(map[string]string),
		cachedHashes:       make(map[string]string),
		cachedOrigins:      make(map[string]string),
		manual:             emptyPeopleManualState(),
		manualByModel:      make(map[string]peopleManualState),
	}
	if err := service.loadProfileLocked(); err != nil {
		return nil, err
	}
	if err := service.loadProfileIndexLocked(); err != nil {
		return nil, err
	}
	service.legacyPending = pathExists(statePath) || pathExists(derivedPath)
	return service, nil
}

func peopleProfilePath(basePath, model string) string {
	extension := filepath.Ext(basePath)
	return strings.TrimSuffix(basePath, extension) + "-" + model + extension
}

func peopleModelForVersion(version string) (string, bool) {
	if version == FaceAnalyzerBuffaloMVersion {
		return FaceModelBuffaloM, true
	}
	if SupportsFaceAnalyzerVersion(version) {
		return FaceModelQualityV2, true
	}
	return "", false
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// SetFaceAnalyzerVersion 为当前人脸模型选择独立的人物状态与索引。
// 首次选择的模型会接管旧版共享文件，保留隔离前正在使用的数据。
func (s *PeopleService) SetFaceAnalyzerVersion(version string) error {
	dimension := FaceEmbeddingDimensionForVersion(version)
	model, knownModel := peopleModelForVersion(version)
	if dimension == 0 || !knownModel {
		return errors.New("unsupported face analyzer version")
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.faceModelVersion == version && s.embeddingDimension == dimension {
		return nil
	}
	if s.faceModelVersion != "" && s.activeModel == model {
		for key, face := range s.faces {
			s.previousIDs[key] = face.PersonID
		}
		s.faceModelVersion = version
		s.embeddingDimension = dimension
		s.cachedIDs = nil
		s.cachedHashes = nil
		s.cachedOrigins = nil
		return nil
	}
	if s.faceModelVersion != "" {
		if err := s.persistLocked(); err != nil {
			return err
		}
		s.manualByModel[s.activeModel] = clonePeopleManualState(s.manual)
	}

	statePath := peopleProfilePath(s.stateBasePath, model)
	derivedPath := peopleProfilePath(s.derivedBasePath, model)
	if s.faceModelVersion == "" && s.legacyPending {
		if !pathExists(statePath) && !pathExists(derivedPath) {
			if err := writeAIJSONAtomic(statePath, s.manual); err != nil {
				return err
			}
			if data, err := os.ReadFile(s.derivedBasePath); err == nil {
				var index peopleIndexDisk
				if json.Unmarshal(data, &index) == nil && index.Version == peopleIndexVersion {
					if err := writeAIJSONAtomic(derivedPath, index); err != nil {
						return err
					}
				}
			} else if !os.IsNotExist(err) {
				return err
			}
			if err := os.Remove(s.stateBasePath); err != nil && !os.IsNotExist(err) {
				return err
			}
			if err := os.Remove(s.derivedBasePath); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		s.legacyPending = false
	}
	s.statePath = statePath
	s.derivedPath = derivedPath
	s.activeModel = model
	s.faceModelVersion = version
	s.embeddingDimension = dimension
	s.faces = make(map[string]PersonFace)
	s.facesByResource = make(map[string][]string)
	s.clusters = make(map[string]*peopleCluster)
	s.ann = newPeopleANNIndexForDimension(dimension)
	s.comparisons = 0
	s.matchRelations = nil
	s.matchRelationsStale = true
	if manual, exists := s.manualByModel[model]; exists {
		s.manual = clonePeopleManualState(manual)
	} else if err := s.loadProfileLocked(); err != nil {
		return err
	}
	if err := s.loadProfileIndexLocked(); err != nil {
		return err
	}
	s.manualByModel[model] = clonePeopleManualState(s.manual)
	return nil
}

func (s *PeopleService) groupingThresholdsLocked() peopleGroupingThresholds {
	model := s.activeModel
	if model == "" && s.faceModelVersion == FaceAnalyzerBuffaloMVersion {
		model = FaceModelBuffaloM
	}
	return peopleGroupingThresholdsForModel(model)
}

// SetSourceDimensions enables analysis-scale face-size filtering for older
// records whose boxes are in source-image coordinates. Set it before Sync or
// ApplyRecords so cache rebuilds and incremental updates use the same rule.
func (s *PeopleService) SetSourceDimensions(lookup func(resourceID string) MediaDimensions) {
	s.mu.Lock()
	s.sourceDimensions = lookup
	s.mu.Unlock()
}

// SetSourceIsPhoto restricts face records to resources that belong to photo albums.
// Set it before Sync or ApplyRecords so startup rebuilds and live updates share
// the same media scope.
func (s *PeopleService) SetSourceIsPhoto(lookup func(resourceID string) bool) {
	s.mu.Lock()
	s.sourceIsPhoto = lookup
	s.mu.Unlock()
}

// SetSourceCaptureYear provides the shooting year of a resource.
// The review page uses it as supporting evidence: two groups shot in the same
// years are more likely to be the same person, while a large gap only raises
// the risk level and never blocks a cross-age merge.
func (s *PeopleService) SetSourceCaptureYear(lookup func(resourceID string) int) {
	s.mu.Lock()
	s.sourceCaptureYear = lookup
	s.mu.Unlock()
}
