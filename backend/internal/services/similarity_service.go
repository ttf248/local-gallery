package services

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/store"
)

// 相似照片整理服务。
//
// 分组结果是可重建的派生数据（derived/），人工决定不是：
// 用户挑了哪张当代表、哪些组已看过、哪些组不想再看到，
// 这些必须在重建之后继续生效，因此单独存放在 state/。
//
// 服务本身不碰原始媒体：它只读分析结果、算分组、给建议，
// 任何写操作都落在自己的状态文件与精选集合上。

const (
	// similarityGroupsFileVersion 是派生分组文件的格式版本。
	similarityGroupsFileVersion = 1
	// similarityRebuildDebounce 是分析结果提交后等待重建的静默时间。
	// 一次分析会连续提交很多批，等它安静下来再算一次，避免每批都重算。
	similarityRebuildDebounce = 1500 * time.Millisecond
	// similarityRebuildPollInterval 是等待分析任务停下来时的轮询间隔。
	similarityRebuildPollInterval = 3 * time.Second
	// similarityGroupPageLimit 是单页返回的分组数上限。
	similarityGroupPageLimit = 200
)

// ErrSimilarityGroupNotFound 表示分组不存在或已经变了。
var ErrSimilarityGroupNotFound = errors.New("similarity group not found")

// SimilarityGroupKind 是分组的类别。
type SimilarityGroupKind string

const (
	// SimilarityGroupKindExact 是完全重复组。
	SimilarityGroupKindExact SimilarityGroupKind = "exact"
	// SimilarityGroupKindNear 是近似重复组。
	SimilarityGroupKindNear SimilarityGroupKind = "near"
	// SimilarityGroupKindBurst 是连拍同场景组。
	SimilarityGroupKindBurst SimilarityGroupKind = "burst"
)

// SimilarityGroupStatus 是分组的整理状态。
const (
	// SimilarityStatusPending 是还没看过的组。
	SimilarityStatusPending = "pending"
	// SimilarityStatusReviewed 是已经看过并确认过的组。
	SimilarityStatusReviewed = "reviewed"
	// SimilarityStatusIgnored 是用户不想再看到的组。
	SimilarityStatusIgnored = "ignored"
)

// SimilarityServiceOptions 是相似照片整理服务的构造选项。
type SimilarityServiceOptions struct {
	// StatePath 是人工决定的存放位置（state/ 下）。
	StatePath string
	// DerivedPath 是分组结果的存放位置（derived/ 下）。
	DerivedPath string
	// Catalog 是媒体目录快照来源。
	Catalog *ResourceCatalog
	// Jobs 提供相似照片特征与拍摄时间。
	Jobs *AIJobService
	// Vectors 提供语义向量，用于复核与连拍判定。
	Vectors *VectorIndexStore
	// Picks 是照片级精选集合，批量加入精选时写入。
	Picks *store.PickStore
	// Now 是时间来源，测试里替换成固定时钟。
	Now func() time.Time
}

// SimilarityMember 是分组里的一张照片。
type SimilarityMember struct {
	// ResourceID 是资源标识。
	ResourceID string `json:"resourceId"`
	// Folder 是这张照片所在的文件夹别名。
	Folder string `json:"folder"`
	// AlbumID 是所属相册的资源标识。
	AlbumID string `json:"albumId"`
	// AlbumName 是所属相册的展示名。
	AlbumName string `json:"albumName"`
	// Width / Height 是原图像素尺寸，并排对比时用来算适应比例。
	Width  int `json:"width"`
	Height int `json:"height"`
	// Quality 是可解释的质量分项。
	Quality SimilarityQuality `json:"quality"`
	// CapturedAt 是可信拍摄时间，没有时为空。
	CapturedAt *time.Time `json:"capturedAt,omitempty"`
	// Distance 是与代表照片的感知哈希距离，完全重复时为 0。
	Distance int `json:"distance"`
	// Similarity 是与代表照片的相似度，0～1。
	Similarity float64 `json:"similarity"`
	// Score 是代表评分，0～1。
	Score float64 `json:"score"`
}

// SimilarityGroup 是一组相似照片。
type SimilarityGroup struct {
	// ID 是稳定标识：人工决定靠它跨重建保持。
	ID string `json:"id"`
	// Kind 是分组类别。
	Kind string `json:"kind"`
	// Folder 是这组照片的主要文件夹别名。
	Folder string `json:"folder"`
	// ResourceIDs 是成员的资源标识。
	ResourceIDs []string `json:"resourceIds"`
	// Members 是成员明细。
	Members []SimilarityMember `json:"members"`
	// Recommended 是算法建议的代表照片。
	Recommended string `json:"recommended"`
	// Representative 是当前生效的代表照片：用户指定过就是用户指定的那张。
	Representative string `json:"representative"`
	// RepresentativeIsManual 说明代表照片是用户手动指定的。
	RepresentativeIsManual bool `json:"representativeIsManual"`
	// Distance 是组内成员与代表照片的最大感知哈希距离。
	Distance int `json:"distance"`
	// Similarity 是组内成员与代表照片的最低相似度。
	Similarity float64 `json:"similarity"`
	// TimeSpanMs 是组内拍摄时间跨度，毫秒。
	TimeSpanMs int64 `json:"timeSpanMs"`
	// TimeSource 说明时间来源："capture" 或 "file"。
	TimeSource string `json:"timeSource"`
	// CrossFolder 说明这一组跨越了多个文件夹。
	CrossFolder bool `json:"crossFolder"`
	// Status 是整理状态。
	Status string `json:"status"`
	// Redundant 是这一组里除代表之外的照片张数。
	Redundant int `json:"redundant"`
}

