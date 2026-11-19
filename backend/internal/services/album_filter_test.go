package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

// albumFilterFixture 是照片墙筛选的测试夹具：一本相册，几张照片，
// 外加一份可注入的 EXIF 记录与精选集合。
type albumFilterFixture struct {
	catalog *ResourceCatalog
	jobs    *AIJobService
	picks   *store.PickStore
	albumID string
	ids     []string
}

// newAlbumFilterFixture 建一本有 count 张照片的相册。
func newAlbumFilterFixture(t *testing.T, count int) *albumFilterFixture {
	t.Helper()
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	files := make([]string, 0, count)
	for index := 0; index < count; index++ {
		path := filepath.Join(albumPath, fmt.Sprintf("%02d.jpg", index))
		if err := os.WriteFile(path, []byte("photo"), 0o600); err != nil {
			t.Fatal(err)
		}
		files = append(files, path)
	}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindPhoto}}))
	catalog.Publish(&models.ScanResult{
		Roots: []string{root}, AlbumCount: 1,
		Albums: []models.Album{{
			Type: "album", Name: "album", Path: albumPath, SourceRoot: root,
			ImageFiles: files, ImageCount: len(files),
		}},
	}, []string{root})
	albumID := catalog.ExternalID(albumPath, ResourceAlbum)
	ids, ok := catalog.Acquire().AlbumImageIDs(albumID)
	if !ok {
		t.Fatalf("album %s has no images", albumID)
	}
	jobs := newTestAIJobService(t,
		filepath.Join(root, "state", "jobs.json"),
		filepath.Join(root, "derived", "metadata"),
		catalog, MetadataAnalyzer{})
	return &albumFilterFixture{
		catalog: catalog,
		jobs:    jobs,
		picks:   store.NewPickStore(filepath.Join(root, "state", "picks.json")),
		albumID: albumID,
		ids:     ids,
	}
}

// seedCaptureTime 给一张照片写入 EXIF 拍摄时间。
func (f *albumFilterFixture) seedCaptureTime(t *testing.T, resourceID, captured string) {
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

func (f *albumFilterFixture) engine(similarity *SimilarityService) *AlbumFilterEngine {
	return NewAlbumFilterEngine(f.catalog, f.jobs, nil, f.picks, similarity)
}

// pageNames 取出一页里的文件名。
func pageNames(items []LibraryMediaItem) []string {
	names := make([]string, 0, len(items))
	for _, item := range items {
		names = append(names, item.Name)
	}
	return names
}

func TestAlbumFilterWithoutConditionsKeepsEverything(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 3)
	page, err := fixture.engine(nil).Page(fixture.catalog.Acquire(), fixture.albumID, AlbumFilterQuery{}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 3 || len(page.Items) != 3 || page.Filtered {
		t.Fatalf("page=%+v", page)
	}
}

func TestAlbumFilterPicksKeepsOnlyMarkedPhotos(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 3)
	if _, err := fixture.picks.Batch([]string{fixture.ids[1]}, true); err != nil {
		t.Fatal(err)
	}
	snapshot := fixture.catalog.Acquire()

	picked, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{Picks: AlbumFilterPicksOnly}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if picked.Total != 1 || len(picked.Items) != 1 || picked.Items[0].ID != fixture.ids[1] {
		t.Fatalf("picked page=%+v", picked)
	}

	unpicked, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{Picks: AlbumFilterPicksNone}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if unpicked.Total != 2 {
		t.Fatalf("unpicked page=%+v", unpicked)
	}
	for _, item := range unpicked.Items {
		if item.ID == fixture.ids[1] {
			t.Fatalf("picked photo leaked into unpicked page: %+v", unpicked.Items)
		}
	}
}

func TestAlbumFilterCaptureTimeRangeExcludesUnknownTimes(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 3)
	fixture.seedCaptureTime(t, fixture.ids[0], "2024-06-01T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[1], "2024-07-02T10:00:00")
	// 第三张没有分析结果：它没有可信拍摄时间，不该混进时间筛选。
	snapshot := fixture.catalog.Acquire()

	page, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{From: "2024-06", To: "2024-06"}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].ID != fixture.ids[0] {
		t.Fatalf("june page=%+v", page)
	}
	if page.Unresolved.CaptureTime != 1 {
		t.Fatalf("unresolved=%+v", page.Unresolved)
	}

	all, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{From: "2024-01", To: "2024-12"}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if all.Total != 2 {
		t.Fatalf("year page=%+v", all)
	}
}

func TestAlbumFilterCombinesConditionsAndKeepsNaturalOrder(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 4)
	fixture.seedCaptureTime(t, fixture.ids[0], "2024-06-01T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[1], "2024-06-02T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[2], "2024-07-02T10:00:00")
	if _, err := fixture.picks.Batch([]string{fixture.ids[0]}, true); err != nil {
		t.Fatal(err)
	}
	page, err := fixture.engine(nil).Page(fixture.catalog.Acquire(), fixture.albumID, AlbumFilterQuery{
		From: "2024-06", To: "2024-06", Picks: AlbumFilterPicksOnly,
	}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].ID != fixture.ids[0] {
		t.Fatalf("combined page=%+v", page)
	}
}

func TestAlbumFilterCursorIsBoundToConditions(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 4)
	fixture.seedCaptureTime(t, fixture.ids[0], "2024-06-01T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[1], "2024-06-02T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[2], "2024-07-02T10:00:00")
	snapshot := fixture.catalog.Acquire()
	first, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{From: "2024-06", To: "2024-06"}, "", 1)
	if err != nil {
		t.Fatal(err)
	}
	if first.NextCursor == "" {
		t.Fatalf("first page=%+v", first)
	}
	// 换一套条件后，旧游标必须失效：否则下一页会按另一套条件取数据。
	if _, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{}, first.NextCursor, 1); err == nil {
		t.Fatal("cursor survived a condition change")
	}
	second, err := fixture.engine(nil).Page(snapshot, fixture.albumID, AlbumFilterQuery{From: "2024-06", To: "2024-06"}, first.NextCursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	if len(second.Items) != 1 || second.Items[0].ID != fixture.ids[1] {
		t.Fatalf("second page=%+v", second)
	}
}

