package services

import "sort"

// 本文件给出「这本相册里真实可用的筛选条件」。
//
// 筛选入口不能把没跑过的分析也摆成一个按钮：用户点下去得到空结果，
// 只会以为库里没有那样的照片。因此每个维度都带一个理由，说清它现在
// 为什么不能用 —— 是还没分析，还是分析了但这本相册里确实没有。

// AlbumFilterFacets 描述一本相册里真实可用的筛选维度。
type AlbumFilterFacets struct {
	// Total 是相册里的照片数。
	Total int `json:"total"`
	// Videos 是相册里的视频数：视频不参与分析类筛选。
	Videos int `json:"videos"`
	// Time 是拍摄时间这一维。
	Time AlbumTimeFacet `json:"time"`
	// People 是人物这一维。
	People AlbumPeopleFacet `json:"people"`
	// Places 是地点这一维。
	Places AlbumPlacesFacet `json:"places"`
	// Picks 是精选这一维。
	Picks AlbumPicksFacet `json:"picks"`
	// GroupPhotos 是合照这一维。
	GroupPhotos AlbumGroupPhotoFacet `json:"groupPhotos"`
	// Similarity 是相似照片这一维。
	Similarity AlbumSimilarityFacet `json:"similarity"`
}

// AlbumTimeFacet 是拍摄时间这一维的可选月份。
type AlbumTimeFacet struct {
	// Available 说明这一维现在能用。
	Available bool `json:"available"`
	// Reason 是不能用时的原因（中文，直接给用户看）。
	Reason string `json:"reason,omitempty"`
	// Months 是有照片的月份，按月份升序。
	Months []AlbumTimeBucket `json:"months"`
	// AnalyzedCount 是读得出 EXIF 记录的照片数。
	AnalyzedCount int `json:"analyzedCount"`
	// UnresolvedCount 是没有可信拍摄时间的照片数。
	UnresolvedCount int `json:"unresolvedCount"`
}

// AlbumTimeBucket 是一个月份里的照片数。
type AlbumTimeBucket struct {
	// Month 是 "YYYY-MM"。
	Month string `json:"month"`
	// Count 是这个月的照片数。
	Count int `json:"count"`
}

// AlbumPeopleFacet 是人物这一维。
type AlbumPeopleFacet struct {
	// Available 说明这一维现在能用。
	Available bool `json:"available"`
	// Reason 是不能用时的原因。
	Reason string `json:"reason,omitempty"`
	// Items 是这本相册里出现过的人物。
	Items []AlbumPersonFacet `json:"items"`
	// AnalyzedCount 是检测到人脸的照片数。
	AnalyzedCount int `json:"analyzedCount"`
}

// AlbumPersonFacet 是一个人物在这本相册里的出现。
type AlbumPersonFacet struct {
	// ID 是人物分组 ID。
	ID string `json:"id"`
	// Name 是显示名。
	Name string `json:"name"`
	// Count 是这本相册里含有这个人的照片数。
	Count int `json:"count"`
	// Confirmed 说明这个名字是用户确认过的。
	Confirmed bool `json:"confirmed"`
}

// AlbumPlacesFacet 是地点这一维。
type AlbumPlacesFacet struct {
	// Available 说明这一维现在能用。
	Available bool `json:"available"`
	// Reason 是不能用时的原因。
	Reason string `json:"reason,omitempty"`
	// Items 是这本相册里出现过的地点。
	Items []AlbumPlaceFacet `json:"items"`
	// LocatedCount 是带位置的照片数。
	LocatedCount int `json:"locatedCount"`
}

// AlbumPlaceFacet 是一个地点在这本相册里的出现。
type AlbumPlaceFacet struct {
	// Adcode 是行政区划码。
	Adcode int `json:"adcode"`
	// Name 是地名。
	Name string `json:"name"`
	// Level 是行政层级。
	Level string `json:"level"`
	// Count 是这个地点的照片数。
	Count int `json:"count"`
}

// AlbumPicksFacet 是精选这一维。
type AlbumPicksFacet struct {
	// PickedCount 是这本相册里已精选的照片数。
	PickedCount int `json:"pickedCount"`
}

