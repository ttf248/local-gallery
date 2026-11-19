package services

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"

	"github.com/tianlongxiang/local-gallery/internal/store"
)

// 本文件是原始照片墙的智能筛选与相似折叠的服务端实现。
//
// 筛选作用在整本相册的数据上，不是前端已经加载的那几页：条件先落成
// 「相册成员 → 是否命中」的判定，再按相册的自然顺序分页。因此结果总数、
// 翻页与大图浏览顺序始终是同一件事，前端也不必自己过滤。

const (
	// AlbumFilterSceneGroupPhoto 只看合照。
	AlbumFilterSceneGroupPhoto = "groupPhoto"
	// AlbumFilterSceneSimilar 只看有相似同伴的照片。
	AlbumFilterSceneSimilar = "similar"
	// AlbumFilterPicksOnly 只看已精选。
	AlbumFilterPicksOnly = "only"
	// AlbumFilterPicksNone 只看未精选。
	AlbumFilterPicksNone = "none"
)

// AlbumFilterQuery 描述一组作用于一本相册内照片的筛选条件。
//
// 空条件表示不过滤：这时相册里的照片与视频原样返回。
type AlbumFilterQuery struct {
	// From / To 是拍摄时间的日历月区间（"YYYY-MM"），左闭右闭，空表示不限。
	From string
	To   string
	// PersonID 只保留出现过这个人物的照片。
	PersonID string
	// Adcode 只保留落在这个行政区（含其下级）里的照片。
	Adcode int
	// Picks 是精选口径："" 不限、"only" 只看精选、"none" 只看未精选。
	Picks string
	// Scene 是画面口径："" 不限、"groupPhoto" 只看合照、"similar" 只看相似。
	Scene string
	// Collapse 折叠相似组：墙上只留每组的代表照片。
	Collapse bool
	// Expand 是被展开的那一组：它的成员不再折叠，就地摆在墙上。
	Expand string
}

// IsZero 判断是否没有筛选条件。
func (q AlbumFilterQuery) IsZero() bool {
	return q.From == "" && q.To == "" && q.PersonID == "" && q.Adcode == 0 &&
		q.Picks == "" && q.Scene == "" && !q.Collapse && q.Expand == ""
}

// ScopeKey 是筛选条件在翻页游标里的标记。
//
// 换了筛选条件，旧游标必须失效：否则下一页会按另一套条件取数据，
// 页与页之间会漏项或重复。折叠与展开也要算进去 —— 折叠与否的墙上
// 不是同一批照片。
func (q AlbumFilterQuery) ScopeKey() string {
	if q.IsZero() {
		return "all"
	}
	return strings.Join([]string{
		q.From,
		q.To,
		q.PersonID,
		strconv.Itoa(q.Adcode),
		q.Picks,
		q.Scene,
		strconv.FormatBool(q.Collapse),
		q.Expand,
	}, "|")
}

// AlbumFilterPage 是相册照片墙的一页。
//
// 没有筛选时它就是普通的一页相册媒体；带筛选时另外说明有多少照片
// 因为「没有拍摄时间」「没有位置」这类原因没能参与筛选 ——
// 说不清这一点，筛选结果就会被当成全貌。
type AlbumFilterPage struct {
	LibraryPage[LibraryMediaItem]
	// Filtered 说明这一页是筛选后的结果。
	Filtered bool `json:"filtered"`
	// AlbumTotal 是这本相册的媒体总数（筛选前）。
	AlbumTotal int `json:"albumTotal"`
	// VideoTotal 是这本相册里的视频数：视频不参与分析类筛选。
	VideoTotal int `json:"videoTotal"`
	// PhotoTotal 是这一页里照片的张数（不含视频）。
	//
	// 计数口径要与页头一致：视频不参与分析类筛选，折叠只对照片生效，
	// 因此墙上摆着几张照片要单独报出来，不能拿媒体总数充数。
	PhotoTotal int `json:"photoTotal"`
	// Unresolved 是没能参与筛选的照片数，按维度分列。
	Unresolved AlbumFilterUnresolved `json:"unresolved"`
	// Grouped 是折叠后藏起来的照片数。
	Grouped int `json:"grouped"`
	// GroupedGroups 是被折叠的相似组数。
	GroupedGroups int `json:"groupedGroups"`
}

