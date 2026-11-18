package services

// 本文件是智能相册的核心：数据模型、服务装配、一本相册的输入准备、
// 分组入口与派生缓存的读写调度。
//
// 同一 package 内按职责拆成几个文件：
//
//	smart_albums.go           数据模型、服务装配与分组入口
//	smart_album_cache.go      可重建的派生缓存：指纹、缓存键、读写与覆盖率
//	smart_album_build.go      四个维度的分组草稿构建
//	smart_album_directory.go  跨相册的目录列表与分页
//	smart_album_overrides.go  用户改名与隐藏，以及分组换号时的迁移
//
// 分组成员是可重建的派生数据，用户改名与隐藏是用户状态：两者分开存放。

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

const (
	SmartAlbumDimensionRecommended = "recommended"
	SmartAlbumDimensionTime        = "time"
	SmartAlbumDimensionPlace       = "place"
	SmartAlbumDimensionPeople      = "people"
	SmartAlbumDimensionScene       = "scene"
	SmartAlbumDimensionAll         = "all"

	smartAlbumStateVersion       = 1
	smartAlbumCacheVersion       = 2
	smartAlbumRecommendedVersion = "recommended-parent-aware-evidence-v6"
	smartAlbumTimeVersion        = "time-day-session-v2"
	smartAlbumPlaceVersion       = "place-adaptive-admin-v2"
	smartAlbumPeopleVersion      = "people-album-members-v1"
	smartAlbumSceneVersion       = "scene-cohesive-mutual-ann-v10"
	smartAlbumMinimumGroupSize   = 3
	smartAlbumStatWorkers        = 8
	smartSceneSimilarityFloor    = 0.78
	smartSceneANNConstruction    = 40
	smartSceneANNSearch          = 16
)

var (
	ErrSmartAlbumDimension = errors.New("invalid smart album dimension")
	ErrSmartAlbumNotFound  = errors.New("smart album group not found")
	ErrSmartAlbumOverride  = errors.New("invalid smart album override")
)

type smartAlbumFileFingerprint struct {
	Size    int64 `json:"size"`
	MTimeNs int64 `json:"mtimeNs"`
}

type SmartAlbumCoverage struct {
	Module       string `json:"module"`
	Total        int    `json:"total"`
	Analyzed     int    `json:"analyzed"`
	Missing      int    `json:"missing"`
	Failed       int    `json:"failed"`
	WithEvidence int    `json:"withEvidence"`
	Available    bool   `json:"available"`
	Reason       string `json:"reason,omitempty"`
}

type SmartAlbumGroup struct {
	ID                    string   `json:"id"`
	Dimension             string   `json:"dimension"`
	Name                  string   `json:"name"`
	SuggestedName         string   `json:"suggestedName"`
	CustomName            bool     `json:"customName"`
	PhotoCount            int      `json:"photoCount"`
	QualityScore          float64  `json:"qualityScore,omitempty"`
	EvidenceDimensions    []string `json:"evidenceDimensions,omitempty"`
	RecommendationReasons []string `json:"recommendationReasons,omitempty"`
	OverrideConflict      bool     `json:"overrideConflict,omitempty"`
	CoverResourceID       string   `json:"coverResourceId,omitempty"`
	CoverVersion          string   `json:"coverVersion,omitempty"`
	Hidden                bool     `json:"hidden"`
	Members               []string `json:"-"`
	sortKey               string
	recommendationSeed    string
	overrideSources       []string `json:"-"`
}

type SmartAlbumSummary struct {
	AlbumID           string             `json:"albumId"`
	Dimension         string             `json:"dimension"`
	Revision          uint64             `json:"revision"`
	SnapshotKey       string             `json:"snapshotKey"`
	TotalPhotos       int                `json:"totalPhotos"`
	AvailablePhotos   int                `json:"availablePhotos"`
	UnavailablePhotos int                `json:"unavailablePhotos"`
	UngroupedPhotos   int                `json:"ungroupedPhotos"`
	HiddenGroupCount  int                `json:"hiddenGroupCount"`
	Coverage          SmartAlbumCoverage `json:"coverage"`
	Groups            []SmartAlbumGroup  `json:"groups"`
	CacheHit          bool               `json:"cacheHit"`
}