// AlbumGroupPhotoFacet 是合照这一维。
type AlbumGroupPhotoFacet struct {
	// Available 说明这一维现在能用。
	Available bool `json:"available"`
	// Reason 是不能用时的原因。
	Reason string `json:"reason,omitempty"`
	// Count 是这本相册里的合照数。
	Count int `json:"count"`
}

// AlbumSimilarityFacet 是相似照片这一维。
type AlbumSimilarityFacet struct {
	// Available 说明这一维现在能用。
	Available bool `json:"available"`
	// Reason 是不能用时的原因。
	Reason string `json:"reason,omitempty"`
	// GroupCount 是落在这本相册里的相似组数。
	GroupCount int `json:"groupCount"`
	// PhotoCount 是落在这本相册里的、属于相似组的照片数。
	PhotoCount int `json:"photoCount"`
	// Stale 说明分组结果已经过期，需要重建。
	Stale bool `json:"stale"`
}

// Facets 给出这本相册里真实可用的筛选条件。
//
// 每个维度都按「这本相册」算：别的相册里有的东西，这里不该出现。
func (e *AlbumFilterEngine) Facets(snapshot CatalogSnapshot, albumID string) (AlbumFilterFacets, error) {
	items, exists := snapshot.AlbumMediaItems(albumID)
	if !exists {
		return AlbumFilterFacets{}, ErrLibraryResourceNotFound
	}
	context, err := e.newContext(snapshot, albumID, AlbumFilterQuery{}, items)
	if err != nil {
		return AlbumFilterFacets{}, err
	}
	// 筛选条件为空，上面的上下文只带回了相册成员；
	// 这里把每个维度要用的信号都算出来。
	context.loadMetadata()
	if err := context.loadLocations(); err != nil {
		return AlbumFilterFacets{}, err
	}
	context.loadPeople()
	context.loadSimilarity()
	context.loadGroupPhotos()
	context.loadPicks()

	facets := AlbumFilterFacets{Total: len(context.ids), Videos: context.videoCount}
	facets.Time = e.timeFacet(context)
	facets.People = e.peopleFacet(context)
	facets.Places = e.placesFacet(context)
	facets.Picks = AlbumPicksFacet{PickedCount: len(context.picked)}
	facets.GroupPhotos = e.groupPhotoFacet(context)
	facets.Similarity = e.similarityFacet(context)
	return facets, nil
}

// timeFacet 统计这本相册里可信拍摄时间的分布。
func (e *AlbumFilterEngine) timeFacet(context *albumFilterContext) AlbumTimeFacet {
	facet := AlbumTimeFacet{Months: []AlbumTimeBucket{}}
	if len(context.metadata) == 0 {
		facet.Reason = "这本相册还没有 EXIF 分析结果，先在任务中心运行元数据分析"
		return facet
	}
	facet.AnalyzedCount = len(context.metadata)
	counts := map[string]int{}
	for _, id := range context.ids {
		captured, ok := context.captureTime(id)
		if !ok {
			facet.UnresolvedCount++
			continue
		}
		counts[captured.YearMonth]++
	}
	months := make([]string, 0, len(counts))
	for month := range counts {
		months = append(months, month)
	}
	sort.Strings(months)
	for _, month := range months {
		facet.Months = append(facet.Months, AlbumTimeBucket{Month: month, Count: counts[month]})
	}
	if len(facet.Months) == 0 {
		facet.Reason = "这本相册的照片都没有可信的拍摄时间"
		return facet
	}
	facet.Available = true
	return facet
}

