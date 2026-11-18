package services

// 本文件管跨相册的目录列表：把各本相册已生成的分组汇总成一页，
// 按推荐、时间或张数排序。

import (
	"context"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"time"
)

// DirectoryPage collects only folder dimensions that already have a smart
// album cache. Missing folder summaries stay missing instead of triggering
// analysis or a full-library rebuild from the home page.
//
// 它直接读已生成的缓存，不重算分组：目录只是「已生成了哪些分组」的汇总，
// 而重算分组要把每本相册的媒体逐个 stat 一遍（真实库上几十秒）——
// 首页等不起，那笔钱该由刷新任务出（见 SweepSmartAlbums）。
//
// sortMode 只对精选推荐这一页有意义（见 sortRecommendedItems）；其它维度
// 仍按相册分块排。
func (s *SmartAlbumService) DirectoryPage(
	ctx context.Context,
	dimension, cursor string,
	limit int,
	sortMode string,
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
	sortMode = NormalizeSmartAlbumSort(sortMode)
	directoryRevision := s.directoryRevision.Load()
	scope := smartAlbumDirectoryScope(dimension, directoryRevision, sortMode)
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
	// 精选推荐要按组内最新的拍摄时间排序，而成员不随目录外传
	//（applyOverrides 会清掉）：排序用的成员在这里单独留一份。
	membersByGroup := make(map[string][]string)
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
			cached := smartAlbumGroups(cache.Groups)
			if dimension == SmartAlbumDimensionRecommended {
				for _, group := range cached {
					membersByGroup[group.ID] = group.Members
				}
			}
			for _, group := range s.applyOverrides(album.ID, currentDimension, cached) {
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
	// 精选推荐是一个特例：它排的是跨相册的一组主题，不按相册分块。
	if dimension == SmartAlbumDimensionRecommended {
		s.sortRecommendedItems(items, sortMode, membersByGroup)
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
	page := LibraryPage[SmartAlbumDirectoryItem]{
		// 空页要给 []，不能给 null：前端把 items 当数组用，null 会让它
		// 把一个空分组当成一条记录（库里还没生成任何分组时就会踩到）。
		Revision: snapshot.Revision(), Items: pageItems, Total: len(items),
	}
	if end < len(items) {
		nextCursor, err := EncodePageCursor(
			snapshot.Revision(),
			smartAlbumDirectoryScope(dimension, currentDirectoryRevision, sortMode),
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
	scope := smartAlbumDirectoryScope("featured", directoryRevision, "")
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

	page := LibraryPage[SmartAlbumDirectoryItem]{
		Revision: snapshot.Revision(), Items: pageItems, Total: len(items),
	}
	if end < len(items) {
		nextCursor, err := EncodePageCursor(
			snapshot.Revision(), smartAlbumDirectoryScope("featured", currentDirectoryRevision, ""), end,
		)
		if err != nil {
			return LibraryPage[SmartAlbumDirectoryItem]{}, err
		}
		page.NextCursor = nextCursor
	}
	return page, nil
}

func smartAlbumDirectoryScope(dimension string, revision uint64, sortMode string) string {
	return fmt.Sprintf("smart-album-directory:%s:%s:%d", dimension, sortMode, revision)
}

// sortRecommendedItems 按选定的模式排精选推荐这一面墙。
//
// 精选推荐是跨相册的一组主题，按相册分块排会得到「这本相册最近拍过
// 什么」的顺序 —— 与主题本身的新旧无关。这一页因此整体排序：
//
//	time    组内最新一张照片的拍摄时间倒序（默认）
//	photos  照片张数倒序
//	quality 推荐分倒序
//
// 同分同数时按张数、名字、ID 兜底，顺序稳定。
func (s *SmartAlbumService) sortRecommendedItems(
	items []SmartAlbumDirectoryItem,
	mode string,
	membersByGroup map[string][]string,
) {
	switch mode {
	case SmartAlbumSortPhotos:
		sort.SliceStable(items, func(i, j int) bool {
			left, right := items[i].Group, items[j].Group
			if left.PhotoCount != right.PhotoCount {
				return left.PhotoCount > right.PhotoCount
			}
			return recommendedItemTieBreak(items[i], items[j])
		})
	case SmartAlbumSortQuality:
		sort.SliceStable(items, func(i, j int) bool {
			left, right := items[i].Group, items[j].Group
			if left.QualityScore != right.QualityScore {
				return left.QualityScore > right.QualityScore
			}
			return recommendedItemTieBreak(items[i], items[j])
		})
	default:
		times := s.recommendedCaptureTimes(membersByGroup)
		sort.SliceStable(items, func(i, j int) bool {
			left, right := times[items[i].Group.ID], times[items[j].Group.ID]
			if !left.Equal(right) {
				// 没有拍摄时间的主题排最后：它们不是「旧」，只是读不出时间。
				if left.IsZero() {
					return false
				}
				if right.IsZero() {
					return true
				}
				return left.After(right)
			}
			return recommendedItemTieBreak(items[i], items[j])
		})
	}
}

// recommendedItemTieBreak 排序的兜底：张数多的在前，再按名字与 ID。
func recommendedItemTieBreak(left, right SmartAlbumDirectoryItem) bool {
	if left.Group.PhotoCount != right.Group.PhotoCount {
		return left.Group.PhotoCount > right.Group.PhotoCount
	}
	if left.Group.Name != right.Group.Name {
		return strings.ToLower(left.Group.Name) < strings.ToLower(right.Group.Name)
	}
	return left.Group.ID < right.Group.ID
}

// recommendedCaptureTimes 算出每个推荐主题里最新的那张照片的拍摄时间。
//
// 一个主题是聚合出来的，它的时间就是组内所有照片里最新的那张 —— 按
// 主题名字或质量分排，都读不出「这个主题是什么时候的事」。
func (s *SmartAlbumService) recommendedCaptureTimes(membersByGroup map[string][]string) map[string]time.Time {
	ids := make([]string, 0, len(membersByGroup))
	seen := make(map[string]struct{}, len(membersByGroup))
	for _, members := range membersByGroup {
		for _, id := range members {
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			ids = append(ids, id)
		}
	}
	if len(ids) == 0 {
		return nil
	}
	captured := s.jobs.CaptureTimes(AIJobTypeMetadata, ids)
	times := make(map[string]time.Time, len(membersByGroup))
	for groupID, members := range membersByGroup {
		var latest time.Time
		for _, id := range members {
			at, ok := captured[id]
			if !ok {
				continue
			}
			if latest.IsZero() || at.After(latest) {
				latest = at
			}
		}
		if !latest.IsZero() {
			times[groupID] = latest
		}
	}
	return times
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

func validSmartAlbumDirectoryDimension(dimension string) bool {
	return dimension == SmartAlbumDimensionAll || dimension == "featured" || validSmartAlbumDimension(dimension)
}