// SmartAlbumDirectoryItem is a folder-scoped group shown in the cross-folder
// smart-album directory.
type SmartAlbumDirectoryItem struct {
	AlbumID    string          `json:"albumId"`
	AlbumName  string          `json:"albumName"`
	ParentName string          `json:"parentName,omitempty"`
	Group      SmartAlbumGroup `json:"group"`
}

type smartAlbumMedia struct {
	id          string
	path        string
	name        string
	fingerprint smartAlbumFileFingerprint
	version     string
}

type SmartAlbumOverride struct {
	Name   string `json:"name,omitempty"`
	Hidden bool   `json:"hidden,omitempty"`
}

// SmartAlbumCorrections contains only user-owned names and visibility flags.
// Group memberships and media-derived labels remain rebuildable cache data.
type SmartAlbumCorrections struct {
	Version   int                           `json:"version"`
	Overrides map[string]SmartAlbumOverride `json:"overrides"`
}

type smartAlbumState struct {
	Version   int                           `json:"version"`
	Overrides map[string]SmartAlbumOverride `json:"overrides"`
}

type smartAlbumDraft struct {
	key     string
	name    string
	sortKey string
	members map[string]struct{}
}

type SmartAlbumTextEmbedder interface {
	Ready(context.Context) error
	SearchTexts(context.Context, []string) ([][]float32, error)
}

type SmartAlbumServiceOptions struct {
	StatePath    string
	CacheDir     string
	Catalog      *ResourceCatalog
	Jobs         *AIJobService
	People       *PeopleService
	Vectors      *VectorIndexStore
	TextEmbedder SmartAlbumTextEmbedder
	// Dimensions 提供封面图片的像素尺寸；没有它，目录页不给尺寸，
	// 前端只能按默认比例排瀑布流。
	Dimensions   SmartAlbumDimensionSource
	ValidatePath func(string) (string, error)
}

// SmartAlbumDimensionSource 提供封面图片的像素尺寸。
//
// 尺寸探测只读图片头，代价很低，但要走同一份尺寸缓存 ——
// 否则每翻一页都要重读一遍全库封面。
type SmartAlbumDimensionSource interface {
	Dimensions(path string) MediaDimensions
}

// SmartAlbumService computes album-local groups from the existing analysis
// indexes. User labels live under state/; only rebuildable memberships live in
// derived/.
type SmartAlbumService struct {
	statePath    string
	cacheDir     string
	catalog      *ResourceCatalog
	jobs         *AIJobService
	people       *PeopleService
	vectors      *VectorIndexStore
	textEmbedder SmartAlbumTextEmbedder
	dimensions   SmartAlbumDimensionSource
	validatePath func(string) (string, error)

	stateMu           sync.Mutex
	state             smartAlbumState
	buildMu           sync.Mutex
	directoryRevision atomic.Uint64
}

func OpenSmartAlbumService(options SmartAlbumServiceOptions) (*SmartAlbumService, error) {
	if options.StatePath == "" || options.CacheDir == "" || options.Catalog == nil || options.Jobs == nil || options.ValidatePath == nil {
		return nil, errors.New("smart album service requires state, cache, catalog, analysis, and path validation")
	}
	if err := os.MkdirAll(filepath.Dir(options.StatePath), 0o755); err != nil {
		return nil, fmt.Errorf("create smart album state directory: %w", err)
	}
	if err := os.MkdirAll(options.CacheDir, 0o755); err != nil {
		return nil, fmt.Errorf("create smart album cache directory: %w", err)
	}
	service := &SmartAlbumService{
		statePath: options.StatePath, cacheDir: options.CacheDir, catalog: options.Catalog,
		jobs: options.Jobs, people: options.People, vectors: options.Vectors,
		textEmbedder: options.TextEmbedder, dimensions: options.Dimensions,
		validatePath: options.ValidatePath,
		state:        smartAlbumState{Version: smartAlbumStateVersion, Overrides: map[string]SmartAlbumOverride{}},
	}
	data, err := os.ReadFile(options.StatePath)
	if err != nil && !os.IsNotExist(err) {
		return nil, fmt.Errorf("read smart album state: %w", err)
	}
	if err == nil {
		var saved smartAlbumState
		if err := json.Unmarshal(data, &saved); err != nil {
			return nil, fmt.Errorf("decode smart album state: %w", err)
		}
		if saved.Version != smartAlbumStateVersion {
			return nil, fmt.Errorf("unsupported smart album state version %d", saved.Version)
		}
		if saved.Overrides == nil {
			saved.Overrides = map[string]SmartAlbumOverride{}
		}
		service.state = saved
	}
	return service, nil
}