// AlbumFilterUnresolved 说明有多少照片因为缺少依据而没被纳入筛选。
type AlbumFilterUnresolved struct {
	// CaptureTime 是没有可信拍摄时间的照片数。
	CaptureTime int `json:"captureTime"`
	// Location 是没有位置信息的照片数。
	Location int `json:"location"`
	// Face 是没有人脸分析结果的照片数。
	Face int `json:"face"`
	// Total 是因为缺少依据而没被纳入筛选的照片总数（去重）。
	//
	// 三个分项会重叠：一张既没有拍摄时间也没有人脸的照片，两项都算它。
	// 报一个去重后的总数，界面上才不会摆出一个比整本相册还大的数字。
	Total int `json:"total"`
}

// AlbumSimilarityRef 是相似组在相册照片墙上的引用。
//
// 照片墙只需要知道「这张属于哪一组、这组在本相册里有几张、代表是谁」，
// 成员名单在用户点开那一组时才去取。
type AlbumSimilarityRef struct {
	// ID 是分组的稳定标识。
	ID string `json:"id"`
	// Kind 是分组类别：exact / near / burst。
	Kind string `json:"kind"`
	// Size 是组内照片总数（全库口径）。
	Size int `json:"size"`
	// Redundant 是全库口径下除代表之外的张数。
	Redundant int `json:"redundant"`
	// Representative 是当前生效的代表照片。
	Representative string `json:"representative"`
	// RepresentativeIsManual 说明代表照片是用户指定的。
	RepresentativeIsManual bool `json:"representativeIsManual"`
	// AlbumSize 是组内落在本相册的张数。
	AlbumSize int `json:"albumSize"`
	// AlbumHidden 是折叠后藏起来的张数（相册内）。
	AlbumHidden int `json:"albumHidden"`
	// Shown 是折叠时留在墙上的那张。
	Shown string `json:"shown"`
}

// AlbumFilterEngine 给原始照片墙提供筛选与相似折叠。
//
// 它只读现有的资源索引、分析记录、人物索引、精选集合与相似分组，
// 不新建索引，也不改动任何原始媒体或用户数据。
type AlbumFilterEngine struct {
	catalog    *ResourceCatalog
	jobs       *AIJobService
	people     *PeopleService
	picks      *store.PickStore
	similarity *SimilarityService
}

// NewAlbumFilterEngine 组装照片墙的筛选引擎。
func NewAlbumFilterEngine(
	catalog *ResourceCatalog,
	jobs *AIJobService,
	people *PeopleService,
	picks *store.PickStore,
	similarity *SimilarityService,
) *AlbumFilterEngine {
	return &AlbumFilterEngine{
		catalog:    catalog,
		jobs:       jobs,
		people:     people,
		picks:      picks,
		similarity: similarity,
	}
}

// albumFilterContext 是一次筛选请求的上下文。
//
// 派生信号按需计算：没用到人物就不碰人物索引，没用到地点就不做点在多边形
// 判定。相册再大，代价也只跟真正用到的维度成正比。
type albumFilterContext struct {
	engine   *AlbumFilterEngine
	snapshot CatalogSnapshot
	albumID  string
	query    AlbumFilterQuery
	items    []LibraryMediaItem
	ids      []string
	// videoCount 是相册里的视频数。
	videoCount int

	metadata   map[string]ImageMetadata
	locations  map[string]albumPhotoPlace
	people     map[string][]string
	groupPhoto map[string]bool
	similarity map[string]SimilarityGroupRef
	picked     map[string]bool

	// placeScope 是地点筛选的范围（区划码集合）。
	placeScope map[int]bool
	// grouped 是折叠后藏起来的照片数，groupedGroups 是组数。
	grouped       int
	groupedGroups int
}

// albumPhotoPlace 是一张照片命中的地点。
type albumPhotoPlace struct {
	adcode int
	name   string
	level  string
}