// SimilarityFolderSummary 是一个文件夹里的整理结果概览。
type SimilarityFolderSummary struct {
	Folder string `json:"folder"`
	Groups int    `json:"groups"`
	Photos int    `json:"photos"`
}

// SimilaritySummary 是整理结果的总量。
type SimilaritySummary struct {
	Exact    int `json:"exact"`
	Near     int `json:"near"`
	Burst    int `json:"burst"`
	Pending  int `json:"pending"`
	Reviewed int `json:"reviewed"`
	Ignored  int `json:"ignored"`
	// Photos 是参与整理的照片张数。
	Photos int `json:"photos"`
	// Redundant 是每组保留一张之后，多余出来的照片张数。
	Redundant int `json:"redundant"`
}

// SimilarityStatus 是整理模块的整体状态。
type SimilarityStatus struct {
	// Analyzed 是已经算出特征的照片张数。
	Analyzed int `json:"analyzed"`
	// Total 是媒体库里的照片总数。
	Total int `json:"total"`
	// HasVectors 说明语义向量索引可用，可用时近似重复的复核更准。
	HasVectors bool `json:"hasVectors"`
	// BuiltAt 是分组结果的生成时间。
	BuiltAt time.Time `json:"builtAt"`
	// Stale 说明特征已经变了，分组结果需要重建。
	Stale bool `json:"stale"`
	// Rebuilding 说明正在重建。
	Rebuilding bool `json:"rebuilding"`
	// Limited 说明候选召回触到了上限，召回可能不完整。
	Limited bool `json:"limited"`
	// Summary 是分组总量。
	Summary SimilaritySummary `json:"summary"`
}

// SimilarityGroupFilter 是分组查询条件。
type SimilarityGroupFilter struct {
	// Kind 是类别筛选，空串表示全部。
	Kind string
	// Folder 是文件夹筛选，空串表示全部。
	Folder string
	// Status 是状态筛选，空串表示全部。
	Status string
	// Limit 是单页上限。
	Limit int
	// Offset 是跳过的分组数。
	Offset int
}

// SimilarityGroupPage 是分组查询结果。
type SimilarityGroupPage struct {
	// Revision 是当前分组结果的版本号。
	Revision uint64 `json:"revision"`
	// Total 是命中筛选条件的分组数。
	Total int `json:"total"`
	// Groups 是本页分组。
	Groups []SimilarityGroup `json:"groups"`
	// Folders 是有整理结果的文件夹列表。
	Folders []SimilarityFolderSummary `json:"folders"`
	// Summary 是整体总量。
	Summary SimilaritySummary `json:"summary"`
	// Stale 说明分组结果已经过期。
	Stale bool `json:"stale"`
	// Limited 说明候选召回触到了上限。
	Limited bool `json:"limited"`
}

// SimilarityService 是相似照片整理的服务。
type SimilarityService struct {
	mu sync.RWMutex

	statePath   string
	derivedPath string
	catalog     *ResourceCatalog
	jobs        *AIJobService
	vectors     *VectorIndexStore
	picks       *store.PickStore
	now         func() time.Time

	state  similarityState
	groups []SimilarityGroup
	// folders 是按文件夹汇总的整理结果。
	folders []SimilarityFolderSummary
	summary SimilaritySummary

	revision   uint64
	builtAt    time.Time
	stale      bool
	limited    bool
	rebuilding bool

	// pendingRebuild 表示重建期间又来了新的分析结果，需要再算一次。
	pendingRebuild bool
	// rebuildStop 让后台重建循环退出。
	rebuildStop chan struct{}
	closed      bool
}

// OpenSimilarityService 打开相似照片整理服务。
func OpenSimilarityService(options SimilarityServiceOptions) (*SimilarityService, error) {
	if options.Catalog == nil || options.Jobs == nil {
		return nil, errors.New("similarity service requires a catalog and the analysis job service")
	}
	now := options.Now
	if now == nil {
		now = time.Now
	}
	service := &SimilarityService{
		statePath:   options.StatePath,
		derivedPath: options.DerivedPath,
		catalog:     options.Catalog,
		jobs:        options.Jobs,
		vectors:     options.Vectors,
		picks:       options.Picks,
		now:         now,
		rebuildStop: make(chan struct{}),
	}
	if err := service.loadState(); err != nil {
		return nil, err
	}
	service.loadGroups()
	// 分组是派生的：记录比分组新（上次分析没跑完、服务被中断过），
	// 或者分组文件根本不在，就该重算一次。放到后台，不挡启动。
	if service.needsRebuild() {
		service.ScheduleRebuild()
	}
	return service, nil
}

