package services

import (
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// 时间线上一个时间的来源。界面上要照实说：推断出来的日期不是拍摄时间，
// 修改时间更不是。
const (
	// TimelineDateExif 是 EXIF 里的拍摄时间 —— 唯一可信的拍摄证据。
	TimelineDateExif = "exif"
	// TimelineDateFilename 是从文件名推断出来的日期（IMG_20240102_…）。
	TimelineDateFilename = "filename"
	// TimelineDateFolder 是从目录名推断出来的日期（「2011年」这样的目录）。
	TimelineDateFolder = "folder"
	// TimelineDateModified 是文件的修改时间。它只说明文件最后一次被
	// 改动的时间：拷贝来的旧照片在这里会显示成拷贝那天。因此没有拍摄
	// 证据的媒体按它排，但排在时间线末尾，并这样标注。
	TimelineDateModified     = "modified"
	TimelinePrecisionDay     = "day"
	TimelinePrecisionMonth   = "month"
	TimelinePrecisionYear    = "year"
	TimelinePrecisionUnknown = "unknown"
)

type timelineDate struct {
	at        time.Time
	source    string
	precision string
}

type timelinePrecisionCode uint8

const (
	timelinePrecisionUnknown timelinePrecisionCode = iota
	timelinePrecisionDay
	timelinePrecisionMonth
	timelinePrecisionYear
)

func timelinePrecisionCodeFor(value string) timelinePrecisionCode {
	switch value {
	case TimelinePrecisionDay:
		return timelinePrecisionDay
	case TimelinePrecisionMonth:
		return timelinePrecisionMonth
	case TimelinePrecisionYear:
		return timelinePrecisionYear
	default:
		return timelinePrecisionUnknown
	}
}

func (p timelinePrecisionCode) String() string {
	switch p {
	case timelinePrecisionDay:
		return TimelinePrecisionDay
	case timelinePrecisionMonth:
		return TimelinePrecisionMonth
	case timelinePrecisionYear:
		return TimelinePrecisionYear
	default:
		return TimelinePrecisionUnknown
	}
}

// TimelineMonth 是某一年里一个月的媒体数。
type TimelineMonth struct {
	Month int `json:"month"`
	Count int `json:"count"`
}

// TimelineYear 是时间线上的一年：媒体数与月份分布。
//
// Year 为 0 表示「日期未知」那一段：那里的媒体只有修改时间，界面要
// 单独说，不能混进某一年里冒充那年的照片。
type TimelineYear struct {
	Year   int             `json:"year"`
	Count  int             `json:"count"`
	Months []TimelineMonth `json:"months,omitempty"`
}

// timelineEntry 是时间线上的一个媒体项在库里的位置。
//
// 索引只存位置与时间，不复制媒体摘要：大库的照片有十万张量级，
// 每张再抄一份摘要就是几兆的重复内存。
type timelineEntry struct {
	albumID   string
	index     int
	at        time.Time
	source    string
	precision timelinePrecisionCode
	// video 记下这个条目是不是视频：索引期就记下来，翻页时不必再回
	// 相册里找那一份媒体。
	video bool
}

// photoTimelineIndex 是排好序的全库照片序列。
type photoTimelineIndex struct {
	// epoch 是这份索引的版本：库版本与分析结果版本拼在一起。游标的
	// 作用域里带着它，任一者变化后旧游标立即失效 —— 否则翻页会按另一
	// 套顺序取数据，页与页之间漏项或重复。
	epoch           string
	catalogRevision uint64
	recordsRevision uint64
	// entries 是排好序的序列：有拍摄证据的在前（时间倒序），没有拍摄
	// 证据的按修改时间倒序排在后面。
	entries []timelineEntry
	// 每个闰年日序只存有逐张拍摄依据的条目下标，顺序沿用时间线。
	memoryDays [366][]int
	// byMedia 是按「相册 + 相册内序号」查时间证据的索引。
	//
	// 精选页要知道某张照片的拍摄日期，就得按位置反查 —— 那份索引与
	// 排序用的序列是同一批数据，不必再存一份摘要。
	byMedia map[string]timelineEntry
	// years 是年份索引，供界面跳年与跳月。
	years []TimelineYear
}

// PhotoTimelineService 把全库照片排成一条按时间下来的稳定序列。
//
// 它回答的是「按时间看这个库」：照片按拍摄证据排好，翻页按游标走，
// 跳年跳月直接落到那一段。序列在库版本或分析结果版本变化时重建一次，
// 平时复用缓存。
type PhotoTimelineService struct {
	mu   sync.Mutex
	jobs *AIJobService
	// cache 是当前这份索引；builtAt 是它建好的时刻。
	cache   *photoTimelineIndex
	builtAt time.Time
}

// NewPhotoTimelineService 建一个时间线服务。
//
// jobs 可以为空：没有分析结果时时间线按文件名与目录名推断，仍然可用，
// 只是少了最可信的那一类时间。
func NewPhotoTimelineService(jobs *AIJobService) *PhotoTimelineService {
	return &PhotoTimelineService{jobs: jobs}
}

// timelineRebuildInterval 是两次重建之间的最小间隔。
//
// 分析任务一批批提交结果，每批都让分析版本前进一位。全量重建一次要把
// 所有媒体的拍摄时间重排一遍；分析跑上一小时就会重建几百次，白白烧
// CPU。因此短时间内只重建一次，剩下的等下一轮。
const timelineRebuildInterval = 10 * time.Second

// index 返回当前该用的那份索引，必要时重建。
func (s *PhotoTimelineService) index(snapshot CatalogSnapshot) *photoTimelineIndex {
	s.mu.Lock()
	defer s.mu.Unlock()
	revision := snapshot.Revision()
	records := uint64(0)
	if s.jobs != nil {
		records = s.jobs.RecordsRevision()
	}
	if s.cache != nil && s.cache.catalogRevision == revision && s.cache.recordsRevision == records {
		return s.cache
	}
	if s.cache != nil && s.cache.catalogRevision == revision && time.Since(s.builtAt) < timelineRebuildInterval {
		// 刚重建过：分析多半还在跑，先用旧的那份，下一轮再更新。
		// 仅允许复用同一目录快照上的索引；库 revision 变化必须立即重建，
		// 否则旧位置会映射到新快照里的另一张照片。
		return s.cache
	}
	built := s.build(snapshot)
	s.cache = built
	s.builtAt = time.Now()
	return built
}

// build 按拍摄证据排出全库照片的顺序。
func (s *PhotoTimelineService) build(snapshot CatalogSnapshot) *photoTimelineIndex {
	library := snapshot.state.library
	exif := map[string]time.Time{}
	recordsRevision := uint64(0)
	if s.jobs != nil {
		exif, recordsRevision = s.jobs.AllCaptureTimesWithRevision(AIJobTypeMetadata)
	}
	revision := snapshot.Revision()
	epoch := strconv.FormatUint(revision, 10) + ":" + strconv.FormatUint(recordsRevision, 10)
	entries := make([]timelineEntry, 0, 1024)
	for _, album := range library.albums {
		if album.ContentKind != string(models.ContentKindPhoto) {
			continue
		}
		media := library.media[album.ID]
		sourceAlbum := snapshot.state.albums[album.ID]
		folderDate, folderPrecision, hasFolderDate := strictDateFromPath(sourceAlbum.Path)
		if !hasFolderDate && album.DateSource == TimelineDateFolder && !album.Date.IsZero() &&
			(album.DatePrecision == TimelinePrecisionDay || album.DatePrecision == TimelinePrecisionMonth || album.DatePrecision == TimelinePrecisionYear) {
			folderDate = album.Date
			folderPrecision = album.DatePrecision
			hasFolderDate = true
		}
		for index := range media {
			modifiedAt := album.ModTime
			if media[index].hasModifiedAt {
				modifiedAt = time.Unix(0, media[index].modifiedAtUnixNano).UTC()
			}
			date := timelineMediaTime(media[index], folderDate, folderPrecision, modifiedAt, exif)
			entries = append(entries, timelineEntry{
				albumID:   album.ID,
				index:     index,
				at:        date.at,
				source:    date.source,
				precision: timelinePrecisionCodeFor(date.precision),
				video:     media[index].Kind == "video",
			})
		}
	}
	sortTimelineEntries(entries)
	built := &photoTimelineIndex{
		epoch: epoch, catalogRevision: revision, recordsRevision: recordsRevision,
		entries: entries,
		byMedia: make(map[string]timelineEntry, len(entries)),
	}
	for position, entry := range entries {
		if entry.source == TimelineDateExif || entry.source == TimelineDateFilename {
			day := memoryDay(entry.at)
			built.memoryDays[day] = append(built.memoryDays[day], position)
		}
		built.byMedia[timelineMediaKey(entry.albumID, entry.index)] = entry
	}
	built.years = timelineYearIndex(entries)
	return built
}

// timelineMediaKey 是「相册 + 相册内序号」的索引键。
func timelineMediaKey(albumID string, index int) string {
	return albumID + "\x00" + strconv.Itoa(index)
}

// MediaDateEvidence 是一条媒体的时间证据。
//
// Value 是按精度写好的日期（YYYY-MM-DD / YYYY-MM / YYYY）：界面照它
// 显示，不必自己换算时区 —— 换算一遍就可能差一天。
type MediaDateEvidence struct {
	At        time.Time
	Source    string
	Precision string
	Value     string
}

// MediaDate 返回某个相册里第 index 个媒体的时间证据。
//
// 时间的可信度与时间线一致：EXIF 的拍摄时间 → 文件名里的日期 →
// 目录名里的日期 → 文件修改时间。返回值里的来源与精度要照实传给界面：
// 推断出来的日期不是拍摄时间，修改时间更不是。
//
// 找不到时返回 false：这一张没有可用的时间证据。
func (s *PhotoTimelineService) MediaDate(snapshot CatalogSnapshot, albumID string, index int) (MediaDateEvidence, bool) {
	if s == nil {
		return MediaDateEvidence{}, false
	}
	built := s.index(snapshot)
	if built == nil || built.byMedia == nil {
		return MediaDateEvidence{}, false
	}
	entry, ok := built.byMedia[timelineMediaKey(albumID, index)]
	if !ok {
		return MediaDateEvidence{}, false
	}
	precision := entry.precision.String()
	return MediaDateEvidence{
		At:        entry.at,
		Source:    entry.source,
		Precision: precision,
		Value:     timelineDateValue(entry.at, precision),
	}, true
}

// timelineMediaTime 取一个媒体在时间线上的时间与它的来源。
//
// 取时间的顺序就是可信度：EXIF 的拍摄时间 → 文件名里的日期 → 目录名
// 里的日期 → 文件修改时间。前两者与第三项是「拍摄证据」，最后一项不是 ——
// 它只说明文件最后一次被改动的时间。
func timelineMediaTime(
	item LibraryMediaItem,
	folderDate time.Time,
	folderPrecision string,
	modifiedAt time.Time,
	exif map[string]time.Time,
) timelineDate {
	if captured, ok := exif[item.ID]; ok && !captured.IsZero() {
		return makeTimelineDate(captured, TimelineDateExif, TimelinePrecisionDay)
	}
	if fromName := captureFromFileName(item.Name); !fromName.IsZero() {
		return makeTimelineDate(fromName, TimelineDateFilename, TimelinePrecisionDay)
	}
	if !folderDate.IsZero() && (folderPrecision == TimelinePrecisionDay || folderPrecision == TimelinePrecisionMonth || folderPrecision == TimelinePrecisionYear) {
		return makeTimelineDate(folderDate, TimelineDateFolder, folderPrecision)
	}
	// 没有单张拍摄证据或目录日期时，使用这一个文件自己的修改时间。旧扫描
	// 缓存缺少逐文件时间时，上层才退化到相册时间；精度仍标成 unknown。
	return makeTimelineDate(modifiedAt, TimelineDateModified, TimelinePrecisionUnknown)
}

func makeTimelineDate(at time.Time, source, precision string) timelineDate {
	if precision == "" {
		precision = TimelinePrecisionUnknown
	}
	return timelineDate{at: at, source: source, precision: precision}
}

func timelineDateValue(at time.Time, precision string) string {
	if at.IsZero() {
		return ""
	}
	switch precision {
	case TimelinePrecisionDay:
		return at.Format("2006-01-02")
	case TimelinePrecisionMonth:
		return at.Format("2006-01")
	case TimelinePrecisionYear:
		return at.Format("2006")
	default:
		return ""
	}
}

// sortTimelineEntries 排出时间线的顺序。
//
// 有拍摄证据的在前，按时间倒序（新的在上）；没有拍摄证据的按修改时间
// 倒序排在后面。同一时刻内按相册与相册内的次序排，翻页时顺序稳定。
func sortTimelineEntries(entries []timelineEntry) {
	sort.SliceStable(entries, func(i, j int) bool {
		left, right := entries[i], entries[j]
		leftKnown := left.source != TimelineDateModified
		rightKnown := right.source != TimelineDateModified
		if leftKnown != rightKnown {
			return leftKnown
		}
		if !left.at.Equal(right.at) {
			return left.at.After(right.at)
		}
		if left.albumID != right.albumID {
			return left.albumID < right.albumID
		}
		return left.index < right.index
	})
}

// timelineYearIndex 统计年份与月份分布，供界面跳年跳月。
//
// 「日期未知」那一段单列为年份 0：它不是某一年，混进去等于把拷贝来的
// 旧照片说成是那年的。
func timelineYearIndex(entries []timelineEntry) []TimelineYear {
	return timelineYearIndexWhere(entries, func(timelineEntry) bool { return true })
}

// timelineYearIndexWhere 按条件统计年份与月份分布。
//
// 只看视频时，年份与月份的数量也要是视频的数量：界面上跳年跳月按的是
// 眼下这一段筛选结果的数量，不是全库的数量。
func timelineYearIndexWhere(entries []timelineEntry, keep func(timelineEntry) bool) []TimelineYear {
	byYear := map[int]map[int]int{}
	countsByYear := map[int]int{}
	order := []int{}
	for _, entry := range entries {
		if entry.source == TimelineDateModified || entry.at.IsZero() {
			continue
		}
		if !keep(entry) {
			continue
		}
		year := entry.at.Year()
		months, ok := byYear[year]
		if !ok {
			months = map[int]int{}
			byYear[year] = months
			order = append(order, year)
		}
		countsByYear[year]++
		if entry.precision != timelinePrecisionYear {
			months[int(entry.at.Month())]++
		}
	}
	sort.Sort(sort.Reverse(sort.IntSlice(order)))
	years := make([]TimelineYear, 0, len(order))
	for _, year := range order {
		months := byYear[year]
		keys := make([]int, 0, len(months))
		for month := range months {
			keys = append(keys, month)
		}
		sort.Sort(sort.Reverse(sort.IntSlice(keys)))
		entry := TimelineYear{Year: year, Count: countsByYear[year]}
		for _, month := range keys {
			entry.Months = append(entry.Months, TimelineMonth{Month: month, Count: months[month]})
		}
		years = append(years, entry)
	}
	return years
}

// timelineFilter 是时间线的一次筛选：年、月、媒体类型。
type timelineFilter struct {
	year  int
	month int
	media string
}

// matches 判断一个条目落在筛选范围内。
func (f timelineFilter) matches(entry timelineEntry) bool {
	if !f.matchesMedia(entry) {
		return false
	}
	if f.year < 0 {
		// 「日期未知」那一段：只留没有拍摄证据的那些。
		return entry.source == TimelineDateModified
	}
	if f.year > 0 {
		if entry.source == TimelineDateModified || entry.at.IsZero() {
			return false
		}
		if entry.at.Year() != f.year {
			return false
		}
		if f.month > 0 {
			if entry.precision == timelinePrecisionYear || int(entry.at.Month()) != f.month {
				return false
			}
		}
	}
	return true
}

// matchesMedia 只看媒体类型：照片 / 视频这一维。
//
// 年份索引也要用它：只看视频时，年份的数量得是视频的数量。
func (f timelineFilter) matchesMedia(entry timelineEntry) bool {
	if f.media == "photo" && entry.mediaKindIsVideo() {
		return false
	}
	if f.media == "video" && !entry.mediaKindIsVideo() {
		return false
	}
	return true
}

// mediaKindIsVideo 判断这个条目是不是视频。
func (e timelineEntry) mediaKindIsVideo() bool {
	return e.video
}

// PhotoTimelinePage 是时间线的一页。
type PhotoTimelinePage struct {
	MediaFeedPage
	// Years 是年份索引（跳年跳月用）。它描述整条时间线，不随已加载页数变化。
	Years []TimelineYear `json:"years,omitempty"`
	// Unknown 是「日期未知」的媒体数：那些只有修改时间的照片。
	Unknown int `json:"unknown,omitempty"`
	// DateSources 说明这一页里的时间分别来自哪里，按来源计数。
	// 界面据此说清「这一段的时间是推断的」还是「这一段是拍摄时间」。
	DateSources map[string]int `json:"dateSources,omitempty"`
	// DatePrecisions 说明整段筛选结果里的日期精度分布，与 dateSources 分开统计。
	DatePrecisions map[string]int `json:"datePrecisions,omitempty"`
}

// Page 返回时间线上的一页。
//
// 顺序由时间线索引决定（拍摄证据优先，时间倒序），翻页用游标；
// 年份、月份与媒体类型是筛选条件，落在筛选之后。
func (s *PhotoTimelineService) Page(
	snapshot CatalogSnapshot,
	query MediaFeedQuery,
	cursor string,
	limit int,
) (PhotoTimelinePage, error) {
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return PhotoTimelinePage{}, ErrLibraryNotReady
	}
	filter, err := timelineFilterFromQuery(query)
	if err != nil {
		return PhotoTimelinePage{}, err
	}
	index := s.index(snapshot)
	library := snapshot.state.library

	// 筛选后的序列下标表：只算一次，翻页时按它切。
	matched := make([]int, 0, len(index.entries))
	for position := range index.entries {
		if filter.matches(index.entries[position]) {
			matched = append(matched, position)
		}
	}
	scope := "photo-timeline:" + index.epoch + ":" + filter.scopeKey()
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return PhotoTimelinePage{}, err
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(matched), limit)
	if err != nil {
		return PhotoTimelinePage{}, err
	}
	items := make([]FeedMediaItem, 0, end-start)
	// 时间来源的分布按整段筛选结果算，不只算这一页：界面上要说的是
	// 「这一屏看到的时间都是怎么来的」，而不是「这一页恰好有几种来源」。
	sources := map[string]int{}
	precisions := map[string]int{}
	for _, position := range matched {
		entry := index.entries[position]
		sources[entry.source]++
		precisions[entry.precision.String()]++
	}
	unknown := 0
	for _, entry := range index.entries {
		if entry.source == TimelineDateModified && filter.matchesMedia(entry) {
			unknown++
		}
	}
	for _, position := range matched[start:end] {
		entry := index.entries[position]
		if item, ok := timelineFeedItem(library, entry); ok {
			items = append(items, item)
		}
	}
	// 年份索引：跳年跳月用。它按媒体类型筛选（照片 / 视频），但不按年份筛 ——
	// 选中年份后还要能换到别的年份。
	years := index.years
	if filter.media != "all" {
		years = timelineYearIndexWhere(index.entries, filter.matchesMedia)
	}

	albums := []FeedAlbumRef{}
	counts := map[string]int{}
	albumOrder := make([]string, 0)
	seen := map[string]bool{}
	for _, position := range matched {
		entry := index.entries[position]
		counts[entry.albumID]++
		if seen[entry.albumID] {
			continue
		}
		seen[entry.albumID] = true
		albumOrder = append(albumOrder, entry.albumID)
	}
	for _, albumID := range albumOrder {
		album, ok := library.nodes[albumID]
		if !ok {
			continue
		}
		name := strings.TrimSpace(album.DisplayName)
		if name == "" {
			name = strings.TrimSpace(album.Name)
		}
		albums = append(albums, FeedAlbumRef{
			ID:    albumID,
			Name:  name,
			Count: counts[albumID],
		})
	}
	return PhotoTimelinePage{
		MediaFeedPage: MediaFeedPage{
			LibraryPage: LibraryPage[FeedMediaItem]{
				Revision: snapshot.Revision(), Items: items, Total: len(matched), NextCursor: next,
			},
			Albums:  albums,
			Sources: []FeedSource{},
		},
		Years:          years,
		Unknown:        unknown,
		DateSources:    sources,
		DatePrecisions: precisions,
	}, nil
}