// peopleFacet 列出这本相册里出现过的人物。
func (e *AlbumFilterEngine) peopleFacet(context *albumFilterContext) AlbumPeopleFacet {
	facet := AlbumPeopleFacet{Items: []AlbumPersonFacet{}}
	if e.people == nil {
		facet.Reason = "还没有人脸分析结果，先在任务中心运行人脸分析"
		return facet
	}
	if e.jobs != nil && !e.jobs.PeopleEnabled() {
		facet.Reason = "人物分析还没有启用，先在任务中心打开"
		return facet
	}
	counts := map[string]int{}
	for _, id := range context.ids {
		for _, personID := range context.people[id] {
			counts[personID]++
		}
	}
	facet.AnalyzedCount = len(context.people)
	if len(counts) == 0 {
		facet.Reason = "这本相册的照片里还没有识别出人物"
		return facet
	}
	names := map[string]PersonGroup{}
	for _, group := range e.people.Groups(false) {
		names[group.ID] = group
	}
	for personID, count := range counts {
		group, exists := names[personID]
		if !exists {
			// 隐藏的人物仍可筛：用户知道它在那儿，只是没在列表里。
			continue
		}
		facet.Items = append(facet.Items, AlbumPersonFacet{
			ID:        group.ID,
			Name:      group.Name,
			Count:     count,
			Confirmed: group.Confirmed,
		})
	}
	sortAlbumFacets(facet.Items, func(item AlbumPersonFacet) int { return item.Count },
		func(item AlbumPersonFacet) string { return item.Name })
	facet.Available = len(facet.Items) > 0
	if !facet.Available {
		facet.Reason = "这本相册的照片里还没有识别出人物"
	}
	return facet
}

// placesFacet 列出这本相册里出现过的地点。
func (e *AlbumFilterEngine) placesFacet(context *albumFilterContext) AlbumPlacesFacet {
	facet := AlbumPlacesFacet{Items: []AlbumPlaceFacet{}}
	if len(context.metadata) == 0 {
		facet.Reason = "这本相册还没有 EXIF 分析结果，先在任务中心运行元数据分析"
		return facet
	}
	counts := map[int]*AlbumPlaceFacet{}
	for _, id := range context.ids {
		place, ok := context.locations[id]
		if !ok {
			continue
		}
		facet.LocatedCount++
		entry, exists := counts[place.adcode]
		if !exists {
			entry = &AlbumPlaceFacet{Adcode: place.adcode, Name: place.name, Level: place.level}
			counts[place.adcode] = entry
		}
		entry.Count++
	}
	for _, entry := range counts {
		facet.Items = append(facet.Items, *entry)
	}
	sortAlbumFacets(facet.Items, func(item AlbumPlaceFacet) int { return item.Count },
		func(item AlbumPlaceFacet) string { return item.Name })
	facet.Available = len(facet.Items) > 0
	if !facet.Available {
		facet.Reason = "这本相册的照片里没有位置信息"
	}
	return facet
}

// groupPhotoFacet 统计这本相册里的合照数。
func (e *AlbumFilterEngine) groupPhotoFacet(context *albumFilterContext) AlbumGroupPhotoFacet {
	facet := AlbumGroupPhotoFacet{}
	if e.people == nil {
		facet.Reason = "还没有人脸分析结果，先在任务中心运行人脸分析"
		return facet
	}
	if e.jobs != nil && !e.jobs.PeopleEnabled() {
		facet.Reason = "人物分析还没有启用，先在任务中心打开"
		return facet
	}
	for _, id := range context.ids {
		if context.groupPhoto[id] {
			facet.Count++
		}
	}
	facet.Available = true
	return facet
}

// similarityFacet 统计这本相册里的相似组。
func (e *AlbumFilterEngine) similarityFacet(context *albumFilterContext) AlbumSimilarityFacet {
	facet := AlbumSimilarityFacet{}
	if e.similarity == nil {
		facet.Reason = "还没有相似照片分析结果，先在任务中心运行相似照片分析"
		return facet
	}
	status := e.similarity.Status()
	if status.Analyzed == 0 {
		facet.Reason = "还没有相似照片分析结果，先在任务中心运行相似照片分析"
		return facet
	}
	facet.Stale = status.Stale
	groups := map[string]bool{}
	for _, id := range context.ids {
		ref, exists := context.similarity[id]
		if !exists {
			continue
		}
		facet.PhotoCount++
		groups[ref.ID] = true
	}
	facet.GroupCount = len(groups)
	facet.Available = true
	return facet
}