// smartAlbumAlbumInput 是一本照片相册的分组输入：媒体清单、文件指纹与
// 三个分析模块的当前结果。
//
// 四个维度共用同一份输入。算一次媒体指纹要 stat 每个文件、还要逐级校验
// 路径边界（Windows 上每个文件要好几次系统调用），四个维度各算一遍
// 就是四倍的代价 —— 全库刷新因此慢得看不出在做什么。
type smartAlbumAlbumInput struct {
	albumID   string
	albumName string
	// revision 是准备输入时的库版本；摘要里的版本与之相同。
	revision     uint64
	ids          []string
	media        []smartAlbumMedia
	mediaByID    map[string]smartAlbumMedia
	fingerprints map[string]smartAlbumFileFingerprint
	metadata     map[string]AIAnalysisRecord
	face         map[string]AIAnalysisRecordSummary
	embedding    map[string]AIAnalysisRecordSummary

	metadataStatus  AIJobModule
	faceStatus      AIJobModule
	embeddingStatus AIJobModule
	// unavailable 是相册里取不到的文件数（已删除、越界或不是普通文件）。
	unavailable int
}

// prepareAlbum 取出一本照片相册的分组输入：媒体清单、文件指纹与各分析
// 模块的当前结果。它只读不改，写缓存的事留给分组那一步。
func (s *SmartAlbumService) prepareAlbum(ctx context.Context, albumID string) (smartAlbumAlbumInput, error) {
	snapshot := s.catalog.Acquire()
	if !snapshot.Ready() {
		return smartAlbumAlbumInput{}, ErrLibraryNotReady
	}
	album, exists := snapshot.AlbumSummary(albumID)
	if !exists {
		return smartAlbumAlbumInput{}, ErrLibraryResourceNotFound
	}
	if album.ContentKind != string(models.ContentKindPhoto) {
		return smartAlbumAlbumInput{}, ErrLibraryResourceWrongKind
	}
	ids, exists := snapshot.AlbumImageIDs(albumID)
	if !exists {
		return smartAlbumAlbumInput{}, ErrLibraryResourceNotFound
	}
	media, unavailable, err := s.currentAlbumMedia(ctx, snapshot, ids)
	if err != nil {
		return smartAlbumAlbumInput{}, err
	}
	mediaIDs := make([]string, len(media))
	fingerprints := make(map[string]smartAlbumFileFingerprint, len(media))
	mediaByID := make(map[string]smartAlbumMedia, len(media))
	for index, item := range media {
		mediaIDs[index] = item.id
		fingerprints[item.id] = item.fingerprint
		mediaByID[item.id] = item
	}
	metadataRecords := s.jobs.RecordsForResources(AIJobTypeMetadata, mediaIDs)
	faceRecords := s.jobs.RecordSummariesForResources(AIJobTypeFace, mediaIDs)
	embeddingRecords := s.jobs.RecordSummariesForResources(AIJobTypeEmbedding, mediaIDs)
	return smartAlbumAlbumInput{
		albumID: albumID, albumName: smartAlbumInputAlbumName(album), revision: snapshot.Revision(),
		ids: ids, media: media, mediaByID: mediaByID, fingerprints: fingerprints,
		metadata:        currentAnalysisRecords(metadataRecords, fingerprints),
		face:            currentAnalysisSummaries(faceRecords, fingerprints),
		embedding:       currentAnalysisSummaries(embeddingRecords, fingerprints),
		metadataStatus:  s.jobs.ModuleStatus(AIJobTypeMetadata),
		faceStatus:      s.jobs.ModuleStatus(AIJobTypeFace),
		embeddingStatus: s.jobs.ModuleStatus(AIJobTypeEmbedding),
		unavailable:     unavailable,
	}, nil
}

