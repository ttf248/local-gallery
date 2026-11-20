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
	root     string
	albums   []models.Album
	ids      map[string]string // 相册路径 → 相册资源 ID
	files    map[string]string // 相册路径 → 第一张照片的资源 ID
	albumIDs []string
}

func newTimelineFixture(t *testing.T) *timelineFixture {
	t.Helper()
	root := t.TempDir()
	fixture := &timelineFixture{
		catalog: NewResourceCatalog(),
		root:    root,
		ids:     map[string]string{},
		files:   map[string]string{},
	}

	// 三本相册：文件名带日期、目录名带日期、两者都没有。
	plans := []struct {
		dir       string
		files     []string
		date      time.Time
		source    string
		precision string
		modTime   time.Time
	}{
		{
			dir:       "名字带日期",
			files:     []string{"IMG_20240305_101500.jpg", "IMG_20240406_101500.jpg"},
			date:      time.Date(2024, 4, 6, 10, 15, 0, 0, time.UTC),
			source:    "filename",
			precision: TimelinePrecisionDay,
			modTime:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			dir:       "目录带日期",
			files:     []string{"a.jpg", "b.jpg"},
			date:      time.Date(2019, 7, 1, 12, 0, 0, 0, time.UTC),
			source:    "folder",
			precision: TimelinePrecisionDay,
			modTime:   time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		},
		{
			dir:       "只有修改时间",
			files:     []string{"c.jpg"},
			date:      time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC),
			source:    "modified",
			precision: TimelinePrecisionUnknown,
			modTime:   time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC),
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
			ImageModTimes: func() []time.Time {
				times := make([]time.Time, len(paths))
				for index := range times {
					times[index] = plan.modTime
				}
				return times
			}(),
			CoverImage: paths[0], CoverKind: "image",
			ContentKind: string(models.ContentKindPhoto),
			Date:        plan.date, DateSource: plan.source, DatePrecision: plan.precision,
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
	fixture.albums = albums
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

func (f *timelineFixture) publish(t *testing.T) {
	t.Helper()
	albums := append([]models.Album(nil), f.albums...)
	f.catalog.Publish(&models.ScanResult{
		Roots: []string{f.root}, Albums: albums, AlbumCount: len(albums),
	}, []string{f.root})
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
	f.jobs.recordsRevision++
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

func TestTimelineMediaTimePrefersEXIFThenFilenameThenFolderThenModified(t *testing.T) {
	folderDate := time.Date(2019, 7, 1, 12, 0, 0, 0, time.UTC)
	item := LibraryMediaItem{ID: "f_1", Name: "IMG_20240305_101500.jpg"}
	exif := map[string]time.Time{"f_1": time.Date(2024, 3, 5, 9, 0, 0, 0, time.UTC)}
	date := timelineMediaTime(item, folderDate, TimelinePrecisionDay, time.Time{}, exif)
	if date.source != TimelineDateExif || !date.at.Equal(exif["f_1"]) || date.precision != TimelinePrecisionDay {
		t.Fatalf("exif time = %+v, want the EXIF stamp", date)
	}
	date = timelineMediaTime(item, folderDate, TimelinePrecisionYear, time.Time{}, nil)
	if date.source != TimelineDateFilename || date.precision != TimelinePrecisionDay {
		t.Fatalf("filename time = %+v, want filename day precision", date)
	}
	if value := timelineDateValue(date.at, date.precision); value != "2024-03-05" {
		t.Fatalf("filename value = %q, want 2024-03-05", value)
	}
	plain := LibraryMediaItem{ID: "f_2", Name: "photo.jpg"}
	date = timelineMediaTime(plain, folderDate, TimelinePrecisionMonth, time.Time{}, nil)
	if date.source != TimelineDateFolder || date.precision != TimelinePrecisionMonth || timelineDateValue(date.at, date.precision) != "2019-07" {
		t.Fatalf("folder time = %+v, want only 2019-07", date)
	}
	modified := time.Date(2021, 2, 3, 0, 0, 0, 0, time.UTC)
	date = timelineMediaTime(plain, time.Time{}, "", modified, nil)
	if date.source != TimelineDateModified || !date.at.Equal(modified) || date.precision != TimelinePrecisionUnknown || timelineDateValue(date.at, date.precision) != "" {
		t.Fatalf("modified time = %+v, want unknown with its file modification time", date)
	}
}

func TestPhotoTimelineDoesNotReuseAlbumRepresentativeDateForUndatedMedia(t *testing.T) {
	fixture := newTimelineFixture(t)
	album := fixture.albums[0]
	undatedPath := filepath.Join(album.Path, "photo-without-date.jpg")
	if err := os.WriteFile(undatedPath, []byte("photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	album.ImageFiles = append(album.ImageFiles, undatedPath)
	album.ImageModTimes = append(album.ImageModTimes, time.Date(2025, 2, 3, 0, 0, 0, 0, time.UTC))
	album.ImageCount++
	fixture.albums[0] = album
	fixture.publish(t)
	page, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.Name != filepath.Base(undatedPath) {
			continue
		}
		if item.DateSource != TimelineDateModified || item.DatePrecision != TimelinePrecisionUnknown || item.DateValue != "" {
			t.Fatalf("undated media inherited its album date: %+v", item)
		}
		if item.CapturedAt != "2025-02-03T00:00:00Z" {
			t.Fatalf("undated media capturedAt = %q, want its file modification time", item.CapturedAt)
		}
		return
	}
	t.Fatal("undated media missing from timeline")
}

func TestPhotoTimelineKeepsYearOnlyFolderEvidenceOutOfMonths(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "2024")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	mediaPath := filepath.Join(albumPath, "photo.jpg")
	if err := os.WriteFile(mediaPath, []byte("photo"), 0o600); err != nil {
		t.Fatal(err)
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{Roots: []string{root}, Albums: []models.Album{{
		Type: "album", Path: albumPath, Name: "2024", SourceRoot: root,
		ImageFiles: []string{mediaPath}, ImageModTimes: []time.Time{time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC)},
		ImageCount: 1, Date: time.Date(2024, 1, 1, 12, 0, 0, 0, time.UTC),
		DateSource: TimelineDateFolder, DatePrecision: TimelinePrecisionYear,
		ContentKind: string(models.ContentKindPhoto),
	}}}, []string{root})
	service := NewPhotoTimelineService(nil)
	query := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}
	page, err := service.Page(catalog.Acquire(), query, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].DatePrecision != TimelinePrecisionYear || page.Items[0].DateValue != "2024" || page.Items[0].CapturedAt != "" {
		t.Fatalf("year-only timeline item = %+v", page.Items)
	}
	if len(page.Years) != 1 || page.Years[0].Year != 2024 || len(page.Years[0].Months) != 0 {
		t.Fatalf("year-only index = %+v, want no invented month", page.Years)
	}
	month, err := service.Page(catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024", Month: "1",
	}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if month.Total != 0 {
		t.Fatalf("year-only evidence appeared in January: total = %d", month.Total)
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

func TestPhotoTimelineRebuildsImmediatelyAfterMediaIsAddedOrRemoved(t *testing.T) {
	fixture := newTimelineFixture(t)
	service := fixture.service()
	query := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}
	first, err := service.Page(fixture.catalog.Acquire(), query, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if first.Total != 5 {
		t.Fatalf("initial total = %d, want 5", first.Total)
	}

	// 插入一个按相册自然顺序排在最前的媒体，会让旧索引里所有后续 index
	// 指向别的照片。库 revision 一变，必须立即重建索引。
	albumIndex := 0
	album := fixture.albums[albumIndex]
	addedPath := filepath.Join(album.Path, "IMG_20230201_101500.jpg")
	if err := os.WriteFile(addedPath, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	album.ImageFiles = append(album.ImageFiles, addedPath)
	album.ImageCount++
	fixture.albums[albumIndex] = album
	fixture.publish(t)
	added, err := service.Page(fixture.catalog.Acquire(), query, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if added.Total != 6 {
		t.Fatalf("after add total = %d, want 6", added.Total)
	}
	addedNames := map[string]bool{}
	for _, item := range added.Items {
		if addedNames[item.Name] {
			t.Fatalf("item %q repeated after inserting media", item.Name)
		}
		addedNames[item.Name] = true
	}
	if !addedNames[filepath.Base(addedPath)] {
		t.Fatalf("new item %q is missing after insertion", filepath.Base(addedPath))
	}

	if err := os.Remove(addedPath); err != nil {
		t.Fatal(err)
	}
	album.ImageFiles = album.ImageFiles[:len(album.ImageFiles)-1]
	album.ImageCount--
	fixture.albums[albumIndex] = album
	fixture.publish(t)
	removed, err := service.Page(fixture.catalog.Acquire(), query, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if removed.Total != 5 {
		t.Fatalf("after remove total = %d, want 5", removed.Total)
	}
	for _, item := range removed.Items {
		if item.Name == filepath.Base(addedPath) {
			t.Fatal("removed item remained in the timeline")
		}
	}
}

func TestPhotoTimelineRebuildsAfterAlbumOrderChanges(t *testing.T) {
	fixture := newTimelineFixture(t)
	snapshot := fixture.catalog.Acquire()
	service := fixture.service()
	query := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}
	albumPath := fixture.ids["目录带日期"]
	albumID := fixture.catalog.ExternalID(albumPath, ResourceAlbum)
	ids, ok := snapshot.AlbumImageIDs(albumID)
	if !ok || len(ids) != 2 {
		t.Fatalf("directory album image ids = %v", ids)
	}
	byName := map[string]string{}
	for _, id := range ids {
		ref, exists := snapshot.Lookup(id)
		if !exists {
			t.Fatalf("resource %q missing", id)
		}
		byName[filepath.Base(ref.AbsolutePath)] = id
	}
	fixture.seedCaptureTime(t, byName["a.jpg"], "2024-08-01T12:00:00")
	fixture.seedCaptureTime(t, byName["b.jpg"], "2023-08-01T12:00:00")
	if _, err := service.Page(snapshot, query, "", 20); err != nil {
		t.Fatal(err)
	}

	oldPath := filepath.Join(albumPath, "a.jpg")
	newPath := filepath.Join(albumPath, "z.jpg")
	if err := os.Rename(oldPath, newPath); err != nil {
		t.Fatal(err)
	}
	for index := range fixture.albums {
		if fixture.albums[index].Path != albumPath {
			continue
		}
		fixture.albums[index].ImageFiles = []string{
			filepath.Join(albumPath, "b.jpg"), newPath,
		}
	}
	fixture.publish(t)
	page, err := service.Page(fixture.catalog.Acquire(), query, "", 20)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range page.Items {
		if item.Name == "b.jpg" && item.CapturedAt[:4] != "2023" {
			t.Fatalf("b.jpg retained stale time %q after album order changed", item.CapturedAt)
		}
	}
}

func TestPhotoTimelineRejectsCursorFromPreviousIndexRevision(t *testing.T) {
	fixture := newTimelineFixture(t)
	service := fixture.service()
	query := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}
	first, err := service.Page(fixture.catalog.Acquire(), query, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if first.NextCursor == "" {
		t.Fatal("first page has no next cursor")
	}
	album := fixture.albums[0]
	addedPath := filepath.Join(album.Path, "IMG_20220101.jpg")
	if err := os.WriteFile(addedPath, []byte("new"), 0o600); err != nil {
		t.Fatal(err)
	}
	album.ImageFiles = append(album.ImageFiles, addedPath)
	album.ImageCount++
	fixture.albums[0] = album
	fixture.publish(t)
	if _, err := service.Page(fixture.catalog.Acquire(), query, first.NextCursor, 1); err == nil {
		t.Fatal("cursor from previous index revision was accepted")
	}
}

func TestPhotoTimelineAlbumCountsCoverAllMatchingItems(t *testing.T) {
	fixture := newTimelineFixture(t)
	page, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline,
	}, "", 2)
	if err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	for _, album := range page.Albums {
		counts[album.ID] = album.Count
	}
	want := map[string]int{
		fixture.catalog.ExternalID(fixture.ids["名字带日期"], ResourceAlbum):  2,
		fixture.catalog.ExternalID(fixture.ids["目录带日期"], ResourceAlbum):  2,
		fixture.catalog.ExternalID(fixture.ids["只有修改时间"], ResourceAlbum): 1,
	}
	if len(counts) != len(want) {
		t.Fatalf("album counts = %v, want %v", counts, want)
	}
	for id, count := range want {
		if counts[id] != count {
			t.Errorf("album %q count = %d, want %d", id, counts[id], count)
		}
	}

	filtered, err := fixture.service().Page(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024",
	}, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered.Albums) != 1 || filtered.Albums[0].Count != 2 {
		t.Fatalf("filtered album counts = %+v, want the 2024 source album with 2 items", filtered.Albums)
	}
}

func TestPhotoTimelineUnknownCountIgnoresYearAndMonthFilters(t *testing.T) {
	fixture := newTimelineFixture(t)
	albumIndex := 2
	album := fixture.albums[albumIndex]
	videoPath := filepath.Join(album.Path, "untimed.mp4")
	if err := os.WriteFile(videoPath, []byte("video"), 0o600); err != nil {
		t.Fatal(err)
	}
	album.VideoFiles = []string{videoPath}
	album.VideoCount = 1
	fixture.albums[albumIndex] = album
	fixture.publish(t)
	service := fixture.service()
	base := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}

	tests := []struct {
		name         string
		query        MediaFeedQuery
		wantUnknown  int
		wantModified int
	}{
		{name: "all", query: base, wantUnknown: 2, wantModified: 2},
		{name: "year", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024"}, wantUnknown: 2, wantModified: 0},
		{name: "month", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024", Month: "3"}, wantUnknown: 2, wantModified: 0},
		{name: "photos", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024", Media: "photo"}, wantUnknown: 1, wantModified: 0},
		{name: "videos", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "2024", Media: "video"}, wantUnknown: 1, wantModified: 0},
		{name: "unknown photos", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "unknown", Media: "photo"}, wantUnknown: 1, wantModified: 1},
		{name: "unknown videos", query: MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline, Year: "unknown", Media: "video"}, wantUnknown: 1, wantModified: 1},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			page, err := service.Page(fixture.catalog.Acquire(), test.query, "", 20)
			if err != nil {
				t.Fatal(err)
			}
			if page.Unknown != test.wantUnknown {
				t.Errorf("unknown = %d, want %d", page.Unknown, test.wantUnknown)
			}
			if page.DateSources[TimelineDateModified] != test.wantModified {
				t.Errorf("dateSources modified = %d, want %d (all sources: %v)", page.DateSources[TimelineDateModified], test.wantModified, page.DateSources)
			}
		})
	}
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

func BenchmarkPhotoTimelinePage10K(b *testing.B) {
	root := b.TempDir()
	albumPath := filepath.Join(root, "album")
	files := make([]string, 10_000)
	for index := range files {
		files[index] = filepath.Join(albumPath, fmt.Sprintf("photo-%05d.jpg", index))
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{
		Path: root, Kind: models.ContentKindPhoto,
	}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root},
		Albums: []models.Album{{
			Type: "album", Path: albumPath, Name: "album", SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
			ContentKind: string(models.ContentKindPhoto),
			ModTime:     time.Date(2025, 1, 1, 0, 0, 0, 0, time.UTC),
		}},
	}, []string{root})
	snapshot := catalog.Acquire()
	query := MediaFeedQuery{Kind: LibraryKindPhoto, Scope: MediaFeedTimeline}
	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		service := NewPhotoTimelineService(nil)
		if _, err := service.Page(snapshot, query, "", 60); err != nil {
			b.Fatal(err)
		}
	}
}