// albumFilterNeeds 说明这次请求要算哪些信号。
type albumFilterNeeds struct {
	captureTime bool
	locations   bool
	people      bool
	groupPhotos bool
}

// needsFor 按筛选条件算出要算哪些信号。
func (q AlbumFilterQuery) needsFor() albumFilterNeeds {
	return albumFilterNeeds{
		captureTime: q.From != "" || q.To != "",
		locations:   q.Adcode != 0,
		people:      q.PersonID != "",
		groupPhotos: q.Scene == AlbumFilterSceneGroupPhoto,
	}
}

// Page 按筛选条件分页返回相册媒体。
//
// 条件先作用于整本相册，再按相册的自然顺序切片。翻页游标的作用域里带着
// 筛选条件，换条件后旧游标立即失效。
func (e *AlbumFilterEngine) Page(
	snapshot CatalogSnapshot,
	albumID string,
	query AlbumFilterQuery,
	cursor string,
	limit int,
) (AlbumFilterPage, error) {
	items, exists := snapshot.AlbumMediaItems(albumID)
	if !exists {
		return AlbumFilterPage{}, ErrLibraryResourceNotFound
	}
	context, err := e.newContext(snapshot, albumID, query, items)
	if err != nil {
		return AlbumFilterPage{}, err
	}
	kept, unresolved := context.apply()
	grouped, groupedGroups := context.groupedCount()
	photoTotal := 0
	for i := range kept {
		if kept[i].Kind == "image" {
			photoTotal++
		}
	}
	scope := "album-media:" + albumID + ":" + query.ScopeKey()
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return AlbumFilterPage{}, err
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(kept), limit)
	if err != nil {
		return AlbumFilterPage{}, err
	}
	page := clonePage(kept, start, end)
	for i := range page {
		if page[i].sourcePath == "" {
			continue
		}
		// 版本号按需 stat：只为这一页的文件付代价。
		if version, verr := MediaVersion(page[i].sourcePath); verr == nil {
			page[i].Version = version
		}
	}
	return AlbumFilterPage{
		LibraryPage: LibraryPage[LibraryMediaItem]{
			Revision:   snapshot.Revision(),
			Items:      page,
			Total:      len(kept),
			NextCursor: next,
		},
		Filtered:      !query.IsZero(),
		AlbumTotal:    len(items),
		VideoTotal:    context.videoCount,
		PhotoTotal:    photoTotal,
		Unresolved:    unresolved,
		Grouped:       grouped,
		GroupedGroups: groupedGroups,
	}, nil
}

// newContext 组装一次筛选的上下文。
func (e *AlbumFilterEngine) newContext(
	snapshot CatalogSnapshot,
	albumID string,
	query AlbumFilterQuery,
	items []LibraryMediaItem,
) (*albumFilterContext, error) {
	context := &albumFilterContext{
		engine:   e,
		snapshot: snapshot,
		albumID:  albumID,
		query:    query,
		items:    items,
	}
	for _, item := range items {
		if item.Kind == "image" {
			context.ids = append(context.ids, item.ID)
		} else {
			context.videoCount++
		}
	}
	needs := query.needsFor()
	if needs.captureTime || needs.locations {
		context.loadMetadata()
	}
	if needs.locations {
		if err := context.loadLocations(); err != nil {
			return nil, err
		}
	}
	if needs.people {
		context.loadPeople()
	}
	if needs.groupPhotos {
		context.loadGroupPhotos()
	}
	// 相似分组始终读一份：墙上每一张都要能说出自己属于哪一组，
	// 用户不必先打开折叠才知道这儿有相似的照片。
	context.loadSimilarity()
	if query.Picks != "" {
		context.loadPicks()
	}
	return context, nil
}

// loadMetadata 读出相册里每张照片的 EXIF 记录。
func (c *albumFilterContext) loadMetadata() {
	c.metadata = map[string]ImageMetadata{}
	if c.engine.jobs == nil {
		return
	}
	records := c.engine.jobs.RecordsForResources(AIJobTypeMetadata, c.ids)
	for resourceID, record := range records {
		if record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil {
			continue
		}
		c.metadata[resourceID] = metadata
	}
}