// needsRebuild 判断分组结果是否已经落后于分析结果。
func (s *SimilarityService) needsRebuild() bool {
	if s.jobs == nil {
		return false
	}
	records := s.jobs.Records(AIJobTypeSimilarity)
	if len(records) == 0 {
		return false
	}
	newest := time.Time{}
	for _, record := range records {
		if record.UpdatedAt.After(newest) {
			newest = record.UpdatedAt
		}
	}
	if s.builtAt.IsZero() {
		return true
	}
	return newest.After(s.builtAt)
}

// RebuildNow 立刻重算分组。
//
// 手动触发用：特征变了但还没重建时，用户不必等分析任务再跑一遍。
func (s *SimilarityService) RebuildNow() (SimilaritySummary, error) {
	return s.Rebuild(context.Background())
}

// loadState 读入人工决定。坏文件改名备份后按空决定继续，不让服务起不来。
func (s *SimilarityService) loadState() error {
	s.state = newSimilarityState()
	if s.statePath == "" {
		return nil
	}
	data, err := os.ReadFile(s.statePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if err := json.Unmarshal(data, &s.state); err != nil {
		stamp := s.now().Format("20060102150405")
		_ = os.Rename(s.statePath, s.statePath+".corrupt."+stamp)
		s.state = newSimilarityState()
	}
	s.state.normalize()
	return nil
}

// loadGroups 读入上次算出的分组结果。
func (s *SimilarityService) loadGroups() {
	s.groups = nil
	s.folders = nil
	s.summary = SimilaritySummary{}
	s.builtAt = time.Time{}
	s.limited = false
	if s.derivedPath == "" {
		return
	}
	data, err := os.ReadFile(s.derivedPath)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		return
	}
	var file similarityGroupsFile
	if err := json.Unmarshal(data, &file); err != nil {
		return
	}
	if file.Version != similarityGroupsFileVersion {
		return
	}
	s.groups = file.Groups
	s.builtAt = file.BuiltAt
	s.limited = file.Limited
	s.applyStateLocked()
}

// applyStateLocked 把人工决定套到分组结果上，并汇总统计。
//
// 必须在持有写锁时调用。
func (s *SimilarityService) applyStateLocked() {
	summary := SimilaritySummary{}
	folders := map[string]*SimilarityFolderSummary{}
	for index := range s.groups {
		group := &s.groups[index]
		group.Status = SimilarityStatusPending
		if s.state.Ignored[group.ID] {
			group.Status = SimilarityStatusIgnored
		}
		if s.state.Reviewed[group.ID] {
			group.Status = SimilarityStatusReviewed
		}
		group.Representative = group.Recommended
		group.RepresentativeIsManual = false
		if chosen, exists := s.state.Representatives[group.ID]; exists {
			for _, member := range group.Members {
				if member.ResourceID == chosen {
					group.Representative = chosen
					group.RepresentativeIsManual = true
					break
				}
			}
		}
		group.Redundant = len(group.Members) - 1
		switch group.Kind {
		case string(SimilarityGroupKindExact):
			summary.Exact++
		case string(SimilarityGroupKindNear):
			summary.Near++
		case string(SimilarityGroupKindBurst):
			summary.Burst++
		}
		switch group.Status {
		case SimilarityStatusReviewed:
			summary.Reviewed++
		case SimilarityStatusIgnored:
			summary.Ignored++
		default:
			summary.Pending++
		}
		summary.Redundant += group.Redundant
		summary.Photos += len(group.Members)
		for _, member := range group.Members {
			entry, exists := folders[member.Folder]
			if !exists {
				entry = &SimilarityFolderSummary{Folder: member.Folder}
				folders[member.Folder] = entry
			}
			entry.Photos++
		}
	}
	// 按文件夹统计分组数：一个组可能跨文件夹，按成员所在文件夹各记一次。
	groupCounts := map[string]int{}
	for _, group := range s.groups {
		seen := map[string]bool{}
		for _, member := range group.Members {
			if seen[member.Folder] {
				continue
			}
			seen[member.Folder] = true
			groupCounts[member.Folder]++
		}
	}
	for folder, entry := range folders {
		entry.Groups = groupCounts[folder]
	}
	list := make([]SimilarityFolderSummary, 0, len(folders))
	for _, entry := range folders {
		list = append(list, *entry)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].Groups != list[j].Groups {
			return list[i].Groups > list[j].Groups
		}
		return list[i].Folder < list[j].Folder
	})
	s.folders = list
	s.summary = summary
}

// MarkStale 标记分组结果已经过期。
//
// 分析结果提交后调用：分组是派生的，特征变了就得重算。
func (s *SimilarityService) MarkStale() {
	s.mu.Lock()
	s.stale = true
	s.mu.Unlock()
}

// ApplyRecords 在分析结果提交后更新整理状态。
//
// 相似照片特征变了，分组结果就得重算。这里只标记过期并排一次后台重建，
// 不阻塞分析任务本身。
func (s *SimilarityService) ApplyRecords(records []AIAnalysisRecord) {
	for _, record := range records {
		if record.Type != AIJobTypeSimilarity {
			continue
		}
		if record.Status != "processed" {
			continue
		}
		s.MarkStale()
		s.ScheduleRebuild()
		return
	}
}