// timelineFilterFromQuery 把请求参数收成筛选条件。
func timelineFilterFromQuery(query MediaFeedQuery) (timelineFilter, error) {
	filter := timelineFilter{media: strings.TrimSpace(query.Media)}
	switch filter.media {
	case "", "all":
		filter.media = "all"
	case "photo", "video":
	default:
		return timelineFilter{}, ErrInvalidMediaFeedQuery
	}
	if query.Year == "unknown" {
		// 「日期未知」那一段：只有文件修改时间的那些。
		//
		// 它不是某一年，单独成一个入口：混进某一年等于把拷贝来的旧照片
		// 说成那年的。
		filter.year = -1
	} else if query.Year != "" && query.Year != "other" {
		year, err := strconv.Atoi(query.Year)
		if err != nil || year < 1900 || year > 2099 {
			return timelineFilter{}, ErrInvalidMediaFeedQuery
		}
		filter.year = year
	}
	if query.Month != "" {
		month, err := strconv.Atoi(query.Month)
		if err != nil || month < 1 || month > 12 {
			return timelineFilter{}, ErrInvalidMediaFeedQuery
		}
		if filter.year <= 0 {
			// 没有年份就没有月份：月份只在年份之内有意义。
			return timelineFilter{}, ErrInvalidMediaFeedQuery
		}
		filter.month = month
	}
	return filter, nil
}

