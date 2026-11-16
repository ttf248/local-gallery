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
	"math/rand"
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
	SmartAlbumDimensionTime   = "time"
	SmartAlbumDimensionPlace  = "place"
	SmartAlbumDimensionPeople = "people"
	SmartAlbumDimensionScene  = "scene"
	SmartAlbumDimensionAll    = "all"

	smartAlbumStateVersion     = 1
	smartAlbumCacheVersion     = 1
	smartAlbumTimeVersion      = "time-day-session-v1"
	smartAlbumPlaceVersion     = "place-offline-admin-v1"
	smartAlbumPeopleVersion    = "people-album-members-v1"
	smartAlbumSceneVersion     = "scene-mutual-ann-v9"
	smartAlbumMinimumGroupSize = 3
	smartAlbumStatWorkers      = 8
	smartSceneSimilarityFloor  = 0.72
	smartSceneANNConstruction  = 40
	smartSceneANNSearch        = 16
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
	ID              string `json:"id"`
	Dimension       string `json:"dimension"`
	Name            string `json:"name"`
	SuggestedName   string `json:"suggestedName"`
	CustomName      bool   `json:"customName"`
	PhotoCount      int    `json:"photoCount"`
	CoverResourceID string `json:"coverResourceId,omitempty"`
	CoverVersion    string `json:"coverVersion,omitempty"`
	// CoverWidth 与 CoverHeight 是封面图的原始像素尺寸。
	//
	// 目录页把分组排成瀑布流，卡片高度得跟着封面的真实比例走，
	// 否则一面墙上全是等高的卡片，竖幅照片全被裁掉。
	// 尺寸按请求时探测（只读图片头），因此不进缓存：
	// 缓存里存的是「分组有哪些成员」，不是媒体的呈现属性。
	CoverWidth  int      `json:"coverWidth,omitempty"`
	CoverHeight int      `json:"coverHeight,omitempty"`
	Hidden      bool     `json:"hidden"`
	Members     []string `json:"-"`
	sortKey     string   `json:"sortKey,omitempty"`
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
	ID              string   `json:"id"`
	Dimension       string   `json:"dimension"`
	Name            string   `json:"name"`
	SuggestedName   string   `json:"suggestedName"`
	PhotoCount      int      `json:"photoCount"`
	CoverResourceID string   `json:"coverResourceId,omitempty"`
	CoverVersion    string   `json:"coverVersion,omitempty"`
	Members         []string `json:"members"`
	sortKey         string   `json:"sortKey,omitempty"`
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
	albumID string
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
		albumID: albumID, revision: snapshot.Revision(),
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
	if s.people != nil && dimension == SmartAlbumDimensionPeople {
		peopleGroups = s.people.AlbumGroups(currentFingerprints(input.face, input.fingerprints))
		faceCoverage.WithEvidence = peopleEvidencePhotoCount(peopleGroups)
		if !s.jobs.PeopleEnabled() {
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

	analysisFingerprint := s.analysisFingerprint(
		dimension, input.media, input.metadata, input.face, peopleGroups,
		input.metadataStatus, input.faceStatus, input.embeddingStatus,
	)
	key := smartAlbumCacheKey(input.albumID, dimension, input.media, analysisFingerprint)
	cachePath := s.cachePath(input.albumID, dimension)
	cache, cacheHit := smartAlbumCache{}, false
	if !force {
		cache, cacheHit = readSmartAlbumCache(cachePath, input.albumID, dimension, key)
	}
	if !cacheHit {
		groups, buildErr := s.buildGroups(
			ctx, input.albumID, dimension, input.media, input.mediaByID,
			input.metadata, input.face, peopleGroups,
		)
		if buildErr != nil {
			return SmartAlbumSummary{}, buildErr
		}
		cache = smartAlbumCache{
			Version: smartAlbumCacheVersion, AlbumID: input.albumID, Dimension: dimension,
			Key: key, Fingerprints: input.fingerprints, Groups: cacheSmartAlbumGroups(groups),
		}
		if err := writeAIJSONAtomic(cachePath, cache); err != nil {
			return SmartAlbumSummary{}, fmt.Errorf("persist smart album cache: %w", err)
		}
		s.directoryRevision.Add(1)
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
	items := make([]SmartAlbumDirectoryItem, 0)
	for _, album := range snapshot.PhotoAlbumSummaries() {
		for _, currentDimension := range dimensions {
			if err := ctx.Err(); err != nil {
				return LibraryPage[SmartAlbumDirectoryItem]{}, err
			}
			cache, ok := s.readCachedGroups(album.ID, currentDimension)
			if !ok {
				continue
			}
			for _, group := range s.applyOverrides(album.ID, currentDimension, smartAlbumGroups(cache.Groups)) {
				if group.Hidden {
					continue
				}
				items = append(items, SmartAlbumDirectoryItem{
					AlbumID: album.ID, AlbumName: album.DisplayName,
					ParentName: album.ParentName, Group: group,
				})
			}
		}
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

func smartAlbumDirectoryScope(dimension string, revision uint64) string {
	return fmt.Sprintf("smart-album-directory:%s:%d", dimension, revision)
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
	return dimension == SmartAlbumDimensionAll || validSmartAlbumDimension(dimension)
}

// SweepSmartAlbums prepares the four folder-scoped dimensions for every photo
// album. It reuses matching derived caches and rebuilds only summaries whose
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
	dimensions := smartAlbumDimensions()
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

// smartAlbumDimensions 是每本照片相册都要算的四个分组维度。
func smartAlbumDimensions() []string {
	return []string{
		SmartAlbumDimensionTime,
		SmartAlbumDimensionPlace,
		SmartAlbumDimensionPeople,
		SmartAlbumDimensionScene,
	}
}

func smartAlbumDirectoryDimensions(dimension string) []string {
	if dimension != SmartAlbumDimensionAll {
		return []string{dimension}
	}
	return smartAlbumDimensions()
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
		vectors := make([]smartSceneVector, 0, len(media))
		if s.vectors != nil {
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
		}
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
	labels := make(map[string]string)
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
		locationKey := ""
		locationName := ""
		if datumValid && metadataIndex != nil {
			province := matchingChinaFeature(metadataIndex.provinces, longitude, latitude)
			if province != nil {
				if area := deepestChinaFeature(metadataIndex, province, longitude, latitude); area != nil {
					locationKey = "admin:" + strconv.Itoa(area.adcode)
					locationName = chinaFeatureLabel(metadataIndex, area)
				}
			}
		}
		if locationKey == "" {
			locationKey = "cell:" + encodeSmartGeohash(gps.Latitude, gps.Longitude, 5)
		}
		if locationName != "" {
			labels[locationKey] = locationName
		}
		addDraft(drafts, "place:"+locationKey, locationName, locationKey, []string{item.id})
	}
	cellKeys := make([]string, 0)
	for key, draft := range drafts {
		if strings.HasPrefix(key, "place:cell:") && draft.name == "" {
			cellKeys = append(cellKeys, key)
		}
	}
	sort.Strings(cellKeys)
	for index, key := range cellKeys {
		drafts[key].name = fmt.Sprintf("附近位置 %02d", index+1)
	}
	for _, draft := range drafts {
		if len(draft.members) < smartAlbumMinimumGroupSize {
			continue
		}
		if draft.name == "" {
			locationKey := strings.TrimPrefix(draft.key, "place:")
			if strings.HasPrefix(locationKey, "admin:") {
				draft.name = labels[locationKey]
			}
		}
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
	anchor  string
	members []string
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
	threshold := max(float32(smartSceneSimilarityFloor), smartSceneBackgroundThreshold(vectors))
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
	result := make([]smartSceneCluster, 0, len(components))
	for _, members := range components {
		if len(members) < smartAlbumMinimumGroupSize {
			continue
		}
		sort.Strings(members)
		result = append(result, smartSceneCluster{anchor: members[0], members: members})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].anchor < result[j].anchor })
	return result
}

func smartSceneBackgroundThreshold(vectors []smartSceneVector) float32 {
	if len(vectors) < 2 {
		return 1
	}
	rng := rand.New(rand.NewSource(42))
	sampleCount := min(4096, len(vectors)*8)
	scores := make([]float64, 0, sampleCount)
	for len(scores) < sampleCount {
		left, right := rng.Intn(len(vectors)), rng.Intn(len(vectors))
		if left == right {
			continue
		}
		scores = append(scores, float64(smartVectorDot(vectors[left].vector, vectors[right].vector)))
	}
	sort.Float64s(scores)
	index := int(math.Ceil(float64(len(scores))*0.99)) - 1
	index = max(0, min(index, len(scores)-1))
	return float32(scores[index])
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
	if json.Unmarshal(data, &cache) != nil || cache.Version != smartAlbumCacheVersion ||
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
			CoverResourceID: group.CoverResourceID, CoverVersion: group.CoverVersion,
			Members: append([]string(nil), group.Members...), sortKey: group.sortKey,
		}
	}
	return result
}

func smartAlbumAlgorithmVersion(dimension string) string {
	switch dimension {
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
	case SmartAlbumDimensionTime, SmartAlbumDimensionPlace, SmartAlbumDimensionPeople, SmartAlbumDimensionScene:
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
	groupExists := false
	for _, group := range summary.Groups {
		if group.ID == groupID {
			groupExists = true
			break
		}
	}
	if !groupExists {
		return SmartAlbumSummary{}, ErrSmartAlbumNotFound
	}
	key := smartOverrideKey(albumID, dimension, groupID)
	s.stateMu.Lock()
	previous := s.state.Overrides[key]
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
