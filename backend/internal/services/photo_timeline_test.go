package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// timelineFixture 是时间线的测试夹具：几本相册，照片分别来自不同的
// 时间来源 —— EXIF、文件名、目录名与只有修改时间。
type timelineFixture struct {
	catalog  *ResourceCatalog
	jobs     *AIJobService
	ids      map[string]string // 相册路径 → 相册资源 ID
	files    map[string]string // 相册路径 → 第一张照片的资源 ID
	albumIDs []string
}

func newTimelineFixture(t *testing.T) *timelineFixture {
	t.Helper()
	root := t.TempDir()
	fixture := &timelineFixture{
		catalog: NewResourceCatalog(),
		ids:     map[string]string{},
		files:   map[string]string{},
	}

	// 三本相册：文件名带日期、目录名带日期、两者都没有。
	plans := []struct {
		dir     string
		files   []string
		date    time.Time
		source  string
		modTime time.Time
	}{
		{
			dir:     "名字带日期",
			files:   []string{"IMG_20240305_101500.jpg", "IMG_20240406_101500.jpg"},
			date:    time.Date(2024, 4, 6, 10, 15, 0, 0, time.UTC),
			source:  "filename",
			modTime: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			dir:     "目录带日期",
			files:   []string{"a.jpg", "b.jpg"},
			date:    time.Date(2019, 7, 1, 12, 0, 0, 0, time.UTC),
			source:  "folder",
			modTime: time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			dir:     "只有修改时间",
			files:   []string{"c.jpg"},
			date:    time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC),
			source:  "modified",
			modTime: time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC),
		},
	}
	albums := make([]models.Album, 0, len(plans))
	for _, plan := range plans {
		albumPath := filepath.Join(root, plan.dir)
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
		paths := make([]string, 0, len(plan.files))
		for _, name := range plan.files {
			path := filepath.Join(albumPath, name)
			if err := os.WriteFile(path, []byte("photo"), 0o600); err != nil {
				t.Fatal(err)
			}
			paths = append(paths, path)
		}
		albums = append(albums, models.Album{
			Type: "album", Path: albumPath, Name: plan.dir, DisplayName: plan.dir,
			SourceRoot: root, SourceName: filepath.Base(root),
			ImageFiles: paths, ImageCount: len(paths),
			CoverImage: paths[0], CoverKind: "image",
			ContentKind: string(models.ContentKindPhoto),
			Date:        plan.date, DateSource: plan.source,
			ModTime: plan.modTime,
		})
		fixture.ids[plan.dir] = albumPath
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, Albums: albums, AlbumCount: len(albums),
		ScannedAt: time.Date(2025, 2, 2, 0, 0, 0, 0, time.UTC),
	}, []string{root})
	fixture.catalog = catalog
	snapshot := catalog.Acquire()
	for _, album := range albums {
		albumID := catalog.ExternalID(album.Path, ResourceAlbum)
		fixture.albumIDs = append(fixture.albumIDs, albumID)
		ids, ok := snapshot.AlbumImageIDs(albumID)
		if !ok || len(ids) == 0 {
			t.Fatalf("album %s has no images", albumID)
		}
		fixture.files[album.Path] = ids[0]
	}
	fixture.jobs = newTestAIJobService(t,
		filepath.Join(root, "state", "jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog, MetadataAnalyzer{})
	return fixture
}

// seedCaptureTime 给一张照片写入 EXIF 拍摄时间。
func (f *timelineFixture) seedCaptureTime(t *testing.T, resourceID, captured string) {
	t.Helper()
	data, err := json.Marshal(ImageMetadata{Status: MetadataParseParsed, DateTimeOriginal: captured})
	if err != nil {
		t.Fatal(err)
	}
	snapshot := f.catalog.Acquire()
	ref, exists := snapshot.Lookup(resourceID)
	if !exists {
		t.Fatalf("resource %s missing", resourceID)
	}
	info, err := os.Stat(ref.AbsolutePath)
	if err != nil {
		t.Fatal(err)
	}
	f.jobs.mu.Lock()
	defer f.jobs.mu.Unlock()
	f.jobs.records[aiRecordKey(AIJobTypeMetadata, resourceID)] = AIAnalysisRecord{
		Type: AIJobTypeMetadata, ResourceID: resourceID, Size: info.Size(), MTimeNs: info.ModTime().UnixNano(),
		ModuleVersion: MetadataAnalyzer{}.Version(), Status: MetadataParseParsed, Data: data,
	}
}

func (f *timelineFixture) service() *PhotoTimelineService {
	return NewPhotoTimelineService(f.jobs)
}

func TestPhotoTimelineOrdersByCaptureEvidenceAndMarksItsSource(t *testing.T) {
	fixture := newTimelineFixture(t)
	// 「名字带日期」里的第一张有 EXIF：EXIF 优先于文件名。
	exifID := fixture.files[fixture.ids["名字带日期"]]
	fixture.seedCaptureTime(t, exifID, "2024-03-05T09:00:00")

	page, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 5 {
		t.Fatalf("total = %d, want 5", page.Total)
	}
	sources := map[string]string{}
	for _, item := range page.Items {
		sources[item.Name] = item.DateSource
	}
	// 有 EXIF 的那张：来源是 exif。
	if sources["IMG_20240305_101500.jpg"] != TimelineDateExif {
		t.Fatalf("exif item source = %q, want exif", sources["IMG_20240305_101500.jpg"])
	}
	// 同一本里没有 EXIF 的那张：退回文件名推断。
	if sources["IMG_20240406_101500.jpg"] != TimelineDateFilename {
		t.Fatalf("filename item source = %q, want filename", sources["IMG_20240406_101500.jpg"])
	}
	// 目录带日期的那本：来源是 folder。
	if sources["a.jpg"] != TimelineDateFolder {
		t.Fatalf("folder item source = %q, want folder", sources["a.jpg"])
	}
	// 只有修改时间的那张：来源是 modified，排在最后。
	if sources["c.jpg"] != TimelineDateModified {
		t.Fatalf("modified item source = %q, want modified", sources["c.jpg"])
	}
	if last := page.Items[len(page.Items)-1]; last.Name != "c.jpg" {
		t.Fatalf("last item = %q, want the item without capture evidence", last.Name)
	}
	if page.Unknown != 1 {
		t.Fatalf("unknown = %d, want 1", page.Unknown)
	}
}

func TestPhotoTimelineYearIndexSkipsUnknownDates(t *testing.T) {
	fixture := newTimelineFixture(t)
	page, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	years := map[int]int{}
	for _, year := range page.Years {
		years[year.Year] = year.Count
	}
	if years[2024] != 2 {
		t.Fatalf("2024 count = %d, want 2", years[2024])
	}
	if years[2019] != 2 {
		t.Fatalf("2019 count = %d, want 2", years[2019])
	}
	// 只有修改时间的那张不算某一年。
	if _, ok := years[2021]; ok {
		t.Fatalf("years contain 2021 for an item without capture evidence: %+v", page.Years)
	}
}

func TestPhotoTimelineFiltersByYearMonthAndMediaKind(t *testing.T) {
	fixture := newTimelineFixture(t)
	snapshot := fixture.catalog.Acquire()
	service := fixture.service()

	year, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024",
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if year.Total != 2 {
		t.Fatalf("year filter total = %d, want the two 2024 files", year.Total)
	}
	for _, item := range year.Items {
		if item.Name != "IMG_20240305_101500.jpg" && item.Name != "IMG_20240406_101500.jpg" {
			t.Fatalf("year filter kept %q, want only the 2024 files", item.Name)
		}
	}
	month, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2019", Month: "7",
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if month.Total != 2 {
		t.Fatalf("month filter total = %d, want 2", month.Total)
	}
	photos, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Media: "photo",
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if photos.Total != 5 {
		t.Fatalf("photo filter total = %d, want 5", photos.Total)
	}
	videos, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Media: "video",
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if videos.Total != 0 {
		t.Fatalf("video filter total = %d, want 0", videos.Total)
	}
	// 月份没有年份就没有意义。
	if _, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Month: "7",
	}, "", 20); err == nil {
		t.Fatal("month without year should be rejected")
	}
}