// scopeKey 是筛选条件在游标作用域里的标记。
//
// 换了筛选条件，旧游标必须失效：否则下一页会按另一套条件取数据。
func (f timelineFilter) scopeKey() string {
	return strings.Join([]string{
		strconv.Itoa(f.year),
		strconv.Itoa(f.month),
		f.media,
	}, "|")
}

func timelineFeedItem(library *libraryPageIndex, entry timelineEntry) (FeedMediaItem, bool) {
	album, ok := library.nodes[entry.albumID]
	if !ok {
		return FeedMediaItem{}, false
	}
	media := library.media[entry.albumID]
	if entry.index < 0 || entry.index >= len(media) {
		return FeedMediaItem{}, false
	}
	item := media[entry.index]
	if item.sourcePath != "" {
		if version, verr := MediaVersion(item.sourcePath); verr == nil {
			item.Version = version
		}
	}
	name := strings.TrimSpace(album.DisplayName)
	if name == "" {
		name = strings.TrimSpace(album.Name)
	}
	capturedAt := ""
	// 旧字段继续对精确日与文件修改时间提供 RFC3339 值。年月/年份证据
	// 不伪造第一天，使用新增 dateValue + datePrecision 字段表达。
	if entry.precision == timelinePrecisionDay || entry.precision == timelinePrecisionUnknown {
		if !entry.at.IsZero() {
			capturedAt = entry.at.UTC().Format(time.RFC3339)
		}
	}
	return FeedMediaItem{
		LibraryMediaItem: item,
		AlbumID:          entry.albumID,
		AlbumName:        name,
		CapturedAt:       capturedAt,
		DateSource:       entry.source,
		DatePrecision:    entry.precision.String(),
		DateValue:        timelineDateValue(entry.at, entry.precision.String()),
	}, true
}