func smartAlbumInputAlbumName(album LibraryNodeSummary) string {
	name := strings.TrimSpace(album.DisplayName)
	if name == "" {
		name = strings.TrimSpace(album.Name)
	}
	if album.Virtual {
		if location := strings.Trim(strings.TrimSpace(album.Location), "/\\"); location != "" {
			name = location
		} else if album.ParentName != "" {
			name = album.ParentName
		}
	}
	return name
}

func (s *SmartAlbumService) Groups(ctx context.Context, albumID, dimension string, force bool) (SmartAlbumSummary, error) {
	if !validSmartAlbumDimension(dimension) {
		return SmartAlbumSummary{}, ErrSmartAlbumDimension
	}
	input, err := s.prepareAlbum(ctx, albumID)
	if err != nil {
		return SmartAlbumSummary{}, err
	}
	return s.groupsForDimension(ctx, input, dimension, force)
}

// groupsForDimension 按一个维度算分组：命中派生缓存就直接复用，没命中
// 才重算并写回缓存。
func (s *SmartAlbumService) groupsForDimension(
	ctx context.Context,
	input smartAlbumAlbumInput,
	dimension string,
	force bool,
) (SmartAlbumSummary, error) {
	s.buildMu.Lock()
	defer s.buildMu.Unlock()

	metadataCoverage := coverageForRecords(len(input.ids), len(input.media), input.metadata, input.metadataStatus)
	faceCoverage := coverageForSummaries(len(input.ids), len(input.media), input.face, input.faceStatus)
	embeddingCoverage := coverageForVectors(len(input.ids), len(input.media), s.vectors, input.fingerprints, input.embedding, input.embeddingStatus)
	peopleGroups := []PeopleAlbumGroup{}
	if s.people != nil && (dimension == SmartAlbumDimensionPeople || dimension == SmartAlbumDimensionRecommended) {
		peopleGroups = s.people.AlbumGroups(currentFingerprints(input.face, input.fingerprints))
		if dimension == SmartAlbumDimensionPeople {
			faceCoverage.WithEvidence = peopleEvidencePhotoCount(peopleGroups)
		}
		if dimension == SmartAlbumDimensionPeople && !s.jobs.PeopleEnabled() {
			faceCoverage.Available = false
			faceCoverage.Reason = "people_analysis_disabled"
		}
	}
	coverage := metadataCoverage
	switch dimension {
	case SmartAlbumDimensionPeople:
		coverage = faceCoverage
	case SmartAlbumDimensionScene:
		coverage = embeddingCoverage
	}
	if dimension == SmartAlbumDimensionTime || dimension == SmartAlbumDimensionPlace {
		coverage.WithEvidence = metadataEvidenceCount(input.metadata, dimension)
	}

	cache, cacheHit, err := s.loadOrBuildSmartAlbumGroups(ctx, input, dimension, force, peopleGroups)
	if err != nil {
		return SmartAlbumSummary{}, err
	}
	if dimension == SmartAlbumDimensionRecommended {
		coverage = coverageForRecommendations(len(input.ids), len(input.media), cache.Groups)
	}
	groups := s.applyOverrides(input.albumID, dimension, smartAlbumGroups(cache.Groups))
	groupedIDs := make(map[string]struct{})
	hiddenCount := 0
	for _, group := range cache.Groups {
		for _, id := range group.Members {
			groupedIDs[id] = struct{}{}
		}
	}
	for _, group := range groups {
		if group.Hidden {
			hiddenCount++
		}
	}
	return SmartAlbumSummary{
		AlbumID: input.albumID, Dimension: dimension, Revision: input.revision, SnapshotKey: cache.Key,
		TotalPhotos: len(input.ids), AvailablePhotos: len(input.media), UnavailablePhotos: input.unavailable,
		UngroupedPhotos: max(0, len(input.ids)-len(groupedIDs)), HiddenGroupCount: hiddenCount,
		Coverage: coverage, Groups: groups, CacheHit: cacheHit,
	}, nil
}

