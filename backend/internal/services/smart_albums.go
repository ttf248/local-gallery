package services

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"time"
	"unicode"

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
	sortKey               string   `json:"sortKey,omitempty"`
	recommendationSeed    string
	overrideSources       []string `json:"-"`
	// CoverWidth 与 CoverHeight 是封面图的原始像素尺寸。
	//
	// 目录页把分组排成瀑布流，卡片高度得跟着封面的真实比例走，
	// 否则一面墙上全是等高的卡片，竖幅照片全被裁掉。
	// 尺寸按请求时探测（只读图片头），因此不进缓存：
	// 缓存里存的是「分组有哪些成员」，不是媒体的呈现属性。
	CoverWidth  int `json:"coverWidth,omitempty"`
	CoverHeight int `json:"coverHeight,omitempty"`
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

type smartAlbumCache struct {
	Version      int                                  `json:"version"`
	AlbumID      string                               `json:"albumId"`
	Dimension    string                               `json:"dimension"`
	Key          string                               `json:"key"`
	Fingerprints map[string]smartAlbumFileFingerprint `json:"fingerprints"`
	Groups       []smartAlbumCachedGroup              `json:"groups"`
}

type smartAlbumCachedGroup struct {
	ID                    string   `json:"id"`
	Dimension             string   `json:"dimension"`
	Name                  string   `json:"name"`
	SuggestedName         string   `json:"suggestedName"`
	PhotoCount            int      `json:"photoCount"`
	QualityScore          float64  `json:"qualityScore,omitempty"`
	EvidenceDimensions    []string `json:"evidenceDimensions,omitempty"`
	RecommendationReasons []string `json:"recommendationReasons,omitempty"`
	OverrideConflict      bool     `json:"overrideConflict,omitempty"`
	OverrideSources       []string `json:"overrideSources,omitempty"`
	CoverResourceID       string   `json:"coverResourceId,omitempty"`
	CoverVersion          string   `json:"coverVersion,omitempty"`
	Members               []string `json:"members"`
	sortKey               string   `json:"sortKey,omitempty"`
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
	if previousExists {
		groups, err = s.migrateSmartAlbumOverrides(input.albumID, dimension, previous.Groups, groups)
		if err != nil {
			return smartAlbumCache{}, false, err
		}
	}
	cache = smartAlbumCache{
		Version: smartAlbumCacheVersion, AlbumID: input.albumID, Dimension: dimension,
		Key: key, Fingerprints: input.fingerprints, Groups: cacheSmartAlbumGroups(groups),
	}
	if err := writeAIJSONAtomic(cachePath, cache); err != nil {
		return smartAlbumCache{}, false, fmt.Errorf("persist smart album cache: %w", err)
	}
	s.directoryRevision.Add(1)
	return cache, false, nil
}

// DirectoryPage collects only folder dimensions that already have a smart
// album cache. Missing folder summaries stay missing instead of triggering
// analysis or a full-library rebuild from the home page.
//
// 它直接读已生成的缓存，不重算分组：目录只是「已生成了哪些分组」的汇总，
// 而重算分组要把每本相册的媒体逐个 stat 一遍（真实库上几十秒）——
// 首页等不起，那笔钱该由刷新任务出（见 SweepSmartAlbums）。
func (s *SmartAlbumService) DirectoryPage(
	ctx context.Context,
	dimension, cursor string,
	limit int,
) (LibraryPage[SmartAlbumDirectoryItem], error) {
	if !validSmartAlbumDirectoryDimension(dimension) {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrSmartAlbumDimension
	}
	snapshot := s.catalog.Acquire()
	if !snapshot.Ready() {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrLibraryNotReady
	}
	if dimension == "featured" {
		return s.featuredDirectoryPage(ctx, snapshot, cursor, limit)
	}
	directoryRevision := s.directoryRevision.Load()
	scope := smartAlbumDirectoryScope(dimension, directoryRevision)
	offset := 0
	if cursor != "" {
		var err error
		offset, err = DecodePageCursor(cursor, snapshot.Revision(), scope)
		if err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
	}
	dimensions := smartAlbumDirectoryDimensions(dimension)
	blocks := make([]smartAlbumDirectoryBlock, 0)
	coverIDs := make([]string, 0)
	for _, album := range snapshot.PhotoAlbumSummaries() {
		if err := ctx.Err(); err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
		block := smartAlbumDirectoryBlock{album: album}
		for _, currentDimension := range dimensions {
			cache, ok := s.readCachedGroups(album.ID, currentDimension)
			if !ok {
				continue
			}
			for _, group := range s.applyOverrides(album.ID, currentDimension, smartAlbumGroups(cache.Groups)) {
				if group.Hidden {
					continue
				}
				block.items = append(block.items, SmartAlbumDirectoryItem{
					AlbumID: album.ID, AlbumName: album.DisplayName,
					ParentName: album.ParentName, Group: group,
				})
				if group.PhotoCount > block.leadCount {
					block.leadCount = group.PhotoCount
				}
				// 时间分组在缓存里就是从新到旧排的，因此第一个时间组
				// 就是这本相册最新的一组；它的封面是那一组里的照片。
				if currentDimension == SmartAlbumDimensionTime && block.leadCoverID == "" {
					block.leadCoverID = group.CoverResourceID
				}
			}
		}
		if len(block.items) == 0 {
			continue
		}
		if block.leadCoverID != "" {
			coverIDs = append(coverIDs, block.leadCoverID)
		}
		blocks = append(blocks, block)
	}
	// 相册之间按「这本相册最新的一组」排：封面图的 EXIF 拍摄时间即那一组
	// 的起点。一次取回所有封面的元数据，避免逐本相册去查。
	s.albumLeadTimes(blocks, coverIDs)
	sortSmartAlbumBlocks(blocks)
	items := make([]SmartAlbumDirectoryItem, 0)
	for _, block := range blocks {
		items = append(items, block.items...)
	}
	currentDirectoryRevision := s.directoryRevision.Load()
	if cursor != "" && currentDirectoryRevision != directoryRevision {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrStalePageCursor
	}
	if offset > len(items) {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrInvalidPageCursor
	}
	end := min(len(items), offset+NormalizeLibraryPageLimit(limit))
	if dimension == SmartAlbumDimensionRecommended && end > offset && end < len(items) {
		albumID := items[end-1].AlbumID
		for end < len(items) && items[end].AlbumID == albumID {
			end++
		}
	}
	pageItems := clonePage(items, offset, end)
	// 封面尺寸只给这一页：全库四千多组每组都探一次尺寸，
	// 一页请求要背上几千次文件探测，首页等不起。
	s.enrichCoverDimensions(snapshot, pageItems)
	page := LibraryPage[SmartAlbumDirectoryItem]{
		// 空页要给 []，不能给 null：前端把 items 当数组用，null 会让它
		// 把一个空分组当成一条记录（库里还没生成任何分组时就会踩到）。
		Revision: snapshot.Revision(), Items: pageItems, Total: len(items),
	}
	if end < len(items) {
		nextCursor, err := EncodePageCursor(
			snapshot.Revision(),
			smartAlbumDirectoryScope(dimension, currentDirectoryRevision),
			end,
		)
		if err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
		page.NextCursor = nextCursor
	}
	return page, nil
}