// 闰年包含全部月日，以同一把日历尺跨年比较距离。
func memoryDay(date time.Time) int {
	return time.Date(2000, date.Month(), date.Day(), 0, 0, 0, 0, time.UTC).YearDay() - 1
}

// Memories 按月日距离选取往年照片。同一月日沿用时间线顺序，同一本可贡献多张。
func (s *PhotoTimelineService) Memories(snapshot CatalogSnapshot, today time.Time) ([]FeedMediaItem, error) {
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return nil, ErrLibraryNotReady
	}
	const limit = 8
	items := make([]FeedMediaItem, 0, limit)
	seen := make(map[string]bool, limit)
	index := s.index(snapshot)
	center := memoryDay(today)
	for distance := 0; distance <= len(index.memoryDays)/2; distance++ {
		before := (center - distance + len(index.memoryDays)) % len(index.memoryDays)
		after := (center + distance) % len(index.memoryDays)
		days := []int{before}
		if before != after {
			days = append(days, after)
		}
		for _, day := range days {
			for _, position := range index.memoryDays[day] {
				entry := index.entries[position]
				if entry.at.Year() >= today.Year() {
					continue
				}
				id := snapshot.state.library.media[entry.albumID][entry.index].ID
				if seen[id] {
					continue
				}
				item, ok := timelineFeedItem(snapshot.state.library, entry)
				if !ok {
					continue
				}
				seen[id] = true
				items = append(items, item)
				if len(items) == limit {
					return items, nil
				}
			}
		}
	}
	return items, nil
}