// ScheduleRebuild 在静默期后重建分组。
//
// 分析任务会连续提交很多批，每批都重算一遍会把机器占满；
// 这里等到没有新结果进来再算一次。
func (s *SimilarityService) ScheduleRebuild() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.pendingRebuild = true
	if s.rebuilding {
		s.mu.Unlock()
		return
	}
	s.rebuilding = true
	s.mu.Unlock()
	go s.rebuildLoop()
}

// rebuildLoop 是后台重建循环。
//
// 分析任务在跑的时候不重算：特征每提交一批就会触发一次，
// 那会把 CPU 从分析任务上抢走，还把派生文件反复写一遍。
// 等分析停下来再一次性算，分组结果也更接近最终状态。
func (s *SimilarityService) rebuildLoop() {
	for {
		if !s.analysisIdle() {
			if !s.waitForRebuildSlot(similarityRebuildPollInterval) {
				s.mu.Lock()
				s.rebuilding = false
				s.mu.Unlock()
				return
			}
			continue
		}
		// 静默期：等没有新结果进来再算一次。
		timer := time.NewTimer(similarityRebuildDebounce)
		select {
		case <-s.rebuildStop:
			timer.Stop()
			s.mu.Lock()
			s.rebuilding = false
			s.mu.Unlock()
			return
		case <-timer.C:
		}
		s.mu.Lock()
		s.pendingRebuild = false
		s.mu.Unlock()
		if _, err := s.Rebuild(context.Background()); err != nil {
			// 重建失败不算致命：上一次的分组结果仍然可用。
			s.mu.Lock()
			s.stale = true
			s.mu.Unlock()
		}
		s.mu.Lock()
		pending := s.pendingRebuild
		s.mu.Unlock()
		if !pending {
			s.mu.Lock()
			s.rebuilding = false
			s.mu.Unlock()
			return
		}
	}
}

// analysisIdle 判断当前有没有分析任务在跑。
func (s *SimilarityService) analysisIdle() bool {
	if s.jobs == nil {
		return true
	}
	return s.jobs.List().Active == nil
}

// waitForRebuildSlot 等到分析任务停下来，或服务关闭。
func (s *SimilarityService) waitForRebuildSlot(interval time.Duration) bool {
	timer := time.NewTimer(interval)
	defer timer.Stop()
	select {
	case <-s.rebuildStop:
		return false
	case <-timer.C:
		return true
	}
}

// Rebuild 重新计算全部分组。
func (s *SimilarityService) Rebuild(ctx context.Context) (SimilaritySummary, error) {
	snapshot := s.catalog.Acquire()
	if !snapshot.Ready() {
		return SimilaritySummary{}, ErrLibraryNotReady
	}
	candidates, err := s.buildCandidates(ctx, snapshot)
	if err != nil {
		return SimilaritySummary{}, err
	}
	exactGroups := SimilarityExactGroups(candidates)
	nearGroups, limited := SimilarityNearGroups(candidates)
	burstGroups := SimilarityBurstGroups(candidates)

	groups := make([]SimilarityGroup, 0, len(exactGroups)+len(nearGroups)+len(burstGroups))
	groups = append(groups, s.buildGroups(snapshot, candidates, exactGroups, SimilarityGroupKindExact)...)
	groups = append(groups, s.buildGroups(snapshot, candidates, nearGroups, SimilarityGroupKindNear)...)
	groups = append(groups, s.buildGroups(snapshot, candidates, burstGroups, SimilarityGroupKindBurst)...)
	// 排序按「最该先处理」来：完全重复最明确，近似重复次之，
	// 连拍是同场景的不同画面，放最后。
	sort.Slice(groups, func(i, j int) bool {
		left, right := similarityKindOrder(groups[i].Kind), similarityKindOrder(groups[j].Kind)
		if left != right {
			return left < right
		}
		if groups[i].Redundant != groups[j].Redundant {
			return groups[i].Redundant > groups[j].Redundant
		}
		return groups[i].ID < groups[j].ID
	})

	s.mu.Lock()
	// 人工决定跟着照片走：分组变了之后，旧决定要迁到新的分组上。
	// 归属说不清时原始数据留在原处，不擅自套用。
	s.state = similarityStateMigration(s.groups, s.state, groups)
	s.groups = groups
	s.builtAt = s.now()
	s.stale = false
	s.limited = limited
	s.applyStateLocked()
	summary := s.summary
	s.revision++
	stateErr := s.persistStateLocked()
	s.mu.Unlock()

	if err := s.persistGroups(); err != nil {
		return summary, err
	}
	if stateErr != nil {
		return summary, stateErr
	}
	return summary, nil
}