func (s *SmartAlbumService) loadOrBuildSmartAlbumGroups(
	ctx context.Context,
	input smartAlbumAlbumInput,
	dimension string,
	force bool,
	peopleGroups []PeopleAlbumGroup,
) (smartAlbumCache, bool, error) {
	analysisFingerprint := s.analysisFingerprint(
		dimension, input.albumName, input.media, input.metadata, input.face, peopleGroups,
		input.metadataStatus, input.faceStatus, input.embeddingStatus,
	)
	key := smartAlbumCacheKey(input.albumID, dimension, input.media, analysisFingerprint)
	cachePath := s.cachePath(input.albumID, dimension)
	cache, cacheHit := smartAlbumCache{}, false
	if !force {
		cache, cacheHit = readSmartAlbumCache(cachePath, input.albumID, dimension, key)
	}
	if cacheHit {
		return cache, true, nil
	}

	previous, previousExists := readSmartAlbumCacheFile(cachePath, input.albumID, dimension)
	var groups []SmartAlbumGroup
	var err error
	if dimension == SmartAlbumDimensionRecommended {
		detailGroups := make(map[string][]SmartAlbumGroup, len(smartAlbumDetailDimensions()))
		for _, detailDimension := range smartAlbumDetailDimensions() {
			detailCache, _, loadErr := s.loadOrBuildSmartAlbumGroups(
				ctx, input, detailDimension, false, peopleGroups,
			)
			if loadErr != nil {
				return smartAlbumCache{}, false, loadErr
			}
			detailGroups[detailDimension] = smartAlbumGroups(detailCache.Groups)
		}
		vectors := s.currentSmartSceneVectors(input)
		groups = buildSmartAlbumRecommendations(input.albumID, input.albumName, input.media, detailGroups, input.metadata, vectors)
	} else {
		groups, err = s.buildGroups(
			ctx, input.albumID, dimension, input.media, input.mediaByID,
			input.metadata, input.face, peopleGroups,
		)
	}
	if err != nil {
		return smartAlbumCache{}, false, err
	}
	var migration *smartAlbumOverrideMigration
	if previousExists {
		groups, migration, err = s.migrateSmartAlbumOverrides(input.albumID, dimension, previous.Groups, groups)
		if err != nil {
			return smartAlbumCache{}, false, err
		}
	}
	cache = smartAlbumCache{
		Version: smartAlbumCacheVersion, AlbumID: input.albumID, Dimension: dimension,
		FaceModel: smartAlbumFaceModel(s.jobs, dimension),
		Key:       key, Fingerprints: input.fingerprints, Groups: cacheSmartAlbumGroups(groups),
	}
	if err := writeAIJSONAtomic(cachePath, cache); err != nil {
		return smartAlbumCache{}, false, fmt.Errorf("persist smart album cache: %w", err)
	}
	// 旧键等缓存落盘之后再删：顺序反过来的话，进程在两次写之间退出时
	// 用户改过的名字就没有出处了。
	if err := s.commitSmartAlbumOverrideMigration(migration); err != nil {
		log.Printf("smart album override migration left stale overrides: %v", err)
	}
	s.directoryRevision.Add(1)
	return cache, false, nil
}

// 精选推荐的排序模式。
//
// 专页排的是跨相册的一组主题，按相册分块排出来的顺序是「这本相册最近
// 拍过什么」，跟主题本身的新旧无关 —— 因此这一页给用户几种排法。
const (
	// SmartAlbumSortTime：组内最新一张照片的拍摄时间倒序（默认）。
	SmartAlbumSortTime = "time"
	// SmartAlbumSortPhotos：照片张数倒序。
	SmartAlbumSortPhotos = "photos"
	// SmartAlbumSortQuality：推荐分倒序（后端算的证据强度，不上屏）。
	SmartAlbumSortQuality = "quality"
)

// NormalizeSmartAlbumSort 把请求里的排序参数收敛到已知模式。
//
// 认不出来的参数一律按时间倒序处理：排序是给人看的偏好，不是接口的
// 硬约束，为它报错反而会挡住整页。
func NormalizeSmartAlbumSort(value string) string {
	switch value {
	case SmartAlbumSortPhotos:
		return SmartAlbumSortPhotos
	case SmartAlbumSortQuality:
		return SmartAlbumSortQuality
	default:
		return SmartAlbumSortTime
	}
}