func TestPhotoTimelineCursorWalksTheWholeTimeline(t *testing.T) {
	fixture := newTimelineFixture(t)
	snapshot := fixture.catalog.Acquire()
	service := fixture.service()
	seen := map[string]bool{}
	cursor := ""
	for page := 0; page < 10; page++ {
		result, err := service.Page(snapshot, MediaFeedQuery{
			Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
		}, cursor, 2)
		if err != nil {
			t.Fatal(err)
		}
		for _, item := range result.Items {
			if seen[item.Name] {
				t.Fatalf("item %q repeated across pages", item.Name)
			}
			seen[item.Name] = true
		}
		cursor = result.NextCursor
		if cursor == "" {
			break
		}
	}
	if len(seen) != 5 {
		t.Fatalf("paged items = %d, want 5", len(seen))
	}
}

func TestPhotoTimelineEmptyLibraryAnswersWithoutItems(t *testing.T) {
	root := t.TempDir()
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{
		{Path: root, Kind: models.ContentKindPhoto},
	}))
	catalog.Publish(&models.ScanResult{Roots: []string{root}}, []string{root})
	service := NewPhotoTimelineService(nil)
	page, err := service.Page(catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("empty library page = %+v, want no items", page)
	}
	if len(page.Years) != 0 {
		t.Fatalf("empty library years = %+v, want none", page.Years)
	}
}