// buildCandidates 把分析结果整理成分组算法要用的候选集合。
func (s *SimilarityService) buildCandidates(ctx context.Context, snapshot CatalogSnapshot) ([]SimilarityCandidate, error) {
	records := s.jobs.Records(AIJobTypeSimilarity)
	candidates := make([]SimilarityCandidate, 0, len(records))
	ids := make([]string, 0, len(records))
	for _, record := range records {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		feature, ok := SimilarityFeatureFromRecord(record)
		if !ok {
			continue
		}
		if !snapshot.IsPhotoImage(record.ResourceID) {
			continue
		}
		ref, exists := snapshot.Lookup(record.ResourceID)
		if !exists {
			continue
		}
		candidates = append(candidates, SimilarityCandidate{
			ResourceID: record.ResourceID,
			Folder:     similarityFolderLabel(snapshot, ref),
			Feature:    feature,
		})
		ids = append(ids, record.ResourceID)
	}
	captureTimes := s.jobs.CaptureTimes(AIJobTypeMetadata, ids)
	for index := range candidates {
		candidate := &candidates[index]
		if captured, exists := captureTimes[candidate.ResourceID]; exists && !captured.IsZero() {
			candidate.CapturedAt = captured
			candidate.HasCapture = true
			candidate.TimeSource = "capture"
			continue
		}
		// 没有拍摄时间时退回文件修改时间；这种依据更弱，
		// 连拍判定会因此收紧门槛。
		if ref, exists := snapshot.Lookup(candidate.ResourceID); exists {
			if info, err := os.Stat(ref.AbsolutePath); err == nil {
				candidate.CapturedAt = info.ModTime()
				candidate.TimeSource = "file"
			}
		}
	}
	// 语义向量是复核与连拍判定的第二道证据。
	for index := range candidates {
		candidate := &candidates[index]
		record, exists := s.jobs.Record(AIJobTypeSimilarity, candidate.ResourceID)
		if !exists {
			continue
		}
		if s.vectors == nil {
			continue
		}
		vector, ok := s.vectors.Vector(candidate.ResourceID, record.Size, record.MTimeNs)
		if !ok {
			continue
		}
		candidate.Vector = vector
		candidate.HasVector = true
	}
	return candidates, nil
}

// buildGroups 把算法给出的成员下标组装成分组。
func (s *SimilarityService) buildGroups(snapshot CatalogSnapshot, candidates []SimilarityCandidate, components [][]int, kind SimilarityGroupKind) []SimilarityGroup {
	groups := make([]SimilarityGroup, 0, len(components))
	for _, component := range components {
		members := make([]SimilarityMember, 0, len(component))
		resourceIDs := make([]string, 0, len(component))
		folders := map[string]bool{}
		for _, index := range component {
			candidate := candidates[index]
			quality := similarityQualityScore(candidate.Feature)
			member := SimilarityMember{
				ResourceID: candidate.ResourceID,
				Folder:     candidate.Folder,
				Width:      candidate.Feature.Width,
				Height:     candidate.Feature.Height,
				Quality:    quality,
				Score:      quality.Score,
			}
			if item, exists := LookupLibraryFeedItem(snapshot, candidate.ResourceID); exists {
				member.AlbumID = item.AlbumID
				member.AlbumName = item.AlbumName
			}
			if candidate.HasCapture {
				captured := candidate.CapturedAt
				member.CapturedAt = &captured
			}
			folders[candidate.Folder] = true
			resourceIDs = append(resourceIDs, candidate.ResourceID)
			members = append(members, member)
		}
		// 代表照片：质量分最高的那张。
		sort.SliceStable(members, func(left, right int) bool {
			if members[left].Score != members[right].Score {
				return members[left].Score > members[right].Score
			}
			return members[left].ResourceID < members[right].ResourceID
		})
		recommended := members[0].ResourceID
		// 距离与相似度都相对代表照片计算。
		representativeFeature := similarityFeatureOf(candidates, component, recommended)
		worstDistance := 0
		worstSimilarity := 1.0
		for index := range members {
			feature := similarityFeatureOf(candidates, component, members[index].ResourceID)
			distance := similarityGroupDistance(kind, representativeFeature, feature)
			similarity := similarityGroupSimilarity(kind, distance, candidates, component, recommended, members[index].ResourceID)
			members[index].Distance = distance
			members[index].Similarity = similarity
			if distance > worstDistance {
				worstDistance = distance
			}
			if similarity < worstSimilarity {
				worstSimilarity = similarity
			}
		}
		sort.SliceStable(members, func(left, right int) bool {
			return members[left].ResourceID < members[right].ResourceID
		})
		group := SimilarityGroup{
			ID:          similarityGroupID(kind, resourceIDs),
			Kind:        string(kind),
			Folder:      similarityPrimaryFolder(folders),
			ResourceIDs: resourceIDs,
			Members:     members,
			Recommended: recommended,
			Distance:    worstDistance,
			Similarity:  worstSimilarity,
			TimeSource:  similarityGroupTimeSource(candidates, component),
			CrossFolder: len(folders) > 1,
		}
		group.TimeSpanMs = similarityGroupTimeSpan(candidates, component)
		groups = append(groups, group)
	}
	return groups
}

// similarityFeatureOf 取出组内某张照片的特征。
func similarityFeatureOf(candidates []SimilarityCandidate, component []int, resourceID string) SimilarityFeature {
	for _, index := range component {
		if candidates[index].ResourceID == resourceID {
			return candidates[index].Feature
		}
	}
	return SimilarityFeature{}
}