// SweepSmartAlbums prepares the four detail dimensions and recommendations for
// every photo album. It reuses matching derived caches and rebuilds only summaries whose
// media or analysis fingerprint has changed, unless force is set.
//
// 手动触发与每日计划走的是同一段代码：分组口径只有一处实现。
func (s *SmartAlbumService) SweepSmartAlbums(
	ctx context.Context,
	force bool,
	progress func(SmartAlbumSweepProgress),
) error {
	snapshot := s.catalog.Acquire()
	if !snapshot.Ready() {
		return ErrLibraryNotReady
	}
	albums := snapshot.PhotoAlbumSummaries()
	dimensions := smartAlbumRefreshDimensions()
	total := len(albums) * len(dimensions)
	completed, rebuilt, reused, groups := 0, 0, 0, 0
	for _, album := range albums {
		if err := ctx.Err(); err != nil {
			return err
		}
		// 一本相册的媒体清单与文件指纹只算一次，四个维度共用。
		input, err := s.prepareAlbum(ctx, album.ID)
		if err != nil {
			return err
		}
		for _, dimension := range dimensions {
			if err := ctx.Err(); err != nil {
				return err
			}
			summary, err := s.groupsForDimension(ctx, input, dimension, force)
			if err != nil {
				return err
			}
			if summary.Revision != snapshot.Revision() {
				return ErrStalePageCursor
			}
			completed++
			if summary.CacheHit {
				reused++
			} else {
				rebuilt++
			}
			groups += len(summary.Groups)
			if progress != nil {
				progress(SmartAlbumSweepProgress{
					Albums: len(albums), Total: total, Completed: completed,
					Rebuilt: rebuilt, Reused: reused, Groups: groups,
					AlbumID: album.ID, AlbumName: album.DisplayName, Dimension: dimension,
				})
			}
		}
	}
	return nil
}

func smartAlbumRefreshDimensions() []string {
	return append(smartAlbumDetailDimensions(), SmartAlbumDimensionRecommended)
}

func smartAlbumDirectoryDimensions(dimension string) []string {
	if dimension == SmartAlbumDimensionRecommended {
		return []string{SmartAlbumDimensionRecommended}
	}
	if dimension != SmartAlbumDimensionAll {
		return []string{dimension}
	}
	return smartAlbumDetailDimensions()
}

func (s *SmartAlbumService) currentSmartSceneVectors(input smartAlbumAlbumInput) []smartSceneVector {
	return s.currentSmartSceneVectorsFromMedia(input.media)
}

func (s *SmartAlbumService) currentSmartSceneVectorsFromMedia(media []smartAlbumMedia) []smartSceneVector {
	if s.vectors == nil {
		return nil
	}
	vectors := make([]smartSceneVector, 0, len(media))
	for _, item := range media {
		vector, ok := s.vectors.Vector(item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
		if !ok {
			continue
		}
		normalized := normalizeSmartVector(vector)
		if normalized != nil {
			vectors = append(vectors, smartSceneVector{id: item.id, vector: normalized})
		}
	}
	return vectors
}

func (s *SmartAlbumService) currentAlbumMedia(ctx context.Context, snapshot CatalogSnapshot, ids []string) ([]smartAlbumMedia, int, error) {
	if len(ids) == 0 {
		return []smartAlbumMedia{}, 0, nil
	}
	items := make([]smartAlbumMedia, len(ids))
	var next atomic.Int64
	workers := min(smartAlbumStatWorkers, len(ids))
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				index := int(next.Add(1)) - 1
				if index >= len(ids) || ctx.Err() != nil {
					return
				}
				id := ids[index]
				ref, exists := snapshot.Lookup(id)
				if !exists || ref.Kind != ResourceFile || !models.IsImageFile(ref.AbsolutePath) {
					continue
				}
				path, err := s.validatePath(ref.AbsolutePath)
				if err != nil {
					continue
				}
				info, err := os.Stat(path)
				if err != nil || !info.Mode().IsRegular() {
					continue
				}
				items[index] = smartAlbumMedia{
					id: id, path: path, name: filepath.Base(path),
					fingerprint: smartAlbumFileFingerprint{Size: info.Size(), MTimeNs: info.ModTime().UnixNano()},
					version:     MediaVersionFromStat(info),
				}
			}
		}()
	}
	wg.Wait()
	if err := ctx.Err(); err != nil {
		return nil, 0, err
	}
	valid := make([]smartAlbumMedia, 0, len(items))
	for _, item := range items {
		if item.id != "" {
			valid = append(valid, item)
		}
	}
	return valid, len(ids) - len(valid), nil
}