// loadLocations 把相册里有坐标的照片归到市级行政区。
//
// 归并到市级：一张照片落到区县时归它的市；直辖市的区县往上退到省级。
// 这与足迹页的地点粒度一致。
func (c *albumFilterContext) loadLocations() error {
	c.locations = map[string]albumPhotoPlace{}
	if len(c.metadata) == 0 {
		return nil
	}
	index, err := loadChinaAdminIndex()
	if err != nil {
		return err
	}
	for resourceID, metadata := range c.metadata {
		if metadata.GPS == nil || !validCoordinates(metadata.GPS.Latitude, metadata.GPS.Longitude) {
			continue
		}
		longitude, latitude, valid := coordinatesToChinaMap(
			metadata.GPS.Longitude, metadata.GPS.Latitude, metadata.GPS.MapDatum,
		)
		if !valid {
			continue
		}
		place, ok := albumPhotoPlaceAt(index, longitude, latitude)
		if !ok {
			continue
		}
		c.locations[resourceID] = place
	}
	return nil
}

// loadPeople 读出相册里每张照片上的人物分组。
func (c *albumFilterContext) loadPeople() {
	c.people = map[string][]string{}
	if c.engine.people == nil {
		return
	}
	index := c.engine.people.ResourcePersonIndex()
	for _, id := range c.ids {
		if persons, exists := index[id]; exists {
			c.people[id] = persons
		}
	}
}

// loadGroupPhotos 判定相册里哪些照片是合照。
func (c *albumFilterContext) loadGroupPhotos() {
	c.groupPhoto = map[string]bool{}
	if c.engine.people == nil {
		return
	}
	members := make(map[string]bool, len(c.ids))
	for _, id := range c.ids {
		members[id] = true
	}
	c.groupPhoto = c.engine.people.GroupPhotoResources(
		func(resourceID string) bool { return members[resourceID] },
		PeopleGroupPhotoFaceThreshold,
	)
}

// loadSimilarity 读出相册里每张照片所属的相似组。
func (c *albumFilterContext) loadSimilarity() {
	c.similarity = map[string]SimilarityGroupRef{}
	if c.engine.similarity == nil {
		return
	}
	c.similarity = c.engine.similarity.ResourceGroupRefs(c.ids)
}

// loadPicks 读出精选集合。
func (c *albumFilterContext) loadPicks() {
	c.picked = map[string]bool{}
	if c.engine.picks == nil {
		return
	}
	for _, id := range c.engine.picks.Get() {
		c.picked[id] = true
	}
}

// groupedCount 统计折叠后藏起来的照片数与组数。
func (c *albumFilterContext) groupedCount() (int, int) {
	return c.grouped, c.groupedGroups
}

// apply 按条件筛出留下的照片，再在留下的那些里折叠相似组。
//
// 顺序保持相册的自然顺序：筛选只决定「留哪些」，不重新排序 ——
// 用户换一张筛选条件，墙上的先后就该是同一套。
//
// 折叠放在筛选之后：折叠的是「这一屏里的重复」，不是整本相册的重复。
// 先折叠再筛会留下一批没有代表的空组，角标上的张数也会与墙上对不上。
func (c *albumFilterContext) apply() ([]LibraryMediaItem, AlbumFilterUnresolved) {
	unresolved := AlbumFilterUnresolved{}
	if c.query.IsZero() {
		return c.fold(c.items), unresolved
	}
	analysisFilter := c.query.From != "" || c.query.To != "" || c.query.PersonID != "" ||
		c.query.Adcode != 0 || c.query.Picks != "" || c.query.Scene != ""

	filtered := make([]LibraryMediaItem, 0, len(c.items))
	for _, item := range c.items {
		if item.Kind != "image" {
			// 视频没有拍摄时间、位置与人物，混进筛选结果只会给出
			// 一批「说不清为什么在」的条目。有分析类筛选时它们不进结果。
			if analysisFilter {
				continue
			}
			filtered = append(filtered, item)
			continue
		}
		c.countUnresolved(item.ID, &unresolved)
		if !c.matches(item.ID) {
			continue
		}
		filtered = append(filtered, item)
	}
	return c.fold(filtered), unresolved
}