// featuredDirectoryPage picks the best recommendation from different source
// folders before taking a folder's second result. The home page therefore gets
// a curated, folder-diverse preview instead of the first slice of the full
// directory order.
func (s *SmartAlbumService) featuredDirectoryPage(
	ctx context.Context,
	snapshot CatalogSnapshot,
	cursor string,
	limit int,
) (LibraryPage[SmartAlbumDirectoryItem], error) {
	directoryRevision := s.directoryRevision.Load()
	scope := smartAlbumDirectoryScope("featured", directoryRevision)
	offset := 0
	if cursor != "" {
		var err error
		offset, err = DecodePageCursor(cursor, snapshot.Revision(), scope)
		if err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
	}
	byAlbum := make([][]SmartAlbumDirectoryItem, 0)
	for _, album := range snapshot.PhotoAlbumSummaries() {
		if err := ctx.Err(); err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
		cache, ok := s.readCachedGroups(album.ID, SmartAlbumDimensionRecommended)
		if !ok {
			continue
		}
		groups := s.applyOverrides(album.ID, SmartAlbumDimensionRecommended, smartAlbumGroups(cache.Groups))
		items := make([]SmartAlbumDirectoryItem, 0, len(groups))
		for _, group := range groups {
			if group.Hidden {
				continue
			}
			items = append(items, SmartAlbumDirectoryItem{
				AlbumID: album.ID, AlbumName: album.DisplayName,
				ParentName: album.ParentName, Group: group,
			})
		}
		if len(items) == 0 {
			continue
		}
		sort.SliceStable(items, func(i, j int) bool {
			if items[i].Group.QualityScore != items[j].Group.QualityScore {
				return items[i].Group.QualityScore > items[j].Group.QualityScore
			}
			return items[i].Group.ID < items[j].Group.ID
		})
		byAlbum = append(byAlbum, items)
	}
	items := make([]SmartAlbumDirectoryItem, 0)
	for rank := 0; ; rank++ {
		round := make([]SmartAlbumDirectoryItem, 0, len(byAlbum))
		for _, albumItems := range byAlbum {
			if rank < len(albumItems) {
				round = append(round, albumItems[rank])
			}
		}
		if len(round) == 0 {
			break
		}
		sort.SliceStable(round, func(i, j int) bool {
			if round[i].Group.QualityScore != round[j].Group.QualityScore {
				return round[i].Group.QualityScore > round[j].Group.QualityScore
			}
			if round[i].Group.PhotoCount != round[j].Group.PhotoCount {
				return round[i].Group.PhotoCount > round[j].Group.PhotoCount
			}
			if round[i].AlbumName != round[j].AlbumName {
				return strings.ToLower(round[i].AlbumName) < strings.ToLower(round[j].AlbumName)
			}
			return round[i].Group.ID < round[j].Group.ID
		})
		items = append(items, round...)
	}
	currentDirectoryRevision := s.directoryRevision.Load()
	if cursor != "" && currentDirectoryRevision != directoryRevision {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrStalePageCursor
	}
	if offset > len(items) {
		return LibraryPage[SmartAlbumDirectoryItem]{}, ErrInvalidPageCursor
	}
	end := min(len(items), offset+NormalizeLibraryPageLimit(limit))
	pageItems := clonePage(items, offset, end)
	s.enrichCoverDimensions(snapshot, pageItems)
	page := LibraryPage[SmartAlbumDirectoryItem]{
		Revision: snapshot.Revision(), Items: pageItems, Total: len(items),
	}
	if end < len(items) {
		nextCursor, err := EncodePageCursor(
			snapshot.Revision(), smartAlbumDirectoryScope("featured", currentDirectoryRevision), end,
		)
		if err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
		page.NextCursor = nextCursor
	}
	return page, nil
}

func smartAlbumDirectoryScope(dimension string, revision uint64) string {
	return fmt.Sprintf("smart-album-directory:%s:%d", dimension, revision)
}

// smartAlbumDirectoryBlock 是目录里一本相册的全部分组。
//
// 目录按相册分块铺开：同一本相册的分组挨在一起，翻的时候才认得出
// 「这几组是同一本里的」；块与块之间按这本相册最新的一组排。
type smartAlbumDirectoryBlock struct {
	album LibraryNodeSummary
	items []SmartAlbumDirectoryItem
	// leadTime 是这本相册最新一组的拍摄时间（RFC3339），空表示读不到。
	leadTime string
	// leadCount 是这本相册张数最多的一组的张数。
	leadCount int
	// leadCoverID 是最新一组的封面，用它的 EXIF 拍摄时间当 leadTime。
	leadCoverID string
}

// albumLeadTimes 取出各本相册最新一组的拍摄时间。
//
// 时间分组的封面就是那一组里的照片，它的 EXIF 时间落在这一组的时间段内，
// 足以给相册定出「哪本更新」。读不到就留空：排序时这类相册排在有时间的
// 之后，而不是被当成最旧的。
func (s *SmartAlbumService) albumLeadTimes(
	blocks []smartAlbumDirectoryBlock,
	coverIDs []string,
) {
	if len(coverIDs) == 0 {
		return
	}
	records := s.jobs.RecordsForResources(AIJobTypeMetadata, coverIDs)
	for index := range blocks {
		coverID := blocks[index].leadCoverID
		if coverID == "" {
			continue
		}
		record, exists := records[coverID]
		if !exists || record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil {
			continue
		}
		captured, ok := parseSmartCaptureTime(metadata.DateTimeOriginal)
		if !ok {
			continue
		}
		blocks[index].leadTime = captured.Format(time.RFC3339Nano)
	}
}

// sortSmartAlbumBlocks 给相册块排序：先按最新一组的拍摄时间倒序，
// 没有时间信息的按张数最多的那一组倒序，最后按相册名兜底。
func sortSmartAlbumBlocks(blocks []smartAlbumDirectoryBlock) {
	sort.SliceStable(blocks, func(i, j int) bool {
		left, right := blocks[i], blocks[j]
		if left.leadTime != right.leadTime {
			if left.leadTime == "" {
				return false
			}
			if right.leadTime == "" {
				return true
			}
			return left.leadTime > right.leadTime
		}
		if left.leadCount != right.leadCount {
			return left.leadCount > right.leadCount
		}
		return strings.ToLower(left.album.DisplayName) < strings.ToLower(right.album.DisplayName)
	})
}

// enrichCoverDimensions 给这一页的分组补上封面的像素尺寸。
//
// 瀑布流按封面真实比例排卡片：尺寸已知就按它算，未知就退回默认比例。
// 尺寸只探测当前页的封面，翻页时同一批封面直接命中尺寸缓存。
func (s *SmartAlbumService) enrichCoverDimensions(
	snapshot CatalogSnapshot,
	items []SmartAlbumDirectoryItem,
) {
	if s.dimensions == nil {
		return
	}
	for index := range items {
		coverID := items[index].Group.CoverResourceID
		if coverID == "" {
			continue
		}
		ref, exists := snapshot.Lookup(coverID)
		if !exists || ref.Kind != ResourceFile {
			continue
		}
		// 封面与其它媒体一样按当前媒体根重新校验：资源 ID 不是授权凭据。
		path, err := s.validatePath(ref.AbsolutePath)
		if err != nil {
			continue
		}
		dimensions := s.dimensions.Dimensions(path)
		if !dimensions.Known() {
			continue
		}
		items[index].Group.CoverWidth = dimensions.Width
		items[index].Group.CoverHeight = dimensions.Height
	}
}