func TestAlbumFilterCollapseKeepsRepresentativeOnly(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 3)
	similarity := newAlbumFilterSimilarity(t, fixture, []SimilarityGroup{{
		ID:          "g_1",
		Kind:        string(SimilarityGroupKindExact),
		Folder:      "album",
		ResourceIDs: []string{fixture.ids[0], fixture.ids[1]},
		Recommended: fixture.ids[0],
		Members: []SimilarityMember{
			{ResourceID: fixture.ids[0], Folder: "album"},
			{ResourceID: fixture.ids[1], Folder: "album"},
		},
	}})
	page, err := fixture.engine(similarity).Page(fixture.catalog.Acquire(), fixture.albumID, AlbumFilterQuery{Collapse: true}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 2 || len(page.Items) != 2 {
		t.Fatalf("collapsed page=%+v", page)
	}
	if page.Items[0].ID != fixture.ids[0] || page.Items[1].ID != fixture.ids[2] {
		t.Fatalf("collapsed items=%v", pageNames(page.Items))
	}
	if page.Grouped != 1 {
		t.Fatalf("grouped=%d", page.Grouped)
	}
	reference := page.Items[0].Similarity
	if reference == nil || reference.AlbumSize != 2 || reference.AlbumHidden != 1 || reference.Shown != fixture.ids[0] {
		t.Fatalf("similarity ref=%+v", reference)
	}

	// 关掉折叠就回到全部原始照片。
	plain, err := fixture.engine(similarity).Page(fixture.catalog.Acquire(), fixture.albumID, AlbumFilterQuery{}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if plain.Total != 3 {
		t.Fatalf("plain page=%+v", plain)
	}
}

func TestAlbumFilterCollapseKeepsFirstAlbumMemberWhenRepresentativeElsewhere(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 2)
	similarity := newAlbumFilterSimilarity(t, fixture, []SimilarityGroup{{
		ID:          "g_1",
		Kind:        string(SimilarityGroupKindExact),
		Folder:      "album",
		ResourceIDs: []string{fixture.ids[0], fixture.ids[1]},
		// 代表照片不在这一本里：折叠的是这一本里的重复。
		Recommended: "f_elsewhere",
		Members: []SimilarityMember{
			{ResourceID: fixture.ids[0], Folder: "album"},
			{ResourceID: fixture.ids[1], Folder: "album"},
		},
	}})
	page, err := fixture.engine(similarity).Page(fixture.catalog.Acquire(), fixture.albumID, AlbumFilterQuery{Collapse: true}, "", 10)
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 1 || page.Items[0].ID != fixture.ids[0] {
		t.Fatalf("collapsed page=%+v", page)
	}
}

func TestAlbumFilterFacetsReportAvailabilityAndReasons(t *testing.T) {
	fixture := newAlbumFilterFixture(t, 3)
	fixture.seedCaptureTime(t, fixture.ids[0], "2024-06-01T10:00:00")
	fixture.seedCaptureTime(t, fixture.ids[1], "2024-07-02T10:00:00")
	if _, err := fixture.picks.Batch([]string{fixture.ids[0]}, true); err != nil {
		t.Fatal(err)
	}
	facets, err := fixture.engine(nil).Facets(fixture.catalog.Acquire(), fixture.albumID)
	if err != nil {
		t.Fatal(err)
	}
	if facets.Total != 3 || facets.Videos != 0 {
		t.Fatalf("facets=%+v", facets)
	}
	if !facets.Time.Available || len(facets.Time.Months) != 2 || facets.Time.UnresolvedCount != 1 {
		t.Fatalf("time facet=%+v", facets.Time)
	}
	if facets.Time.Months[0].Month != "2024-06" || facets.Time.Months[0].Count != 1 {
		t.Fatalf("time months=%+v", facets.Time.Months)
	}
	if facets.Picks.PickedCount != 1 {
		t.Fatalf("picks facet=%+v", facets.Picks)
	}
	// 还没有人脸分析：人物与合照两个维度要说清为什么不能用。
	if facets.People.Available || facets.People.Reason == "" {
		t.Fatalf("people facet=%+v", facets.People)
	}
	if facets.GroupPhotos.Available || facets.GroupPhotos.Reason == "" {
		t.Fatalf("group photo facet=%+v", facets.GroupPhotos)
	}
	if facets.Places.Available || facets.Places.Reason == "" {
		t.Fatalf("places facet=%+v", facets.Places)
	}
}

// newAlbumFilterSimilarity 用一份写好的分组结果打开相似照片服务。
func newAlbumFilterSimilarity(t *testing.T, fixture *albumFilterFixture, groups []SimilarityGroup) *SimilarityService {
	t.Helper()
	directory := t.TempDir()
	derivedPath := filepath.Join(directory, "groups.json")
	data, err := json.Marshal(similarityGroupsFile{Version: similarityGroupsFileVersion, Groups: groups})
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(derivedPath, data, 0o600); err != nil {
		t.Fatal(err)
	}
	service, err := OpenSimilarityService(SimilarityServiceOptions{
		StatePath:   filepath.Join(directory, "state.json"),
		DerivedPath: derivedPath,
		Catalog:     fixture.catalog,
		Jobs:        fixture.jobs,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(service.Close)
	return service
}