// fold 在留下的照片里折叠相似组：每组只留一张，其余收起来。
//
// 留哪一张：组的代表照片若也在结果里就留它；否则留结果里的第一张成员 ——
// 折叠的是这一本里的重复，不是别的文件夹里的。
//
// 被展开的那一组不折叠：它的成员聚到代表照片后面就地摊开。
// 组的成员在相册里可能隔得很远，摊在各自的位置上等于没展开。
func (c *albumFilterContext) fold(items []LibraryMediaItem) []LibraryMediaItem {
	members := map[string][]string{}
	byID := map[string]LibraryMediaItem{}
	for _, item := range items {
		byID[item.ID] = item
		ref, exists := c.similarity[item.ID]
		if !exists {
			continue
		}
		members[ref.ID] = append(members[ref.ID], item.ID)
	}
	shown := map[string]string{}
	for groupID, ids := range members {
		if len(ids) < 2 {
			continue
		}
		ref := c.similarity[ids[0]]
		keep := ""
		for _, id := range ids {
			if id == ref.Representative {
				keep = id
				break
			}
		}
		if keep == "" {
			keep = ids[0]
		}
		shown[groupID] = keep
	}

	// 展开的那一组：成员聚到代表照片后面。
	moved := map[string]bool{}
	expandedTail := map[string][]string{}
	if c.query.Expand != "" {
		for _, id := range members[c.query.Expand] {
			if id == shown[c.query.Expand] {
				continue
			}
			expandedTail[c.query.Expand] = append(expandedTail[c.query.Expand], id)
			moved[id] = true
		}
	}

	kept := make([]LibraryMediaItem, 0, len(items))
	for _, item := range items {
		if moved[item.ID] {
			// 已经提前摆到代表照片后面了。
			continue
		}
		ref, exists := c.similarity[item.ID]
		if !exists {
			kept = append(kept, item)
			continue
		}
		albumSize := len(members[ref.ID])
		albumRef := AlbumSimilarityRef{
			ID:                     ref.ID,
			Kind:                   ref.Kind,
			Size:                   ref.Size,
			Redundant:              ref.Redundant,
			Representative:         ref.Representative,
			RepresentativeIsManual: ref.RepresentativeIsManual,
			AlbumSize:              albumSize,
			Shown:                  shown[ref.ID],
		}
		if albumSize > 1 && ref.ID == c.query.Expand {
			// 展开的这一组：成员全部留在墙上，聚在代表照片后面。
			albumRef.Shown = shown[ref.ID]
			item.SimilarityGroup = &albumRef
			kept = append(kept, item)
			for _, id := range expandedTail[ref.ID] {
				member := byID[id]
				memberRef := albumRef
				member.SimilarityGroup = &memberRef
				kept = append(kept, member)
			}
			continue
		}
		if c.query.Collapse && albumSize > 1 {
			albumRef.AlbumHidden = albumSize - 1
			if shown[ref.ID] != item.ID {
				c.grouped++
				continue
			}
			c.groupedGroups++
		}
		item.SimilarityGroup = &albumRef
		kept = append(kept, item)
	}
	return kept
}

// countUnresolved 统计这张照片因为缺少依据而没能参与筛选。
//
// 说不清这一点，筛选结果就会被当成全貌：用户看到 12 张，却不知道
// 还有 300 张没有拍摄时间、没被算进来。三个分项会重叠，总数去重。
func (c *albumFilterContext) countUnresolved(resourceID string, unresolved *AlbumFilterUnresolved) {
	missing := false
	if c.query.From != "" || c.query.To != "" {
		if _, ok := c.captureTime(resourceID); !ok {
			unresolved.CaptureTime++
			missing = true
		}
	}
	if c.query.Adcode != 0 {
		if _, ok := c.locations[resourceID]; !ok {
			unresolved.Location++
			missing = true
		}
	}
	if c.query.PersonID != "" || c.query.Scene == AlbumFilterSceneGroupPhoto {
		if _, ok := c.people[resourceID]; !ok {
			unresolved.Face++
			missing = true
		}
	}
	if missing {
		unresolved.Total++
	}
}