// similarityGroupDistance 返回两张照片之间的距离口径。
func similarityGroupDistance(kind SimilarityGroupKind, left, right SimilarityFeature) int {
	if kind == SimilarityGroupKindExact {
		return 0
	}
	distance := similarityHashDistance(left.PHash, right.PHash)
	if crop := similarityCropDistance(left, right); crop < distance {
		distance = crop
	}
	return distance
}

// similarityGroupSimilarity 返回两张照片的相似度。
func similarityGroupSimilarity(kind SimilarityGroupKind, distance int, candidates []SimilarityCandidate, component []int, leftID, rightID string) float64 {
	if kind == SimilarityGroupKindExact {
		return 1
	}
	if kind == SimilarityGroupKindBurst {
		if similarity, ok := similarityVectorSimilarity(candidates, component, leftID, rightID); ok {
			return similarity
		}
	}
	return similarityHashSimilarity(distance)
}

// similarityHashSimilarity 把哈希距离折算成相似度。
func similarityHashSimilarity(distance int) float64 {
	if distance < 0 {
		distance = 0
	}
	similarity := 1 - float64(distance)/64
	if similarity < 0 {
		return 0
	}
	return similarity
}

// similarityVectorSimilarity 返回两张照片的语义相似度。
func similarityVectorSimilarity(candidates []SimilarityCandidate, component []int, leftID, rightID string) (float64, bool) {
	var leftVector, rightVector []float32
	for _, index := range component {
		switch candidates[index].ResourceID {
		case leftID:
			leftVector = candidates[index].Vector
		case rightID:
			rightVector = candidates[index].Vector
		}
	}
	if len(leftVector) == 0 || len(rightVector) == 0 {
		return 0, false
	}
	return similarityVectorCosine(leftVector, rightVector), true
}

// similarityGroupTimeSource 说明组内时间证据的来源。
func similarityGroupTimeSource(candidates []SimilarityCandidate, component []int) string {
	source := ""
	for _, index := range component {
		current := candidates[index].TimeSource
		if current == "" {
			continue
		}
		if source == "" || current < source {
			source = current
		}
	}
	return source
}

// similarityGroupTimeSpan 返回组内拍摄时间的跨度。
func similarityGroupTimeSpan(candidates []SimilarityCandidate, component []int) int64 {
	if len(component) < 2 {
		return 0
	}
	earliest, latest := candidates[component[0]].CapturedAt, candidates[component[0]].CapturedAt
	for _, index := range component[1:] {
		current := candidates[index].CapturedAt
		if current.Before(earliest) {
			earliest = current
		}
		if current.After(latest) {
			latest = current
		}
	}
	return latest.Sub(earliest).Milliseconds()
}

// similarityPrimaryFolder 选出组里成员最多的文件夹。
func similarityPrimaryFolder(folders map[string]bool) string {
	names := make([]string, 0, len(folders))
	for name := range folders {
		names = append(names, name)
	}
	sort.Strings(names)
	if len(names) == 0 {
		return ""
	}
	return names[0]
}

// similarityFolderLabel 给出照片所在文件夹的别名。
func similarityFolderLabel(snapshot CatalogSnapshot, ref ResourceRef) string {
	rootName := "媒体库"
	if root, exists := snapshot.Lookup(ref.RootID); exists {
		if name := filepath.Base(root.AbsolutePath); name != "." && name != string(filepath.Separator) {
			rootName = name
		}
	}
	directory := filepath.ToSlash(filepath.Dir(filepath.FromSlash(ref.RelativePath)))
	if directory == "." || directory == "" {
		return rootName
	}
	return rootName + "/" + directory
}

// similarityKindOrder 给出分组类别的展示次序。
func similarityKindOrder(kind string) int {
	switch kind {
	case string(SimilarityGroupKindExact):
		return 0
	case string(SimilarityGroupKindNear):
		return 1
	case string(SimilarityGroupKindBurst):
		return 2
	default:
		return 3
	}
}

// similarityGroupID 生成稳定的分组标识。
//
// 标识取组内最小的资源标识：组变大变小都不会换号，
// 用户的「已看过」「已忽略」因此能一直对得上。
func similarityGroupID(kind SimilarityGroupKind, resourceIDs []string) string {
	if len(resourceIDs) == 0 {
		return ""
	}
	anchor := make([]string, len(resourceIDs))
	copy(anchor, resourceIDs)
	sort.Strings(anchor)
	sum := sha256.Sum256([]byte(string(kind) + "\x00" + anchor[0]))
	return string(kind) + "-" + hex.EncodeToString(sum[:])[:12]
}

// persistGroups 把分组结果写进派生目录。
func (s *SimilarityService) persistGroups() error {
	if s.derivedPath == "" {
		return nil
	}
	s.mu.RLock()
	file := similarityGroupsFile{
		Version: similarityGroupsFileVersion,
		BuiltAt: s.builtAt,
		Limited: s.limited,
		Groups:  s.groups,
	}
	s.mu.RUnlock()
	if err := os.MkdirAll(filepath.Dir(s.derivedPath), 0o755); err != nil {
		return err
	}
	data, err := json.Marshal(file)
	if err != nil {
		return err
	}
	temporary := s.derivedPath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.derivedPath)
}

