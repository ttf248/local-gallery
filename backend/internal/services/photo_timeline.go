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
	TimelineDateModified = "modified"
)

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
	albumID string
	index   int
	at      time.Time
	source  string
	// video 记下这个条目是不是视频：索引期就记下来，翻页时不必再回
	// 相册里找那一份媒体。
	video bool
}

// photoTimelineIndex 是排好序的全库照片序列。
type photoTimelineIndex struct {
	// epoch 是这份索引的版本：库版本与分析结果版本拼在一起。游标的
	// 作用域里带着它，任一者变化后旧游标立即失效 —— 否则翻页会按另一
	// 套顺序取数据，页与页之间漏项或重复。
	epoch string
	// entries 是排好序的序列：有拍摄证据的在前（时间倒序），没有拍摄
	// 证据的按修改时间倒序排在后面。
	entries []timelineEntry
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
	epoch := strconv.FormatUint(revision, 10) + ":" + strconv.FormatUint(records, 10)
	if s.cache != nil && s.cache.epoch == epoch {
		return s.cache
	}
	if s.cache != nil && time.Since(s.builtAt) < timelineRebuildInterval {
		// 刚重建过：分析多半还在跑，先用旧的那份，下一轮再更新。
		return s.cache
	}
	built := s.build(snapshot, epoch)
	s.cache = built
	s.builtAt = time.Now()
	return built
}

// build 按拍摄证据排出全库照片的顺序。
func (s *PhotoTimelineService) build(snapshot CatalogSnapshot, epoch string) *photoTimelineIndex {
	library := snapshot.state.library
	exif := map[string]time.Time{}
	if s.jobs != nil {
		exif = s.jobs.AllCaptureTimes(AIJobTypeMetadata)
	}
	entries := make([]timelineEntry, 0, 1024)
	for _, album := range library.albums {
		if album.ContentKind != string(models.ContentKindPhoto) {
			continue
		}
		media := library.media[album.ID]
		for index := range media {
			at, source := timelineMediaTime(media[index], album, exif)
			entries = append(entries, timelineEntry{
				albumID: album.ID,
				index:   index,
				at:      at,
				source:  source,
				video:   media[index].Kind == "video",
			})
		}
	}
	sortTimelineEntries(entries)
	built := &photoTimelineIndex{epoch: epoch, entries: entries}
	built.years = timelineYearIndex(entries)
	return built
}

// timelineMediaTime 取一个媒体在时间线上的时间与它的来源。
//
// 取时间的顺序就是可信度：EXIF 的拍摄时间 → 文件名里的日期 → 目录名
// 里的日期 → 文件修改时间。前两者与第三项是「拍摄证据」，最后一项不是 ——
// 它只说明文件最后一次被改动的时间。
func timelineMediaTime(item LibraryMediaItem, album LibraryNodeSummary, exif map[string]time.Time) (time.Time, string) {
	if captured, ok := exif[item.ID]; ok && !captured.IsZero() {
		return captured, TimelineDateExif
	}
	if fromName := captureFromFileName(item.Name); !fromName.IsZero() {
		return fromName, TimelineDateFilename
	}
	if !album.Date.IsZero() {
		switch album.DateSource {
		case "filename":
			return album.Date, TimelineDateFilename
		case "folder":
			return album.Date, TimelineDateFolder
		}
	}
	// 没有拍摄证据：退回相册的修改时间（扫描时取的是相册里最新的文件
	// 修改时间）。它不是拍摄时间，来源标成 modified，界面上要照实说。
	if !album.ModTime.IsZero() {
		return album.ModTime, TimelineDateModified
	}
	return time.Time{}, TimelineDateModified
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
		months[int(entry.at.Month())]++
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
		entry := TimelineYear{Year: year}
		for _, month := range keys {
			entry.Months = append(entry.Months, TimelineMonth{Month: month, Count: months[month]})
			entry.Count += months[month]
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
		if f.month > 0 && int(entry.at.Month()) != f.month {
			return false
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
	unknown := 0
	for _, position := range matched {
		entry := index.entries[position]
		sources[entry.source]++
		if entry.source == TimelineDateModified {
			unknown++
		}
	}
	for _, position := range matched[start:end] {
		entry := index.entries[position]
		album, ok := library.nodes[entry.albumID]
		if !ok {
			continue
		}
		media := library.media[entry.albumID]
		if entry.index < 0 || entry.index >= len(media) {
			continue
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
		items = append(items, FeedMediaItem{
			LibraryMediaItem: item,
			AlbumID:          entry.albumID,
			AlbumName:        name,
			CapturedAt:       entry.at.UTC().Format(time.RFC3339),
			DateSource:       entry.source,
		})
	}
	// 年份索引：跳年跳月用。它按媒体类型筛选（照片 / 视频），但不按年份筛 ——
	// 选中年份后还要能换到别的年份。
	years := index.years
	if filter.media != "all" {
		years = timelineYearIndexWhere(index.entries, filter.matchesMedia)
	}

	albums := []FeedAlbumRef{}
	seen := map[string]bool{}
	counts := map[string]int{}
	for _, position := range matched {
		entry := index.entries[position]
		counts[entry.albumID]++
		if seen[entry.albumID] {
			continue
		}
		seen[entry.albumID] = true
		album, ok := library.nodes[entry.albumID]
		if !ok {
			continue
		}
		name := strings.TrimSpace(album.DisplayName)
		if name == "" {
			name = strings.TrimSpace(album.Name)
		}
		albums = append(albums, FeedAlbumRef{
			ID:    entry.albumID,
			Name:  name,
			Count: counts[entry.albumID],
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
		Years:       years,
		Unknown:     unknown,
		DateSources: sources,
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