func validSmartAlbumDirectoryDimension(dimension string) bool {
	return dimension == SmartAlbumDimensionAll || dimension == "featured" || validSmartAlbumDimension(dimension)
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

// smartAlbumDimensions 是每本照片相册都要算的四个详细分类维度。
func smartAlbumDimensions() []string {
	return smartAlbumDetailDimensions()
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
	return smartAlbumDimensions()
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

func (s *SmartAlbumService) buildGroups(
	ctx context.Context,
	albumID, dimension string,
	media []smartAlbumMedia,
	mediaByID map[string]smartAlbumMedia,
	metadata map[string]AIAnalysisRecord,
	faceRecords map[string]AIAnalysisRecordSummary,
	peopleGroups []PeopleAlbumGroup,
) ([]SmartAlbumGroup, error) {
	drafts := make(map[string]*smartAlbumDraft)
	switch dimension {
	case SmartAlbumDimensionTime:
		addTimeDrafts(drafts, metadata)
	case SmartAlbumDimensionPlace:
		addPlaceDrafts(drafts, media, metadata)
	case SmartAlbumDimensionPeople:
		for _, person := range peopleGroups {
			if person.Group.Hidden || person.Group.PhotoCount < smartAlbumMinimumGroupSize {
				continue
			}
			addDraft(drafts, "person:"+person.Group.ID, person.Group.Name, person.Group.Name, person.ResourceIDs)
		}
	case SmartAlbumDimensionScene:
		vectors := s.currentSmartSceneVectorsFromMedia(media)
		for _, scene := range clusterSmartScenes(vectors) {
			addDraft(drafts, "scene:"+scene.anchor, "相似场景", "相似场景", scene.members)
		}
		if len(drafts) > 0 {
			if err := s.nameSceneDrafts(ctx, drafts, vectors); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				// Scene grouping does not depend on text inference. A missing Worker or
				// failed label request leaves the conservative generic name in place.
			}
		}
		sceneKeys := make([]string, 0, len(drafts))
		for key := range drafts {
			if strings.HasPrefix(key, "scene:") {
				sceneKeys = append(sceneKeys, key)
			}
		}
		sort.Strings(sceneKeys)
		for index, key := range sceneKeys {
			if drafts[key].name == "相似场景" {
				drafts[key].name = fmt.Sprintf("相似场景 %02d", index+1)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	groups := make([]SmartAlbumGroup, 0, len(drafts))
	mediaOrder := make(map[string]int, len(media))
	for index, item := range media {
		mediaOrder[item.id] = index
	}
	for _, draft := range drafts {
		members := make([]string, 0, len(draft.members))
		for id := range draft.members {
			if _, exists := mediaByID[id]; exists {
				members = append(members, id)
			}
		}
		sort.Slice(members, func(i, j int) bool { return mediaOrder[members[i]] < mediaOrder[members[j]] })
		if len(members) < smartAlbumMinimumGroupSize {
			continue
		}
		cover := mediaByID[members[0]]
		groups = append(groups, SmartAlbumGroup{
			ID: smartGroupID(dimension, draft.key), Dimension: dimension,
			Name: draft.name, SuggestedName: draft.name, PhotoCount: len(members),
			CoverResourceID: cover.id, CoverVersion: cover.version, Members: members, sortKey: draft.sortKey,
		})
	}
	sortSmartAlbumGroups(groups, dimension)
	return groups, nil
}

func addTimeDrafts(drafts map[string]*smartAlbumDraft, records map[string]AIAnalysisRecord) {
	byDay := make(map[string][]smartCapture)
	for resourceID, record := range records {
		if record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil {
			continue
		}
		captured, ok := parseSmartCaptureTime(metadata.DateTimeOriginal)
		if !ok {
			continue
		}
		day := captured.Format("2006-01-02")
		byDay[day] = append(byDay[day], smartCapture{resourceID: resourceID, captured: captured})
	}
	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	sort.Strings(days)
	for _, day := range days {
		photos := byDay[day]
		sort.Slice(photos, func(i, j int) bool {
			if photos[i].captured.Equal(photos[j].captured) {
				return photos[i].resourceID < photos[j].resourceID
			}
			return photos[i].captured.Before(photos[j].captured)
		})
		segments := splitSmartCaptureSessions(photos)
		for sessionIndex, segment := range segments {
			if len(segment) < smartAlbumMinimumGroupSize {
				continue
			}
			name := segment[0].captured.Format("2006年1月2日")
			if len(segments) > 1 {
				start := segment[0].captured.Format("15:04")
				end := segment[len(segment)-1].captured.Format("15:04")
				name += " · " + start + "–" + end
			}
			members := make([]string, 0, len(segment))
			for _, photo := range segment {
				members = append(members, photo.resourceID)
			}
			key := "date:" + day + ":" + segment[0].resourceID
			if len(segments) == 1 {
				key = "date:" + day
			}
			sortKey := segment[0].captured.Format(time.RFC3339Nano)
			if sessionIndex > 0 {
				sortKey += ":" + strconv.Itoa(sessionIndex)
			}
			addDraft(drafts, key, name, sortKey, members)
		}
	}
}

type smartCapture struct {
	resourceID string
	captured   time.Time
}

func parseSmartCaptureTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	layouts := []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05"}
	for _, layout := range layouts {
		captured, err := time.Parse(layout, value)
		if err != nil {
			continue
		}
		year := captured.Year()
		if year < 1900 || year > time.Now().Year()+1 {
			return time.Time{}, false
		}
		return captured, true
	}
	return time.Time{}, false
}

func splitSmartCaptureSessions(photos []smartCapture) [][]smartCapture {
	if len(photos) == 0 {
		return nil
	}
	gaps := make([]float64, 0, len(photos)-1)
	for index := 1; index < len(photos); index++ {
		gaps = append(gaps, photos[index].captured.Sub(photos[index-1].captured).Seconds())
	}
	threshold := 30 * 60.0
	if len(gaps) > 0 {
		median := medianFloat64(gaps)
		deviations := make([]float64, len(gaps))
		for index, gap := range gaps {
			deviations[index] = math.Abs(gap - median)
		}
		threshold = math.Max(threshold, median+4*medianFloat64(deviations))
	}
	threshold = math.Min(threshold, 8*60*60)
	segments := make([][]smartCapture, 0, 4)
	start := 0
	for index := 1; index < len(photos); index++ {
		gap := photos[index].captured.Sub(photos[index-1].captured).Seconds()
		if gap > threshold {
			segments = append(segments, append([]smartCapture(nil), photos[start:index]...))
			start = index
		}
	}
	segments = append(segments, append([]smartCapture(nil), photos[start:]...))
	return segments
}

func medianFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64(nil), values...)
	sort.Float64s(ordered)
	middle := len(ordered) / 2
	if len(ordered)%2 == 1 {
		return ordered[middle]
	}
	return (ordered[middle-1] + ordered[middle]) / 2
}

func addPlaceDrafts(drafts map[string]*smartAlbumDraft, media []smartAlbumMedia, records map[string]AIAnalysisRecord) {
	metadataIndex, _ := loadChinaAdminIndex()
	type smartPlacePoint struct {
		id        string
		latitude  float64
		longitude float64
		chain     []*chinaAdminFeature
	}
	points := make([]smartPlacePoint, 0)
	maxDepth := 0
	for _, item := range media {
		record, exists := records[item.id]
		if !exists || record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil || metadata.GPS == nil ||
			!validCoordinates(metadata.GPS.Latitude, metadata.GPS.Longitude) {
			continue
		}
		gps := metadata.GPS
		longitude, latitude, datumValid := coordinatesToChinaMap(gps.Longitude, gps.Latitude, gps.MapDatum)
		point := smartPlacePoint{id: item.id, latitude: gps.Latitude, longitude: gps.Longitude}
		if datumValid && metadataIndex != nil {
			province := matchingChinaFeature(metadataIndex.provinces, longitude, latitude)
			if province != nil {
				area := deepestChinaFeature(metadataIndex, province, longitude, latitude)
				if area == nil {
					area = province
				}
				for current := area; current != nil; current = metadataIndex.byAdcode[current.parentAdcode] {
					point.chain = append(point.chain, current)
					if current.parentAdcode == 0 {
						break
					}
				}
				for left, right := 0, len(point.chain)-1; left < right; left, right = left+1, right-1 {
					point.chain[left], point.chain[right] = point.chain[right], point.chain[left]
				}
			}
		}
		maxDepth = max(maxDepth, len(point.chain))
		points = append(points, point)
	}
	if len(points) == 0 {
		return
	}
	maxGroups := max(1, min(12, int(math.Ceil(math.Sqrt(float64(len(points))/8)))))
	level := maxDepth
	if level == 0 {
		level = 3
	}
	type smartPlaceBucket struct {
		name    string
		members []string
	}
	buckets := map[string]*smartPlaceBucket{}
	for currentLevel := level; currentLevel >= 0; currentLevel-- {
		buckets = make(map[string]*smartPlaceBucket)
		for _, point := range points {
			key, name := "", ""
			if currentLevel > 0 && len(point.chain) >= currentLevel {
				feature := point.chain[currentLevel-1]
				key = "admin:" + strconv.Itoa(feature.adcode)
				name = chinaFeatureLabel(metadataIndex, feature)
			} else {
				precision := min(5, max(2, currentLevel+2))
				key = "cell:" + encodeSmartGeohash(point.latitude, point.longitude, precision)
			}
			bucket := buckets[key]
			if bucket == nil {
				bucket = &smartPlaceBucket{name: name}
				buckets[key] = bucket
			}
			if bucket.name == "" {
				bucket.name = name
			}
			bucket.members = append(bucket.members, point.id)
		}
		if len(buckets) <= maxGroups || currentLevel == 0 {
			break
		}
	}
	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	nearbyIndex := 0
	for _, key := range keys {
		bucket := buckets[key]
		if len(bucket.members) < smartAlbumMinimumGroupSize {
			continue
		}
		name := bucket.name
		if name == "" {
			nearbyIndex++
			name = fmt.Sprintf("附近位置 %02d", nearbyIndex)
		}
		addDraft(drafts, "place:"+key, name, key, bucket.members)
	}
}

func chinaFeatureLabel(index *chinaAdminIndex, feature *chinaAdminFeature) string {
	if index == nil || feature == nil {
		return ""
	}
	parts := make([]string, 0, 3)
	current := feature
	for depth := 0; current != nil && depth < 3; depth++ {
		if current.name != "" {
			parts = append(parts, current.name)
		}
		if current.parentAdcode == 0 {
			break
		}
		current = index.byAdcode[current.parentAdcode]
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return strings.Join(parts, " · ")
}

func encodeSmartGeohash(latitude, longitude float64, precision int) string {
	const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz"
	latMin, latMax := -90.0, 90.0
	lonMin, lonMax := -180.0, 180.0
	result := make([]byte, 0, precision)
	value, bits, even := 0, 0, true
	for len(result) < precision {
		value <<= 1
		if even {
			middle := (lonMin + lonMax) / 2
			if longitude >= middle {
				value |= 1
				lonMin = middle
			} else {
				lonMax = middle
			}
		} else {
			middle := (latMin + latMax) / 2
			if latitude >= middle {
				value |= 1
				latMin = middle
			} else {
				latMax = middle
			}
		}
		even = !even
		bits++
		if bits == 5 {
			result = append(result, alphabet[value])
			value, bits = 0, 0
		}
	}
	return string(result)
}

type smartSceneVector struct {
	id     string
	vector []float32
}

type smartSceneCluster struct {
	anchor   string
	members  []string
	cohesion float64
}

func normalizeSmartVector(values []float32) []float32 {
	if len(values) != AIEmbeddingDimension {
		return nil
	}
	norm := 0.0
	for _, value := range values {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil
		}
		norm += float64(value) * float64(value)
	}
	if norm == 0 {
		return nil
	}
	length := float32(math.Sqrt(norm))
	result := make([]float32, len(values))
	for index, value := range values {
		result[index] = value / length
	}
	return result
}

func clusterSmartScenes(vectors []smartSceneVector) []smartSceneCluster {
	if len(vectors) < smartAlbumMinimumGroupSize {
		return nil
	}
	index := newPeopleANNIndexForDimension(AIEmbeddingDimension)
	index.efConstruction = smartSceneANNConstruction
	index.efSearch = smartSceneANNSearch
	positionByID := make(map[string]int, len(vectors))
	for position, item := range vectors {
		index.Add(item.id, item.vector)
		positionByID[item.id] = position
	}
	neighbors := make([]map[int]float32, len(vectors))
	limit := min(16, len(vectors))
	for position, item := range vectors {
		neighbors[position] = make(map[int]float32, limit)
		for _, hit := range index.Search(item.vector, limit) {
			neighborPosition, exists := positionByID[hit.id]
			if !exists || neighborPosition == position {
				continue
			}
			neighbors[position][neighborPosition] = hit.score
		}
	}
	// Mutual neighbors find local photo sets. A fixed cosine floor keeps the
	// threshold interpretable; random-pair P99 made it depend on unrelated
	// photos elsewhere in the folder.
	threshold := float32(smartSceneSimilarityFloor)
	parents := make([]int, len(vectors))
	for index := range parents {
		parents[index] = index
	}
	var find func(int) int
	find = func(value int) int {
		if parents[value] != value {
			parents[value] = find(parents[value])
		}
		return parents[value]
	}
	union := func(left, right int) {
		leftRoot, rightRoot := find(left), find(right)
		if leftRoot != rightRoot {
			if leftRoot < rightRoot {
				parents[rightRoot] = leftRoot
			} else {
				parents[leftRoot] = rightRoot
			}
		}
	}
	for left, candidates := range neighbors {
		for right, score := range candidates {
			if right <= left || score < threshold {
				continue
			}
			reverse, mutual := neighbors[right][left]
			if mutual && reverse >= threshold {
				union(left, right)
			}
		}
	}
	components := make(map[int][]string)
	for position, item := range vectors {
		components[find(position)] = append(components[find(position)], item.id)
	}
	vectorByID := make(map[string][]float32, len(vectors))
	for _, item := range vectors {
		vectorByID[item.id] = item.vector
	}
	result := make([]smartSceneCluster, 0, len(components))
	for _, members := range components {
		if len(members) < smartAlbumMinimumGroupSize {
			continue
		}
		sort.Strings(members)
		memberSet := make(map[string]struct{}, len(members))
		for _, id := range members {
			memberSet[id] = struct{}{}
		}
		cohesion := smartRecommendationSceneCohesion(memberSet, vectorByID)
		if cohesion < 0.80 {
			continue
		}
		result = append(result, smartSceneCluster{anchor: members[0], members: members, cohesion: cohesion})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].anchor < result[j].anchor })
	return result
}