// similarityGroupsFile 是派生分组文件的磁盘格式。
type similarityGroupsFile struct {
	Version int               `json:"version"`
	BuiltAt time.Time         `json:"builtAt"`
	Limited bool              `json:"limited"`
	Groups  []SimilarityGroup `json:"groups"`
}

// Groups 按条件返回分组。
func (s *SimilarityService) Groups(filter SimilarityGroupFilter) SimilarityGroupPage {
	s.mu.RLock()
	defer s.mu.RUnlock()
	matched := make([]SimilarityGroup, 0, len(s.groups))
	for _, group := range s.groups {
		if filter.Kind != "" && group.Kind != filter.Kind {
			continue
		}
		if filter.Status != "" && group.Status != filter.Status {
			continue
		}
		if filter.Folder != "" && !similarityGroupInFolder(group, filter.Folder) {
			continue
		}
		matched = append(matched, group)
	}
	total := len(matched)
	limit := filter.Limit
	if limit <= 0 || limit > similarityGroupPageLimit {
		limit = similarityGroupPageLimit
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}
	if offset > total {
		offset = total
	}
	end := offset + limit
	if end > total {
		end = total
	}
	page := SimilarityGroupPage{
		Revision: s.revision,
		Total:    total,
		Groups:   append([]SimilarityGroup{}, matched[offset:end]...),
		Folders:  s.folders,
		Summary:  s.summary,
		Stale:    s.stale,
		Limited:  s.limited,
	}
	return page
}

// similarityGroupInFolder 判断分组是否属于某个文件夹。
func similarityGroupInFolder(group SimilarityGroup, folder string) bool {
	for _, member := range group.Members {
		if member.Folder == folder {
			return true
		}
	}
	return false
}

// Status 返回整理模块的整体状态。
func (s *SimilarityService) Status() SimilarityStatus {
	snapshot := s.catalog.Acquire()
	total := 0
	if snapshot.Ready() {
		total = snapshot.PhotoCount()
	}
	analyzed := 0
	if s.jobs != nil {
		for _, record := range s.jobs.Records(AIJobTypeSimilarity) {
			if _, ok := SimilarityFeatureFromRecord(record); ok {
				analyzed++
			}
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return SimilarityStatus{
		Analyzed:   analyzed,
		Total:      total,
		HasVectors: s.vectors != nil && s.vectors.Status().Vectors > 0,
		BuiltAt:    s.builtAt,
		Stale:      s.stale,
		Rebuilding: s.rebuilding,
		Limited:    s.limited,
		Summary:    s.summary,
	}
}

// SetRepresentative 指定某一组的代表照片。
func (s *SimilarityService) SetRepresentative(groupID, resourceID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	group := s.findGroupLocked(groupID)
	if group == nil {
		return ErrSimilarityGroupNotFound
	}
	found := false
	for _, member := range group.Members {
		if member.ResourceID == resourceID {
			found = true
			break
		}
	}
	if !found {
		return errors.New("the resource is not a member of this group")
	}
	s.state.Representatives[groupID] = resourceID
	if err := s.persistStateLocked(); err != nil {
		return err
	}
	s.applyStateLocked()
	return nil
}

// SetReviewed 标记某一组已看过。
func (s *SimilarityService) SetReviewed(groupID string, reviewed bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.findGroupLocked(groupID) == nil {
		return ErrSimilarityGroupNotFound
	}
	if reviewed {
		s.state.Reviewed[groupID] = true
		delete(s.state.Ignored, groupID)
	} else {
		delete(s.state.Reviewed, groupID)
	}
	if err := s.persistStateLocked(); err != nil {
		return err
	}
	s.applyStateLocked()
	return nil
}

// SetIgnored 忽略某一组。
func (s *SimilarityService) SetIgnored(groupID string, ignored bool) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.findGroupLocked(groupID) == nil {
		return ErrSimilarityGroupNotFound
	}
	if ignored {
		s.state.Ignored[groupID] = true
		delete(s.state.Reviewed, groupID)
	} else {
		delete(s.state.Ignored, groupID)
	}
	if err := s.persistStateLocked(); err != nil {
		return err
	}
	s.applyStateLocked()
	return nil
}

// SimilarityBatchAction 是批量操作的动作。
const (
	// SimilarityBatchReview 把选中的组标记为已看过。
	SimilarityBatchReview = "review"
	// SimilarityBatchUnreview 取消「已看过」。
	SimilarityBatchUnreview = "unreview"
	// SimilarityBatchIgnore 忽略选中的组。
	SimilarityBatchIgnore = "ignore"
	// SimilarityBatchUnignore 取消忽略。
	SimilarityBatchUnignore = "unignore"
	// SimilarityBatchPick 把选中组的代表照片加入精选。
	SimilarityBatchPick = "pick"
)

// ApplyBatch 对一组分组执行同一个动作。
func (s *SimilarityService) ApplyBatch(action string, groupIDs []string) (int, error) {
	s.mu.Lock()
	changed := 0
	pickIDs := make([]string, 0, len(groupIDs))
	for _, groupID := range groupIDs {
		group := s.findGroupLocked(groupID)
		if group == nil {
			continue
		}
		switch action {
		case SimilarityBatchReview:
			s.state.Reviewed[groupID] = true
			delete(s.state.Ignored, groupID)
			changed++
		case SimilarityBatchUnreview:
			delete(s.state.Reviewed, groupID)
			changed++
		case SimilarityBatchIgnore:
			s.state.Ignored[groupID] = true
			delete(s.state.Reviewed, groupID)
			changed++
		case SimilarityBatchUnignore:
			delete(s.state.Ignored, groupID)
			changed++
		case SimilarityBatchPick:
			pickIDs = append(pickIDs, group.Representative)
		default:
			s.mu.Unlock()
			return 0, fmt.Errorf("unknown similarity action %q", action)
		}
	}
	if action != SimilarityBatchPick {
		if err := s.persistStateLocked(); err != nil {
			s.mu.Unlock()
			return 0, err
		}
		s.applyStateLocked()
	}
	s.mu.Unlock()
	if action == SimilarityBatchPick {
		if s.picks == nil {
			return 0, errors.New("the picks collection is unavailable")
		}
		added, err := s.picks.Batch(pickIDs, true)
		if err != nil {
			return 0, err
		}
		return added, nil
	}
	return changed, nil
}

// findGroupLocked 找出分组。必须在持有锁时调用。
func (s *SimilarityService) findGroupLocked(groupID string) *SimilarityGroup {
	for index := range s.groups {
		if s.groups[index].ID == groupID {
			return &s.groups[index]
		}
	}
	return nil
}

// persistStateLocked 把人工决定写盘。必须在持有写锁时调用。
func (s *SimilarityService) persistStateLocked() error {
	if s.statePath == "" {
		return nil
	}
	s.state.Version = similarityStateVersion
	data, err := json.Marshal(s.state)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o755); err != nil {
		return err
	}
	temporary := s.statePath + ".tmp"
	if err := os.WriteFile(temporary, data, 0o644); err != nil {
		return err
	}
	return os.Rename(temporary, s.statePath)
}