// matches 判断一张照片是否命中全部筛选条件。
func (c *albumFilterContext) matches(resourceID string) bool {
	if c.query.From != "" || c.query.To != "" {
		captured, ok := c.captureTime(resourceID)
		if !ok {
			return false
		}
		if c.query.From != "" && captured.YearMonth < c.query.From {
			return false
		}
		if c.query.To != "" && captured.YearMonth > c.query.To {
			return false
		}
	}
	if c.query.PersonID != "" {
		found := false
		for _, personID := range c.people[resourceID] {
			if personID == c.query.PersonID {
				found = true
				break
			}
		}
		if !found {
			return false
		}
	}
	if c.query.Adcode != 0 {
		place, ok := c.locations[resourceID]
		if !ok || !c.placeInScope(place.adcode) {
			return false
		}
	}
	if c.query.Picks != "" {
		isPicked := c.picked[resourceID]
		if c.query.Picks == AlbumFilterPicksOnly && !isPicked {
			return false
		}
		if c.query.Picks == AlbumFilterPicksNone && isPicked {
			return false
		}
	}
	if c.query.Scene == AlbumFilterSceneGroupPhoto && !c.groupPhoto[resourceID] {
		return false
	}
	if c.query.Scene == AlbumFilterSceneSimilar {
		if _, exists := c.similarity[resourceID]; !exists {
			return false
		}
	}
	return true
}

// captureTime 返回照片的可信拍摄时间。
func (c *albumFilterContext) captureTime(resourceID string) (chinaCaptureTime, bool) {
	metadata, exists := c.metadata[resourceID]
	if !exists {
		return chinaCaptureTime{}, false
	}
	captured := parseChinaCaptureTime(metadata.DateTimeOriginal)
	return captured, captured.Valid
}

// placeInScope 判断一个区划是否落在筛选范围内（含下级）。
func (c *albumFilterContext) placeInScope(adcode int) bool {
	if adcode == 0 {
		return false
	}
	if c.placeScope == nil {
		scope := map[int]bool{}
		if filter, err := NewChinaPlaceFilter(c.query.Adcode); err == nil {
			scope = filter.Adcodes()
		}
		c.placeScope = scope
	}
	return c.placeScope[adcode]
}

// albumPhotoPlaceAt 把一个坐标归到市级行政区。
func albumPhotoPlaceAt(index *chinaAdminIndex, longitude, latitude float64) (albumPhotoPlace, bool) {
	if index == nil {
		return albumPhotoPlace{}, false
	}
	province := matchingChinaFeature(index.provinces, longitude, latitude)
	if province == nil {
		return albumPhotoPlace{}, false
	}
	adcode, name, level := province.adcode, province.name, province.level
	if area := deepestChinaFeature(index, province, longitude, latitude); area != nil {
		switch area.level {
		case chinaAdminCityLevel:
			adcode, name, level = area.adcode, area.name, area.level
		case chinaAdminDistrictLevel:
			// 区县的上一级就是市；直辖市的区县没有市一级，往上退到省级。
			if parent, ok := index.byAdcode[area.parentAdcode]; ok && parent.level == chinaAdminCityLevel {
				adcode, name, level = parent.adcode, parent.name, parent.level
			}
		}
	}
	return albumPhotoPlace{adcode: adcode, name: name, level: level}, true
}

// sortAlbumFacets 按张数降序排列地点与人物；同数按名字排。
func sortAlbumFacets[T any](items []T, count func(T) int, name func(T) string) {
	sort.SliceStable(items, func(i, j int) bool {
		left, right := count(items[i]), count(items[j])
		if left != right {
			return left > right
		}
		return name(items[i]) < name(items[j])
	})
}