func smartVectorDot(left, right []float32) float32 {
	var score float32
	for index, value := range left {
		score += value * right[index]
	}
	return score
}

var smartSceneLabels = []string{
	"海边、海浪与海岸", "山脉、山峰与峡谷", "森林、树木与绿地", "花卉、植物与庭院",
	"城市街道与建筑", "室内空间与家具", "夜景与灯光", "天空、云朵与日落",
	"雪景与冰面", "湖泊、河流与瀑布", "动物与野生生物", "猫、狗与宠物",
	"美食与餐桌", "人物与聚会", "运动与户外活动", "旅行地标与景点",
	"汽车与交通工具", "展览与艺术品", "建筑细节", "家庭日常",
	"文档、屏幕与文字", "烟花与节庆", "海岛与船只", "乡村与农田",
}

func (s *SmartAlbumService) nameSceneDrafts(
	ctx context.Context,
	drafts map[string]*smartAlbumDraft,
	vectors []smartSceneVector,
) error {
	if s.textEmbedder == nil {
		return errors.New("scene labeler is unavailable")
	}
	readyCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := s.textEmbedder.Ready(readyCtx); err != nil {
		return err
	}
	prompts := make([]string, len(smartSceneLabels))
	for index, label := range smartSceneLabels {
		prompts[index] = "一张关于" + label + "的照片"
	}
	textVectors, err := s.textEmbedder.SearchTexts(readyCtx, prompts)
	if err != nil {
		return err
	}
	if len(textVectors) != len(smartSceneLabels) {
		return errors.New("scene labeler returned an incomplete result")
	}
	vectorByID := make(map[string][]float32, len(vectors))
	for _, item := range vectors {
		vectorByID[item.id] = item.vector
	}
	draftKeys := make([]string, 0, len(drafts))
	for key := range drafts {
		if strings.HasPrefix(key, "scene:") {
			draftKeys = append(draftKeys, key)
		}
	}
	sort.Strings(draftKeys)
	for index, key := range draftKeys {
		draft := drafts[key]
		centroid := make([]float32, AIEmbeddingDimension)
		count := 0
		for resourceID := range draft.members {
			vector := vectorByID[resourceID]
			if len(vector) != AIEmbeddingDimension {
				continue
			}
			for position, value := range vector {
				centroid[position] += value
			}
			count++
		}
		if count == 0 {
			continue
		}
		centroid = normalizeSmartVector(centroid)
		if centroid == nil {
			continue
		}
		bestLabel, bestScore := "", float32(-1)
		for labelIndex, candidate := range textVectors {
			candidate = normalizeSmartVector(candidate)
			if candidate == nil {
				continue
			}
			score := smartVectorDot(centroid, candidate)
			if score > bestScore {
				bestScore = score
				bestLabel = smartSceneLabels[labelIndex]
			}
		}
		if bestLabel != "" {
			draft.name = "建议 · " + bestLabel
		}
		if draft.sortKey == "" {
			draft.sortKey = strings.TrimPrefix(key, "scene:")
		}
		if draft.name == "" {
			draft.name = fmt.Sprintf("相似场景 %02d", index+1)
		}
	}
	return nil
}