// Close 停止后台重建循环。
func (s *SimilarityService) Close() {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return
	}
	s.closed = true
	close(s.rebuildStop)
	s.mu.Unlock()
}

// SimilarityBackup 是相似照片整理人工决定的备份格式。
//
// 分组结果不进备份：它是派生的，重新分析就能再算一遍。
// 进备份的只有用户的决定。
type SimilarityBackup struct {
	Version         int               `json:"version"`
	Reviewed        map[string]bool   `json:"reviewed"`
	Ignored         map[string]bool   `json:"ignored"`
	Representatives map[string]string `json:"representatives"`
}

// BackupState 返回当前人工决定的副本。
func (s *SimilarityService) BackupState() SimilarityBackup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	backup := SimilarityBackup{
		Version:         similarityStateVersion,
		Reviewed:        map[string]bool{},
		Ignored:         map[string]bool{},
		Representatives: map[string]string{},
	}
	for id, value := range s.state.Reviewed {
		backup.Reviewed[id] = value
	}
	for id, value := range s.state.Ignored {
		backup.Ignored[id] = value
	}
	for id, value := range s.state.Representatives {
		backup.Representatives[id] = value
	}
	return backup
}

// RestoreState 用备份里的决定替换当前人工决定。
func (s *SimilarityService) RestoreState(backup SimilarityBackup) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.state = similarityState{
		Version:         similarityStateVersion,
		Reviewed:        map[string]bool{},
		Ignored:         map[string]bool{},
		Representatives: map[string]string{},
	}
	for id, value := range backup.Reviewed {
		s.state.Reviewed[id] = value
	}
	for id, value := range backup.Ignored {
		s.state.Ignored[id] = value
	}
	for id, value := range backup.Representatives {
		s.state.Representatives[id] = value
	}
	s.state.normalize()
	if err := s.persistStateLocked(); err != nil {
		return err
	}
	s.applyStateLocked()
	return nil
}

// NormalizeSimilarityKind 归一化分组类别。
func NormalizeSimilarityKind(value string) string {
	switch strings.TrimSpace(value) {
	case string(SimilarityGroupKindExact):
		return string(SimilarityGroupKindExact)
	case string(SimilarityGroupKindNear):
		return string(SimilarityGroupKindNear)
	case string(SimilarityGroupKindBurst):
		return string(SimilarityGroupKindBurst)
	default:
		return ""
	}
}

// NormalizeSimilarityStatus 归一化整理状态。
func NormalizeSimilarityStatus(value string) string {
	switch strings.TrimSpace(value) {
	case SimilarityStatusPending:
		return SimilarityStatusPending
	case SimilarityStatusReviewed:
		return SimilarityStatusReviewed
	case SimilarityStatusIgnored:
		return SimilarityStatusIgnored
	default:
		return ""
	}
}