func TestTimelineMediaTimePrefersEXIFOverFileName(t *testing.T) {
	album := LibraryNodeSummary{Date: time.Date(2019, 7, 1, 12, 0, 0, 0, time.UTC), DateSource: "folder"}
	item := LibraryMediaItem{ID: "f_1", Name: "IMG_20240305_101500.jpg"}
	exif := map[string]time.Time{"f_1": time.Date(2024, 3, 5, 9, 0, 0, 0, time.UTC)}
	at, source := timelineMediaTime(item, album, exif)
	if source != TimelineDateExif || !at.Equal(exif["f_1"]) {
		t.Fatalf("exif time = %v/%q, want the EXIF stamp", at, source)
	}
	at, source = timelineMediaTime(item, album, nil)
	if source != TimelineDateFilename {
		t.Fatalf("filename time source = %q, want filename", source)
	}
	if at.Year() != 2024 || at.Month() != time.March {
		t.Fatalf("filename time = %v, want 2024-03", at)
	}
	plain := LibraryMediaItem{ID: "f_2", Name: "photo.jpg"}
	at, source = timelineMediaTime(plain, album, nil)
	if source != TimelineDateFolder || !at.Equal(album.Date) {
		t.Fatalf("folder time = %v/%q, want the album date", at, source)
	}
	noDate := LibraryNodeSummary{ModTime: time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC)}
	at, source = timelineMediaTime(plain, noDate, nil)
	if source != TimelineDateModified || !at.Equal(noDate.ModTime) {
		t.Fatalf("modified time = %v/%q, want the album mod time", at, source)
	}
}

func TestTimelineYearIndexCountsMonths(t *testing.T) {
	entries := []timelineEntry{
		{at: time.Date(2024, 3, 5, 0, 0, 0, 0, time.UTC), source: TimelineDateExif},
		{at: time.Date(2024, 3, 6, 0, 0, 0, 0, time.UTC), source: TimelineDateFilename},
		{at: time.Date(2024, 5, 1, 0, 0, 0, 0, time.UTC), source: TimelineDateFolder},
		{at: time.Date(2021, 1, 1, 0, 0, 0, 0, time.UTC), source: TimelineDateModified},
	}
	years := timelineYearIndex(entries)
	if len(years) != 1 {
		t.Fatalf("years = %+v, want one year", years)
	}
	if years[0].Year != 2024 || years[0].Count != 3 {
		t.Fatalf("year = %+v, want 2024 with 3 items", years[0])
	}
	if len(years[0].Months) != 2 || years[0].Months[0].Month != 5 {
		t.Fatalf("months = %+v, want March and May", years[0].Months)
	}
}