func addDraft(drafts map[string]*smartAlbumDraft, key, name, sortKey string, members []string) {
	draft := drafts[key]
	if draft == nil {
		draft = &smartAlbumDraft{key: key, name: name, sortKey: sortKey, members: make(map[string]struct{})}
		drafts[key] = draft
	}
	if draft.name == "" {
		draft.name = name
	}
	if draft.sortKey == "" {
		draft.sortKey = sortKey
	}
	for _, resourceID := range members {
		draft.members[resourceID] = struct{}{}
	}
}

func sortSmartAlbumGroups(groups []SmartAlbumGroup, dimension string) {
	sort.Slice(groups, func(i, j int) bool {
		if dimension == SmartAlbumDimensionTime && groups[i].sortKey != groups[j].sortKey {
			return groups[i].sortKey > groups[j].sortKey
		}
		if groups[i].PhotoCount != groups[j].PhotoCount {
			return groups[i].PhotoCount > groups[j].PhotoCount
		}
		if groups[i].Name != groups[j].Name {
			return strings.ToLower(groups[i].Name) < strings.ToLower(groups[j].Name)
		}
		return groups[i].ID < groups[j].ID
	})
}

func (s *SmartAlbumService) analysisFingerprint(
	dimension string,
	albumName string,
	media []smartAlbumMedia,
	metadata map[string]AIAnalysisRecord,
	face map[string]AIAnalysisRecordSummary,
	people []PeopleAlbumGroup,
	metadataStatus, faceStatus, embeddingStatus AIJobModule,
) string {
	hash := sha256.New()
	write := func(value string) {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	switch dimension {
	case SmartAlbumDimensionTime, SmartAlbumDimensionPlace:
		write(metadataStatus.Version)
		ids := make([]string, 0, len(metadata))
		for id := range metadata {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			record := metadata[id]
			dataHash := sha256.Sum256(record.Data)
			write(fmt.Sprintf("%s:%s:%s", id, record.Status, hex.EncodeToString(dataHash[:])))
		}
	case SmartAlbumDimensionPeople:
		write(faceStatus.Version)
		ids := make([]string, 0, len(face))
		for id := range face {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			record := face[id]
			write(fmt.Sprintf("%s:%s:%d:%d:%s", id, record.Status, record.Size, record.MTimeNs, record.ModuleVersion))
		}
		for _, group := range people {
			write(group.Group.ID + ":" + group.Group.Name + ":" + group.Fingerprint)
		}
	case SmartAlbumDimensionScene:
		write(embeddingStatus.Version)
		if s.vectors != nil {
			vectorBytes := make([]byte, AIEmbeddingDimension*4)
			for _, item := range media {
				vector, ok := s.vectors.Vector(item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
				if !ok {
					continue
				}
				write(item.id)
				for index, value := range vector {
					binary.LittleEndian.PutUint32(vectorBytes[index*4:], math.Float32bits(value))
				}
				_, _ = hash.Write(vectorBytes)
			}
		}
	case SmartAlbumDimensionRecommended:
		write(albumName)
		write(metadataStatus.Version)
		write(faceStatus.Version)
		write(embeddingStatus.Version)
		for _, detailDimension := range smartAlbumDetailDimensions() {
			write(smartAlbumAlgorithmVersion(detailDimension))
		}
		metadataIDs := make([]string, 0, len(metadata))
		for id := range metadata {
			metadataIDs = append(metadataIDs, id)
		}
		sort.Strings(metadataIDs)
		for _, id := range metadataIDs {
			record := metadata[id]
			dataHash := sha256.Sum256(record.Data)
			write(fmt.Sprintf("%s:%s:%s", id, record.Status, hex.EncodeToString(dataHash[:])))
		}
		faceIDs := make([]string, 0, len(face))
		for id := range face {
			faceIDs = append(faceIDs, id)
		}
		sort.Strings(faceIDs)
		for _, id := range faceIDs {
			record := face[id]
			write(fmt.Sprintf("%s:%s:%d:%d:%s", id, record.Status, record.Size, record.MTimeNs, record.ModuleVersion))
		}
		for _, group := range people {
			write(group.Group.ID + ":" + group.Group.Name + ":" + group.Fingerprint)
		}
		if s.vectors != nil {
			vectorBytes := make([]byte, AIEmbeddingDimension*4)
			for _, item := range media {
				vector, ok := s.vectors.Vector(item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
				if !ok {
					continue
				}
				write(item.id)
				for index, value := range vector {
					binary.LittleEndian.PutUint32(vectorBytes[index*4:], math.Float32bits(value))
				}
				_, _ = hash.Write(vectorBytes)
			}
		}
	}
	if dimension == SmartAlbumDimensionPlace {
		write(chinaBoundaryVersion)
	}
	write(smartAlbumAlgorithmVersion(dimension))
	return hex.EncodeToString(hash.Sum(nil))
}

func smartAlbumCacheKey(albumID, dimension string, media []smartAlbumMedia, analysisFingerprint string) string {
	hash := sha256.New()
	_, _ = fmt.Fprintf(hash, "%s\x00%s\x00%s\x00", albumID, dimension, smartAlbumAlgorithmVersion(dimension))
	for _, item := range media {
		_, _ = fmt.Fprintf(hash, "%s\x00%d\x00%d\n", item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
	}
	_, _ = hash.Write([]byte(analysisFingerprint))
	return hex.EncodeToString(hash.Sum(nil))
}

func (s *SmartAlbumService) cachePath(albumID, dimension string) string {
	hash := sha256.Sum256([]byte(albumID + "\x00" + dimension))
	return filepath.Join(s.cacheDir, hex.EncodeToString(hash[:])+".json")
}

func readSmartAlbumCache(path, albumID, dimension, key string) (smartAlbumCache, bool) {
	cache, ok := readSmartAlbumCacheFile(path, albumID, dimension)
	if !ok || cache.Key != key {
		return smartAlbumCache{}, false
	}
	return cache, true
}

// readSmartAlbumCacheFile 读一本相册某个维度的分组缓存。
//
// 只看缓存自身的身份（版本、相册、维度），不比对媒体指纹：目录要的是
// 「已经生成了哪些分组」，指纹变了也照旧列出来，等刷新任务更新。
func readSmartAlbumCacheFile(path, albumID, dimension string) (smartAlbumCache, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return smartAlbumCache{}, false
	}
	var cache smartAlbumCache
	if json.Unmarshal(data, &cache) != nil || cache.Version < 1 || cache.Version > smartAlbumCacheVersion ||
		cache.AlbumID != albumID || cache.Dimension != dimension || cache.Groups == nil {
		return smartAlbumCache{}, false
	}
	return cache, true
}

// readCachedGroups 读一本相册某个维度已生成的分组；没有缓存就是没有。
func (s *SmartAlbumService) readCachedGroups(albumID, dimension string) (smartAlbumCache, bool) {
	return readSmartAlbumCacheFile(s.cachePath(albumID, dimension), albumID, dimension)
}

func cacheSmartAlbumGroups(groups []SmartAlbumGroup) []smartAlbumCachedGroup {
	result := make([]smartAlbumCachedGroup, len(groups))
	for index, group := range groups {
		result[index] = smartAlbumCachedGroup{
			ID: group.ID, Dimension: group.Dimension, Name: group.SuggestedName,
			SuggestedName: group.SuggestedName, PhotoCount: group.PhotoCount,
			QualityScore: group.QualityScore, EvidenceDimensions: append([]string(nil), group.EvidenceDimensions...),
			RecommendationReasons: append([]string(nil), group.RecommendationReasons...),
			OverrideConflict:      group.OverrideConflict, OverrideSources: append([]string(nil), group.overrideSources...),
			CoverResourceID: group.CoverResourceID, CoverVersion: group.CoverVersion,
			Members: append([]string(nil), group.Members...), sortKey: group.sortKey,
		}
	}
	return result
}

func smartAlbumGroups(groups []smartAlbumCachedGroup) []SmartAlbumGroup {
	result := make([]SmartAlbumGroup, len(groups))
	for index, group := range groups {
		result[index] = SmartAlbumGroup{
			ID: group.ID, Dimension: group.Dimension, Name: group.Name,
			SuggestedName: group.SuggestedName, PhotoCount: group.PhotoCount,
			QualityScore: group.QualityScore, EvidenceDimensions: append([]string(nil), group.EvidenceDimensions...),
			RecommendationReasons: append([]string(nil), group.RecommendationReasons...),
			OverrideConflict:      group.OverrideConflict, overrideSources: append([]string(nil), group.OverrideSources...),
			CoverResourceID: group.CoverResourceID, CoverVersion: group.CoverVersion,
			Members: append([]string(nil), group.Members...), sortKey: group.sortKey,
		}
	}
	return result
}

func smartAlbumAlgorithmVersion(dimension string) string {
	switch dimension {
	case SmartAlbumDimensionRecommended:
		return smartAlbumRecommendedVersion
	case SmartAlbumDimensionTime:
		return smartAlbumTimeVersion
	case SmartAlbumDimensionPlace:
		return smartAlbumPlaceVersion
	case SmartAlbumDimensionPeople:
		return smartAlbumPeopleVersion + "-" + strconv.Itoa(peopleGroupingVersion)
	case SmartAlbumDimensionScene:
		return smartAlbumSceneVersion
	default:
		return ""
	}
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

func currentAnalysisRecords(records map[string]AIAnalysisRecord, fingerprints map[string]smartAlbumFileFingerprint) map[string]AIAnalysisRecord {
	result := make(map[string]AIAnalysisRecord, len(records))
	for id, record := range records {
		fingerprint, exists := fingerprints[id]
		if exists && record.Size == fingerprint.Size && record.MTimeNs == fingerprint.MTimeNs {
			result[id] = record
		}
	}
	return result
}

func currentAnalysisSummaries(records map[string]AIAnalysisRecordSummary, fingerprints map[string]smartAlbumFileFingerprint) map[string]AIAnalysisRecordSummary {
	result := make(map[string]AIAnalysisRecordSummary, len(records))
	for id, record := range records {
		fingerprint, exists := fingerprints[id]
		if exists && record.Size == fingerprint.Size && record.MTimeNs == fingerprint.MTimeNs {
			result[id] = record
		}
	}
	return result
}

func currentFingerprints(records map[string]AIAnalysisRecordSummary, fingerprints map[string]smartAlbumFileFingerprint) map[string]smartAlbumFileFingerprint {
	result := make(map[string]smartAlbumFileFingerprint, len(records))
	for id := range records {
		if fingerprint, exists := fingerprints[id]; exists {
			result[id] = fingerprint
		}
	}
	return result
}

func coverageForRecords(total, available int, records map[string]AIAnalysisRecord, module AIJobModule) SmartAlbumCoverage {
	coverage := SmartAlbumCoverage{Module: module.Type, Total: total, Available: module.Installed, Reason: module.Reason}
	for _, record := range records {
		if record.Status == "failed" {
			coverage.Failed++
		} else {
			coverage.Analyzed++
		}
	}
	coverage.Missing = max(0, total-coverage.Analyzed-coverage.Failed)
	if available < total && coverage.Missing < total-available {
		coverage.Missing = total - available
	}
	return coverage
}

func coverageForSummaries(total, available int, records map[string]AIAnalysisRecordSummary, module AIJobModule) SmartAlbumCoverage {
	coverage := SmartAlbumCoverage{Module: module.Type, Total: total, Available: module.Installed, Reason: module.Reason}
	for _, record := range records {
		if record.Status == "failed" {
			coverage.Failed++
		} else {
			coverage.Analyzed++
		}
	}
	coverage.Missing = max(0, total-coverage.Analyzed-coverage.Failed)
	if available < total && coverage.Missing < total-available {
		coverage.Missing = total - available
	}
	return coverage
}

func coverageForVectors(
	total, available int,
	vectors *VectorIndexStore,
	fingerprints map[string]smartAlbumFileFingerprint,
	records map[string]AIAnalysisRecordSummary,
	module AIJobModule,
) SmartAlbumCoverage {
	coverage := SmartAlbumCoverage{Module: module.Type, Total: total, Available: module.Installed, Reason: module.Reason}
	for id, fingerprint := range fingerprints {
		if vectors != nil && vectors.Current(id, fingerprint.Size, fingerprint.MTimeNs) {
			coverage.Analyzed++
			continue
		}
		if record, exists := records[id]; exists && record.Status == "failed" {
			coverage.Failed++
		}
	}
	coverage.Missing = max(0, total-coverage.Analyzed-coverage.Failed)
	if available < total && coverage.Missing < total-available {
		coverage.Missing = total - available
	}
	coverage.WithEvidence = coverage.Analyzed
	return coverage
}

func coverageForRecommendations(total, available int, groups []smartAlbumCachedGroup) SmartAlbumCoverage {
	members := make(map[string]struct{})
	for _, group := range groups {
		for _, id := range group.Members {
			members[id] = struct{}{}
		}
	}
	return SmartAlbumCoverage{
		Module: "combined", Total: total, Analyzed: available,
		Missing: max(0, total-available), WithEvidence: len(members),
		Available: available > 0,
	}
}

func peopleEvidencePhotoCount(groups []PeopleAlbumGroup) int {
	resourceIDs := make(map[string]struct{})
	for _, group := range groups {
		for _, resourceID := range group.ResourceIDs {
			resourceIDs[resourceID] = struct{}{}
		}
	}
	return len(resourceIDs)
}

func metadataEvidenceCount(records map[string]AIAnalysisRecord, dimension string) int {
	count := 0
	for _, record := range records {
		if record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil {
			continue
		}
		if dimension == SmartAlbumDimensionTime {
			if _, ok := parseSmartCaptureTime(metadata.DateTimeOriginal); ok {
				count++
			}
		} else if metadata.GPS != nil && validCoordinates(metadata.GPS.Latitude, metadata.GPS.Longitude) {
			count++
		}
	}
	return count
}

func (s *SmartAlbumService) applyOverrides(albumID, dimension string, groups []SmartAlbumGroup) []SmartAlbumGroup {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	result := make([]SmartAlbumGroup, len(groups))
	for index, group := range groups {
		group.Members = nil
		group.OverrideConflict = group.OverrideConflict && hasSmartAlbumOverrideSource(s.state.Overrides, albumID, dimension, group.overrideSources)
		if group.OverrideConflict {
			result[index] = group
			continue
		}
		if override, exists := s.state.Overrides[smartOverrideKey(albumID, dimension, group.ID)]; exists {
			group.Hidden = override.Hidden
			if override.Name != "" {
				group.Name = override.Name
				group.CustomName = true
			}
		}
		result[index] = group
	}
	return result
}

func hasSmartAlbumOverrideSource(
	overrides map[string]SmartAlbumOverride,
	albumID, dimension string,
	sources []string,
) bool {
	for _, source := range sources {
		if _, exists := overrides[smartOverrideKey(albumID, dimension, source)]; exists {
			return true
		}
	}
	return false
}

func (s *SmartAlbumService) migrateSmartAlbumOverrides(
	albumID, dimension string,
	previous []smartAlbumCachedGroup,
	groups []SmartAlbumGroup,
) ([]SmartAlbumGroup, error) {
	if len(previous) == 0 || len(groups) == 0 {
		return groups, nil
	}
	type oldOverride struct {
		id      string
		value   SmartAlbumOverride
		members map[string]struct{}
	}
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	originalOverrides := make(map[string]SmartAlbumOverride, len(s.state.Overrides))
	for key, value := range s.state.Overrides {
		originalOverrides[key] = value
	}

	oldByID := make(map[string]oldOverride)
	for _, group := range previous {
		members := make(map[string]struct{}, len(group.Members))
		for _, id := range group.Members {
			members[id] = struct{}{}
		}
		sourceIDs := append([]string{group.ID}, group.OverrideSources...)
		for _, id := range sourceIDs {
			if override, exists := s.state.Overrides[smartOverrideKey(albumID, dimension, id)]; exists {
				oldByID[id] = oldOverride{id: id, value: override, members: members}
			}
		}
	}
	if len(oldByID) == 0 {
		return groups, nil
	}
	oldIDs := make([]string, 0, len(oldByID))
	for id := range oldByID {
		oldIDs = append(oldIDs, id)
	}
	sort.Strings(oldIDs)
	matches := make(map[int][]oldOverride)
	for _, id := range oldIDs {
		old := oldByID[id]
		bestIndex, bestOverlap, bestRatio := -1, 0, -1.0
		for index, group := range groups {
			newMembers := make(map[string]struct{}, len(group.Members))
			for _, member := range group.Members {
				newMembers[member] = struct{}{}
			}
			overlap := smartRecommendationIntersection(old.members, newMembers)
			if id != group.ID {
				minimum := max(3, int(math.Ceil(float64(min(len(old.members), len(newMembers)))*0.35)))
				if overlap < minimum || float64(overlap)/float64(max(1, len(old.members))) < 0.5 ||
					float64(overlap)/float64(max(1, len(newMembers))) < 0.25 {
					continue
				}
			}
			ratio := float64(overlap) / float64(max(1, len(old.members)))
			if overlap > bestOverlap || overlap == bestOverlap && ratio > bestRatio ||
				overlap == bestOverlap && ratio == bestRatio && bestIndex >= 0 && group.ID < groups[bestIndex].ID {
				bestIndex, bestOverlap, bestRatio = index, overlap, ratio
			}
		}
		if bestIndex >= 0 {
			matches[bestIndex] = append(matches[bestIndex], old)
		}
	}
	changed := false
	for index, oldMatches := range matches {
		group := &groups[index]
		newKey := smartOverrideKey(albumID, dimension, group.ID)
		existing, hasExisting := s.state.Overrides[newKey]
		values := make([]SmartAlbumOverride, 0, len(oldMatches)+1)
		if hasExisting {
			values = append(values, existing)
		}
		for _, old := range oldMatches {
			if old.id != group.ID {
				values = append(values, old.value)
			}
		}
		if len(values) == 0 {
			continue
		}
		same := true
		for _, value := range values[1:] {
			if value != values[0] {
				same = false
				break
			}
		}
		if !same {
			group.OverrideConflict = true
			for _, old := range oldMatches {
				if old.id != group.ID {
					group.overrideSources = append(group.overrideSources, old.id)
				}
			}
			continue
		}
		if len(values) > 0 {
			s.state.Overrides[newKey] = values[0]
		}
		for _, old := range oldMatches {
			if old.id != group.ID {
				delete(s.state.Overrides, smartOverrideKey(albumID, dimension, old.id))
			}
		}
		changed = true
	}
	if changed {
		if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
			s.state.Overrides = originalOverrides
			return nil, fmt.Errorf("persist migrated smart album overrides: %w", err)
		}
	}
	return groups, nil
}

func (s *SmartAlbumService) UpdateOverride(ctx context.Context, albumID, dimension, groupID string, name *string, hidden *bool) (SmartAlbumSummary, error) {
	if name == nil && hidden == nil {
		return SmartAlbumSummary{}, ErrSmartAlbumOverride
	}
	if name != nil {
		*name = strings.TrimSpace(*name)
		if len([]rune(*name)) > 60 || strings.IndexFunc(*name, unicode.IsControl) >= 0 {
			return SmartAlbumSummary{}, ErrSmartAlbumOverride
		}
	}
	summary, err := s.Groups(ctx, albumID, dimension, false)
	if err != nil {
		return SmartAlbumSummary{}, err
	}
	var targetGroup SmartAlbumGroup
	for _, group := range summary.Groups {
		if group.ID == groupID {
			targetGroup = group
			break
		}
	}
	if targetGroup.ID == "" {
		return SmartAlbumSummary{}, ErrSmartAlbumNotFound
	}
	key := smartOverrideKey(albumID, dimension, groupID)
	s.stateMu.Lock()
	previous := s.state.Overrides[key]
	removed := make(map[string]SmartAlbumOverride)
	for _, source := range targetGroup.overrideSources {
		sourceKey := smartOverrideKey(albumID, dimension, source)
		if value, exists := s.state.Overrides[sourceKey]; exists {
			removed[sourceKey] = value
			delete(s.state.Overrides, sourceKey)
		}
	}
	next := previous
	if name != nil {
		next.Name = *name
	}
	if hidden != nil {
		next.Hidden = *hidden
	}
	if next.Name == "" && !next.Hidden {
		delete(s.state.Overrides, key)
	} else {
		s.state.Overrides[key] = next
	}
	if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
		if previous.Name == "" && !previous.Hidden {
			delete(s.state.Overrides, key)
		} else {
			s.state.Overrides[key] = previous
		}
		for sourceKey, value := range removed {
			s.state.Overrides[sourceKey] = value
		}
		s.stateMu.Unlock()
		return SmartAlbumSummary{}, fmt.Errorf("persist smart album override: %w", err)
	}
	s.stateMu.Unlock()
	s.directoryRevision.Add(1)
	return s.Groups(ctx, albumID, dimension, false)
}

func smartOverrideKey(albumID, dimension, groupID string) string {
	return albumID + "/" + dimension + "/" + groupID
}

func (s *SmartAlbumService) Corrections() SmartAlbumCorrections {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	corrections := SmartAlbumCorrections{
		Version: s.state.Version, Overrides: make(map[string]SmartAlbumOverride, len(s.state.Overrides)),
	}
	for key, value := range s.state.Overrides {
		corrections.Overrides[key] = value
	}
	return corrections
}

func (s *SmartAlbumService) ReplaceCorrections(corrections SmartAlbumCorrections) error {
	if !validSmartAlbumCorrections(corrections) {
		return ErrSmartAlbumOverride
	}
	next := smartAlbumState{
		Version: smartAlbumStateVersion, Overrides: make(map[string]SmartAlbumOverride, len(corrections.Overrides)),
	}
	for key, value := range corrections.Overrides {
		next.Overrides[key] = value
	}
	s.stateMu.Lock()
	previous := s.state
	s.state = next
	if err := writeAIJSONAtomic(s.statePath, s.state); err != nil {
		s.state = previous
		s.stateMu.Unlock()
		return err
	}
	s.stateMu.Unlock()
	s.directoryRevision.Add(1)
	return nil
}

func validSmartAlbumCorrections(corrections SmartAlbumCorrections) bool {
	if corrections.Version != smartAlbumStateVersion || len(corrections.Overrides) > 100000 {
		return false
	}
	for key, override := range corrections.Overrides {
		parts := strings.Split(key, "/")
		if len(parts) != 3 || !models.IsAlbumID(parts[0]) || !validSmartAlbumDimension(parts[1]) ||
			!validSmartGroupID(parts[2]) || override.Name == "" && !override.Hidden ||
			override.Name != strings.TrimSpace(override.Name) || len([]rune(override.Name)) > 60 ||
			strings.IndexFunc(override.Name, unicode.IsControl) >= 0 {
			return false
		}
	}
	return true
}

func validSmartGroupID(groupID string) bool {
	if len(groupID) != 23 || !strings.HasPrefix(groupID, "sg_") {
		return false
	}
	_, err := hex.DecodeString(groupID[3:])
	return err == nil
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

func (s *SmartAlbumService) applyOverrideSnapshot() smartAlbumState {
	s.stateMu.Lock()
	defer s.stateMu.Unlock()
	result := smartAlbumState{Version: s.state.Version, Overrides: make(map[string]SmartAlbumOverride, len(s.state.Overrides))}
	for key, value := range s.state.Overrides {
		result.Overrides[key] = value
	}
	return result
}

func coverageForModule(total int, module AIJobModule) SmartAlbumCoverage {
	return SmartAlbumCoverage{Module: module.Type, Total: total, Missing: total, Available: module.Installed, Reason: module.Reason}
}