func smartGroupID(dimension, stableKey string) string {
	hash := sha256.Sum256([]byte(dimension + "\x00" + stableKey))
	return "sg_" + hex.EncodeToString(hash[:10])
}

func validSmartAlbumDimension(dimension string) bool {
	switch dimension {
	case SmartAlbumDimensionRecommended, SmartAlbumDimensionTime, SmartAlbumDimensionPlace, SmartAlbumDimensionPeople, SmartAlbumDimensionScene:
		return true
	default:
		return false
	}
}

func (s *SmartAlbumService) PageGroupMedia(
	ctx context.Context,
	snapshot CatalogSnapshot,
	albumID, dimension, groupID, snapshotKey, cursor string,
	limit int,
) (LibraryPage[LibraryMediaItem], error) {
	if !validSmartAlbumDimension(dimension) {
		return LibraryPage[LibraryMediaItem]{}, ErrSmartAlbumDimension
	}
	if !snapshot.Ready() {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryNotReady
	}
	album, exists := snapshot.AlbumSummary(albumID)
	if !exists {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceNotFound
	}
	if album.ContentKind != string(models.ContentKindPhoto) {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceWrongKind
	}
	cache, ok := readSmartAlbumCache(s.cachePath(albumID, dimension), albumID, dimension, snapshotKey)
	if !ok {
		return LibraryPage[LibraryMediaItem]{}, ErrInvalidPageCursor
	}
	var group *smartAlbumCachedGroup
	for index := range cache.Groups {
		if cache.Groups[index].ID == groupID {
			group = &cache.Groups[index]
			break
		}
	}
	if group == nil {
		return LibraryPage[LibraryMediaItem]{}, ErrSmartAlbumNotFound
	}
	allowedIDs, exists := snapshot.AlbumImageIDs(albumID)
	if !exists {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceNotFound
	}
	allowed := make(map[string]struct{}, len(allowedIDs))
	for _, id := range allowedIDs {
		allowed[id] = struct{}{}
	}
	ids := make([]string, 0, len(group.Members))
	for _, id := range group.Members {
		if _, exists := allowed[id]; exists {
			ids = append(ids, id)
		}
	}
	scope := "smart-album:" + albumID + ":" + dimension + ":" + groupID + ":" + snapshotKey
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryMediaItem]{}, err
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(ids), limit)
	if err != nil {
		return LibraryPage[LibraryMediaItem]{}, err
	}
	items := make([]LibraryMediaItem, 0, end-start)
	for index, id := range ids[start:end] {
		if err := ctx.Err(); err != nil {
			return LibraryPage[LibraryMediaItem]{}, err
		}
		ref, exists := snapshot.Lookup(id)
		if !exists || ref.Kind != ResourceFile || !models.IsImageFile(ref.AbsolutePath) {
			continue
		}
		validated, err := s.validatePath(ref.AbsolutePath)
		if err != nil {
			continue
		}
		info, err := os.Stat(validated)
		if err != nil || !info.Mode().IsRegular() {
			continue
		}
		fingerprint, exists := cache.Fingerprints[id]
		if !exists || fingerprint.Size != info.Size() || fingerprint.MTimeNs != info.ModTime().UnixNano() {
			continue
		}
		position := start + index
		items = append(items, LibraryMediaItem{
			ID: id, Kind: "image", Name: filepath.Base(validated), Index: position,
			KindIndex: position, Version: MediaVersionFromStat(info), sourcePath: validated,
		})
	}
	return LibraryPage[LibraryMediaItem]{Revision: snapshot.Revision(), Items: items, Total: len(ids), NextCursor: next}, nil
}