func TestTimelineFilterScopeKeySeparatesFilters(t *testing.T) {
	base := timelineFilter{year: 2024, month: 3, media: "photo"}
	if base.scopeKey() == (timelineFilter{year: 2024, month: 0, media: "photo"}).scopeKey() {
		t.Fatal("month must change the cursor scope")
	}
	if base.scopeKey() == (timelineFilter{year: 2024, month: 3, media: "video"}).scopeKey() {
		t.Fatal("media kind must change the cursor scope")
	}
}

func TestPhotoTimelineRejectsInvalidFilters(t *testing.T) {
	fixture := newTimelineFixture(t)
	service := fixture.service()
	snapshot := fixture.catalog.Acquire()
	for _, query := range []MediaFeedQuery{
		{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "abcd"},
		{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "1800"},
		{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Month: "13", Year: "2024"},
		{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Media: "audio"},
	} {
		if _, err := service.Page(snapshot, query, "", 20); err == nil {
			t.Fatalf("query %+v should be rejected", query)
		}
	}
}

func TestPhotoTimelineReportsSourceAlbumForEveryItem(t *testing.T) {
	fixture := newTimelineFixture(t)
	page, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.AlbumID == "" || item.AlbumName == "" {
			t.Fatalf("timeline item misses its source album: %+v", item)
		}
		if item.CapturedAt == "" || item.DateSource == "" {
			t.Fatalf("timeline item misses its date: %+v", item)
		}
	}
	if len(page.Albums) != 3 {
		t.Fatalf("albums = %d, want 3", len(page.Albums))
	}
}

func TestPhotoTimelineRebuildsWhenTheLibraryChanges(t *testing.T) {
	fixture := newTimelineFixture(t)
	service := fixture.service()
	snapshot := fixture.catalog.Acquire()
	first, err := service.Page(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 5 {
		t.Fatalf("total = %d, want 5", first.Total)
	}
	// 换一个库版本：时间线要跟着重建。
	other := fixture.catalog.Acquire()
	other.Revision()
	service.index(fixture.catalog.Acquire())
	second, err := service.Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if second.Total != first.Total {
		t.Fatalf("total changed without a library change: %d → %d", first.Total, second.Total)
	}
	_ = fmt.Sprint(other)
}

// 只看视频时，年份索引的数量也要是视频的数量。
//
// 界面上跳年跳月按的是眼下这一段筛选结果的数量：照片的数量摆在视频的
// 筛选下，用户会以为这一年有那么多视频。
func TestTimelineYearIndexFollowsTheMediaFilter(t *testing.T) {
	entries := []timelineEntry{
		{at: time.Date(2024, 3, 5, 0, 0, 0, 0, time.UTC), source: TimelineDateExif},
		{at: time.Date(2024, 3, 6, 0, 0, 0, 0, time.UTC), source: TimelineDateExif, video: true},
		{at: time.Date(2023, 5, 1, 0, 0, 0, 0, time.UTC), source: TimelineDateExif, video: true},
	}
	all := timelineYearIndex(entries)
	if len(all) != 2 || all[0].Year != 2024 || all[0].Count != 2 {
		t.Fatalf("years = %+v, want 2024 with 2 items", all)
	}
	videos := timelineYearIndexWhere(entries, timelineFilter{media: "video"}.matchesMedia)
	if len(videos) != 2 {
		t.Fatalf("video years = %+v, want two years", videos)
	}
	if videos[0].Year != 2024 || videos[0].Count != 1 {
		t.Fatalf("video years = %+v, want 2024 with 1 item", videos)
	}
	if videos[0].Months[0].Count != 1 {
		t.Fatalf("video months = %+v, want one item in March", videos[0].Months)
	}
}
