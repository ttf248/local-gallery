package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestSmartAlbumRecommendationsSkipNearParentSmallAlbum(t *testing.T) {
	media, metadata, vectors := recommendationFixture(16, time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC), 1)
	members := recommendationIDs(media, 0, len(media))
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "time-one", "2025年6月18日", members),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "place-one", "杭州市 · 西湖区", members),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "scene-one", "建议 · 家庭聚会", members),
		},
	}

	groups := buildSmartAlbumRecommendations("a_test", "家庭聚会", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 0 {
		t.Fatalf("near-parent recommendation added no value for a 16-photo album: %+v", groups)
	}
	again := buildSmartAlbumRecommendations("a_test", "家庭聚会", media, details, metadata, vectors)
	t.Logf("synthetic stability: stable_ids=%t", reflect.DeepEqual(groups, again))
	if !reflect.DeepEqual(groups, again) {
		t.Fatalf("recommendation IDs or ordering changed between identical builds: first=%+v second=%+v", groups, again)
	}
}

func TestSmartAlbumRecommendationsDoNotPromoteSimilarPhotosAlone(t *testing.T) {
	media, metadata, vectors := recommendationFixture(
		100, time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC), 1,
	)
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionScene: {
			recommendationGroup(
				SmartAlbumDimensionScene, "similar-only", "建议 · 蓝天", recommendationIDs(media, 0, 24),
			),
		},
	}
	groups := buildSmartAlbumRecommendations("a_similar", "照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 0 {
		t.Fatalf("a similar-photo cluster without independent context became a theme: %+v", groups)
	}
}

func TestSmartAlbumRecommendationsSkipCandidatesBelowQualityFloor(t *testing.T) {
	media, metadata, vectors := recommendationFixture(
		100, time.Date(2025, 6, 18, 10, 0, 0, 0, time.UTC), 1,
	)
	members := recommendationIDs(media, 0, 12)
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "low-score-time", "2025年6月18日", members),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "low-score-scene", "建议 · 蓝天", members),
		},
	}
	groups := buildSmartAlbumRecommendations("a_low_score", "照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 0 {
		t.Fatalf("low-scoring candidate passed the %.2f quality floor: %+v", smartRecommendationMinimumQualityScore, groups)
	}
}

func TestSmartAlbumRecommendationsMergeRelatedDaysIntoOneEvent(t *testing.T) {
	base := time.Date(2025, 7, 1, 9, 0, 0, 0, time.UTC)
	media, metadata, vectors := recommendationFixture(100, base, 1)
	first := recommendationIDs(media, 0, 50)
	second := recommendationIDs(media, 50, 50)
	all := recommendationIDs(media, 0, len(media))
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "time-day-one", "2025年7月1日", first),
			recommendationGroup(SmartAlbumDimensionTime, "time-day-two", "2025年7月2日", second),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "place-trip", "杭州市 · 西湖区", all),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "scene-trip", "建议 · 城市旅行", all),
		},
		SmartAlbumDimensionPeople: {
			recommendationGroup(SmartAlbumDimensionPeople, "people-trip", "人物 1", all),
		},
	}

	groups := buildSmartAlbumRecommendations("a_trip", "照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 1 || groups[0].PhotoCount != 100 {
		t.Fatalf("cross-day event split into multiple recommendations: %+v", groups)
	}
	if groups[0].Name != "城市旅行 · 杭州市 · 西湖区" {
		t.Fatalf("recommendation name=%q, want scene and place evidence", groups[0].Name)
	}
	duplicate := buildSmartAlbumRecommendations("a_trip", groups[0].Name, media, details, metadata, vectors)
	if len(duplicate) != 0 {
		t.Fatalf("recommendation duplicated its already descriptive parent folder: %+v", duplicate)
	}
}

func TestSmartAlbumRecommendationsHighlightRepresentativeGroupPhotos(t *testing.T) {
	media, metadata, vectors := recommendationFixture(
		100, time.Date(2025, 7, 1, 9, 0, 0, 0, time.UTC), 1,
	)
	members := recommendationIDs(media, 0, 36)
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "people-time", "2025年7月1日", members),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "people-place", "杭州市 · 西湖区", members),
		},
		SmartAlbumDimensionPeople: {
			recommendationGroup(SmartAlbumDimensionPeople, "people-group", "人物 1", members),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "people-scene", "建议 · 家庭聚会", members),
		},
	}
	groups := buildSmartAlbumRecommendations("a_people", "家庭照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 1 || groups[0].PhotoCount != len(members) ||
		!containsSmartDimension(groups[0].EvidenceDimensions, SmartAlbumDimensionPeople) ||
		!strings.Contains(groups[0].Name, "合影") {
		t.Fatalf("representative group photos were not surfaced with people evidence: %+v", groups)
	}
}

func TestSmartAlbumRecommendationsLimitPeopleThemesPerAlbum(t *testing.T) {
	base := time.Date(2025, 7, 1, 9, 0, 0, 0, time.UTC)
	media, metadata, vectors := recommendationFixture(100, base, 1)
	first := recommendationIDs(media, 0, 30)
	second := recommendationIDs(media, 30, 30)
	for _, id := range second {
		record := metadata[id]
		var parsed ImageMetadata
		if err := json.Unmarshal(record.Data, &parsed); err != nil {
			t.Fatal(err)
		}
		parsed.DateTimeOriginal = base.Add(24 * time.Hour).Format(time.RFC3339Nano)
		record.Data, _ = json.Marshal(parsed)
		metadata[id] = record
	}
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "two-days-first", "2025年7月1日", first),
			recommendationGroup(SmartAlbumDimensionTime, "two-days-second", "2025年7月2日", second),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "two-places-first", "杭州市", first),
			recommendationGroup(SmartAlbumDimensionPlace, "two-places-second", "上海市", second),
		},
		SmartAlbumDimensionPeople: {
			recommendationGroup(SmartAlbumDimensionPeople, "two-people-first", "人物 1", first),
			recommendationGroup(SmartAlbumDimensionPeople, "two-people-second", "人物 2", second),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "two-scenes-first", "建议 · 家庭聚会", first),
			recommendationGroup(SmartAlbumDimensionScene, "two-scenes-second", "建议 · 户外活动", second),
		},
	}
	groups := buildSmartAlbumRecommendations("a_people_limit", "周末照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	peopleThemes := 0
	for _, group := range groups {
		if strings.Contains(group.Name, "合影") {
			peopleThemes++
		}
	}
	if peopleThemes > 1 {
		t.Fatalf("people themes=%d, want at most one representative theme: %+v", peopleThemes, groups)
	}
}

func TestSmartAlbumRecommendationsUsePartialMetadataAndAIIndexes(t *testing.T) {
	media, metadata, vectors := recommendationFixture(
		100, time.Date(2025, 9, 1, 9, 0, 0, 0, time.UTC), 1,
	)
	placeTimeMembers := recommendationIDs(media, 0, 24)
	sceneMembers := recommendationIDs(media, 0, 12)
	for index, id := range recommendationIDs(media, 0, len(media)) {
		if index >= len(placeTimeMembers) {
			delete(metadata, id)
		}
	}
	for _, id := range placeTimeMembers {
		record := metadata[id]
		var parsed ImageMetadata
		if err := json.Unmarshal(record.Data, &parsed); err != nil {
			t.Fatal(err)
		}
		parsed.GPS = &GPSMetadata{Latitude: 30.259242, Longitude: 120.130396, MapDatum: "GCJ-02"}
		record.Data, _ = json.Marshal(parsed)
		metadata[id] = record
	}
	partialVectors := append([]smartSceneVector(nil), vectors[:12]...)
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "partial-time", "2025年9月1日", placeTimeMembers),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "partial-place", "杭州市 · 西湖区", placeTimeMembers),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "partial-scene", "建议 · 家庭聚会", sceneMembers),
		},
	}
	groups := buildSmartAlbumRecommendations("a_partial", "照片", media, details, metadata, partialVectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 1 || groups[0].PhotoCount != len(placeTimeMembers) {
		t.Fatalf("strong EXIF/GPS evidence was lost with partial indexes: %+v", groups)
	}
	if groups := buildSmartAlbumRecommendations("a_unindexed", "照片", media,
		map[string][]SmartAlbumGroup{}, nil, nil); len(groups) != 0 {
		t.Fatalf("folder without EXIF, GPS, or AI evidence produced recommendations: %+v", groups)
	}
}

func TestSmartAlbumRecommendationIDSurvivesNewMembers(t *testing.T) {
	base := time.Date(2025, 10, 1, 9, 0, 0, 0, time.UTC)
	media, metadata, vectors := recommendationFixture(40, base, 1)
	all := recommendationIDs(media, 0, len(media))
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "stable-time", "2025年10月1日", all),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "stable-place", "杭州市", all),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "stable-scene", "建议 · 出游", all),
		},
	}
	first := buildSmartAlbumRecommendations("a_stable", "照片", media, details, metadata, vectors)
	if len(first) != 1 {
		t.Fatalf("initial recommendation=%+v, want one topic", first)
	}

	newID := "f_new"
	media = append(media, smartAlbumMedia{id: newID, version: "v1"})
	newMetadata, _ := json.Marshal(ImageMetadata{DateTimeOriginal: base.Format(time.RFC3339Nano)})
	metadata[newID] = AIAnalysisRecord{Status: MetadataParseParsed, Data: newMetadata}
	newVector := make([]float32, AIEmbeddingDimension)
	newVector[0] = 1
	vectors = append(vectors, smartSceneVector{id: newID, vector: newVector})
	for dimension, groups := range details {
		groups[0].Members = append(groups[0].Members, newID)
		groups[0].PhotoCount++
		details[dimension] = groups
	}
	second := buildSmartAlbumRecommendations("a_stable", "照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), second)
	if len(second) != 1 || second[0].ID != first[0].ID || second[0].PhotoCount != len(media) {
		t.Fatalf("recommendation identity did not survive a new member: before=%+v after=%+v", first, second)
	}
}

func TestSmartAlbumRecommendationsKeepThreeDayTripAsOneTheme(t *testing.T) {
	base := time.Date(2025, 7, 1, 9, 0, 0, 0, time.UTC)
	media, metadata, vectors := recommendationFixture(300, base, 1)
	for index, item := range media {
		record := metadata[item.id]
		var parsed ImageMetadata
		if err := json.Unmarshal(record.Data, &parsed); err != nil {
			t.Fatal(err)
		}
		parsed.DateTimeOriginal = base.Add(time.Duration(index/100) * 24 * time.Hour).Format(time.RFC3339Nano)
		record.Data, _ = json.Marshal(parsed)
		metadata[item.id] = record
	}
	all := recommendationIDs(media, 0, len(media))
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "trip-day-one", "2025年7月1日", recommendationIDs(media, 0, 100)),
			recommendationGroup(SmartAlbumDimensionTime, "trip-day-two", "2025年7月2日", recommendationIDs(media, 100, 100)),
			recommendationGroup(SmartAlbumDimensionTime, "trip-day-three", "2025年7月3日", recommendationIDs(media, 200, 100)),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "trip-city-one", "杭州市 · 西湖区", recommendationIDs(media, 0, 100)),
			recommendationGroup(SmartAlbumDimensionPlace, "trip-city-two", "上海市", recommendationIDs(media, 100, 100)),
			recommendationGroup(SmartAlbumDimensionPlace, "trip-city-three", "苏州市", recommendationIDs(media, 200, 100)),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "trip-scene", "建议 · 江南旅行", all),
		},
		SmartAlbumDimensionPeople: {
			recommendationGroup(SmartAlbumDimensionPeople, "trip-companion", "人物 1", all),
		},
	}

	groups := buildSmartAlbumRecommendations("a_three_day_trip", "相机", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) != 1 || groups[0].PhotoCount != 300 {
		t.Fatalf("three-day trip was split into multiple topics: %+v", groups)
	}
	if !containsSmartDimension(groups[0].EvidenceDimensions, SmartAlbumDimensionPeople) ||
		!containsSmartDimension(groups[0].EvidenceDimensions, SmartAlbumDimensionScene) {
		t.Fatalf("trip recommendation does not explain its cross-day evidence: %+v", groups[0])
	}
}

func TestSmartAlbumRecommendationsSelectDistinctThemesFromMixedAlbum(t *testing.T) {
	media, metadata, vectors := recommendationFixture(1000, time.Date(2025, 8, 1, 9, 0, 0, 0, time.UTC), 5)
	details := make(map[string][]SmartAlbumGroup)
	for theme := 0; theme < 5; theme++ {
		start := theme * 200
		members := recommendationIDs(media, start, 200)
		day := time.Date(2025, 8, theme+1, 9, 0, 0, 0, time.UTC)
		details[SmartAlbumDimensionTime] = append(details[SmartAlbumDimensionTime], recommendationGroup(
			SmartAlbumDimensionTime, fmt.Sprintf("time-%d", theme), day.Format("2006年1月2日"), members,
		))
		details[SmartAlbumDimensionPlace] = append(details[SmartAlbumDimensionPlace], recommendationGroup(
			SmartAlbumDimensionPlace, fmt.Sprintf("place-%d", theme), fmt.Sprintf("地点 %d", theme+1), members,
		))
		details[SmartAlbumDimensionScene] = append(details[SmartAlbumDimensionScene], recommendationGroup(
			SmartAlbumDimensionScene, fmt.Sprintf("scene-%d", theme), fmt.Sprintf("建议 · 主题 %d", theme+1), members,
		))
	}

	groups := buildSmartAlbumRecommendations("a_mixed", "照片", media, details, metadata, vectors)
	logSmartAlbumRecommendationMetrics(t, len(media), groups)
	if len(groups) < 3 || len(groups) > 8 {
		t.Fatalf("mixed album produced %d recommendations, want 3–8: %+v", len(groups), groups)
	}
	seen := make(map[string]struct{})
	covered := make(map[string]struct{})
	for _, group := range groups {
		if group.PhotoCount < 100 || group.QualityScore < 0.52 {
			t.Fatalf("low-quality group reached recommendations: %+v", group)
		}
		if _, exists := seen[group.Name]; exists {
			t.Fatalf("duplicate recommendation name %q", group.Name)
		}
		seen[group.Name] = struct{}{}
		for _, id := range group.Members {
			covered[id] = struct{}{}
		}
	}
	if len(covered) < 600 {
		t.Fatalf("recommendations cover %d of 1000 synthetic photos, want at least 600", len(covered))
	}
}

func TestSmartAlbumRecommendationsSkipThinOrUnverifiableEvidence(t *testing.T) {
	media, metadata, vectors := recommendationFixture(20, time.Date(2025, 9, 1, 9, 0, 0, 0, time.UTC), 0)
	details := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "generic-scene", "相似场景 01", recommendationIDs(media, 0, 4)),
		},
		SmartAlbumDimensionPeople: {
			recommendationGroup(SmartAlbumDimensionPeople, "person-only", "人物 2", recommendationIDs(media, 4, 10)),
		},
	}
	if groups := buildSmartAlbumRecommendations("a_sparse", "相册", media, details, metadata, vectors); len(groups) != 0 {
		t.Fatalf("weak, generic evidence became a recommendation: %+v", groups)
	}

	smallMedia, smallMetadata, smallVectors := recommendationFixture(
		20, time.Date(2025, 9, 1, 9, 0, 0, 0, time.UTC), 1,
	)
	smallMembers := recommendationIDs(smallMedia, 0, 10)
	smallDetails := map[string][]SmartAlbumGroup{
		SmartAlbumDimensionTime: {
			recommendationGroup(SmartAlbumDimensionTime, "small-time", "2025年9月1日", smallMembers),
		},
		SmartAlbumDimensionPlace: {
			recommendationGroup(SmartAlbumDimensionPlace, "small-place", "杭州市", smallMembers),
		},
		SmartAlbumDimensionScene: {
			recommendationGroup(SmartAlbumDimensionScene, "small-scene", "建议 · 家庭聚会", smallMembers),
		},
	}
	if groups := buildSmartAlbumRecommendations(
		"a_small_group", "照片", smallMedia, smallDetails, smallMetadata, smallVectors,
	); len(groups) != 0 {
		t.Fatalf("10-photo recommendation was not suppressed: %+v", groups)
	}

	delete(details, SmartAlbumDimensionPeople)
	details[SmartAlbumDimensionScene] = []SmartAlbumGroup{
		recommendationGroup(SmartAlbumDimensionScene, "scene-no-vectors", "建议 · 家庭日常", recommendationIDs(media, 0, 12)),
	}
	if groups := buildSmartAlbumRecommendations("a_missing", "相册", media, details, metadata, nil); len(groups) != 0 {
		t.Fatalf("scene-only recommendation without vectors was not withheld: %+v", groups)
	}
}

func TestSmartAlbumRecommendationCacheTracksParentName(t *testing.T) {
	service := &SmartAlbumService{}
	status := AIJobModule{Version: "test-v1"}
	first := service.analysisFingerprint(
		SmartAlbumDimensionRecommended, "Camera", nil, nil, nil, nil, status, status, status,
	)
	second := service.analysisFingerprint(
		SmartAlbumDimensionRecommended, "Family trip", nil, nil, nil, nil, status, status, status,
	)
	if first == second {
		t.Fatal("recommendation cache fingerprint ignored a source folder rename")
	}
}

func TestSmartAlbumInputAlbumNameUsesVirtualFolderLocation(t *testing.T) {
	name := smartAlbumInputAlbumName(LibraryNodeSummary{
		Name: "本目录媒体", DisplayName: "本目录媒体", Virtual: true,
		Location: "2025/杭州旅行",
	})
	if name != "2025/杭州旅行" {
		t.Fatalf("virtual album name=%q, want its source folder location", name)
	}
}

func TestSmartAlbumRecommendedCacheAndUserCorrectionsSurviveRefreshAndRestore(t *testing.T) {
	service, albumID := newSmartSceneBenchmarkService(t, 40)
	snapshot := service.catalog.Acquire()
	seedMetadataRecords(t, service.jobs, snapshot, albumID, "2025-06-18T10:00:00")
	ids, ok := snapshot.AlbumImageIDs(albumID)
	if !ok {
		t.Fatalf("album %s has no image IDs", albumID)
	}
	vector := make([]float32, AIEmbeddingDimension)
	vector[0] = 1
	vectorInputs := make([]VectorInput, len(ids))
	for index, id := range ids {
		ref, exists := snapshot.Lookup(id)
		if !exists {
			t.Fatalf("resource %s disappeared from the test catalog", id)
		}
		info, err := os.Stat(ref.AbsolutePath)
		if err != nil {
			t.Fatal(err)
		}
		vectorInputs[index] = VectorInput{
			ResourceID: id, Size: info.Size(), MTimeNs: info.ModTime().UnixNano(), Vector: vector,
		}
	}
	if err := service.vectors.Commit(context.Background(), vectorInputs); err != nil {
		t.Fatal(err)
	}
	service.jobs.mu.Lock()
	for _, id := range ids {
		record := service.jobs.records[aiRecordKey(AIJobTypeMetadata, id)]
		var metadata ImageMetadata
		if err := json.Unmarshal(record.Data, &metadata); err != nil {
			service.jobs.mu.Unlock()
			t.Fatal(err)
		}
		metadata.GPS = &GPSMetadata{Latitude: 30.259242, Longitude: 120.130396, MapDatum: "GCJ-02"}
		record.Data, _ = json.Marshal(metadata)
		service.jobs.records[aiRecordKey(AIJobTypeMetadata, id)] = record
	}
	service.jobs.mu.Unlock()

	first, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionRecommended, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Groups) != 1 || len(first.Groups[0].EvidenceDimensions) < 2 ||
		first.Groups[0].QualityScore < smartRecommendationMinimumQualityScore {
		t.Fatalf("folder evidence did not produce one explained recommendation: %+v", first)
	}
	cached, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionRecommended, false)
	if err != nil || !cached.CacheHit || cached.Groups[0].ID != first.Groups[0].ID {
		t.Fatalf("recommendation cache was not reused: summary=%+v err=%v", cached, err)
	}
	featured, err := service.DirectoryPage(context.Background(), "featured", "", 6, "")
	if err != nil || featured.Total != 1 || len(featured.Items) != 1 ||
		featured.Items[0].Group.ID != first.Groups[0].ID {
		t.Fatalf("featured directory did not return the curated recommendation: page=%+v err=%v", featured, err)
	}

	name := "湖边出游"
	hidden := true
	updated, err := service.UpdateOverride(
		context.Background(), albumID, SmartAlbumDimensionRecommended, first.Groups[0].ID, &name, &hidden,
	)
	if err != nil || len(updated.Groups) != 1 || updated.Groups[0].Name != name || !updated.Groups[0].Hidden {
		t.Fatalf("manual recommendation correction failed: summary=%+v err=%v", updated, err)
	}
	rebuilt, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionRecommended, true)
	if err != nil || len(rebuilt.Groups) != 1 || rebuilt.Groups[0].ID != first.Groups[0].ID ||
		rebuilt.Groups[0].Name != name || !rebuilt.Groups[0].Hidden {
		t.Fatalf("manual correction did not survive a forced rebuild: summary=%+v err=%v", rebuilt, err)
	}

	backup := service.Corrections()
	if err := service.ReplaceCorrections(SmartAlbumCorrections{
		Version: smartAlbumStateVersion, Overrides: map[string]SmartAlbumOverride{},
	}); err != nil {
		t.Fatal(err)
	}
	visible, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionRecommended, false)
	if err != nil || visible.Groups[0].Hidden {
		t.Fatalf("cleared corrections remained applied: summary=%+v err=%v", visible, err)
	}
	if err := service.ReplaceCorrections(backup); err != nil {
		t.Fatal(err)
	}
	restored, err := service.Groups(context.Background(), albumID, SmartAlbumDimensionRecommended, false)
	if err != nil || restored.Groups[0].Name != name || !restored.Groups[0].Hidden {
		t.Fatalf("backup corrections did not restore the recommendation: summary=%+v err=%v", restored, err)
	}
	visibleDirectory, err := service.DirectoryPage(context.Background(), "featured", "", 6, "")
	if err != nil || visibleDirectory.Total != 0 || len(visibleDirectory.Items) != 0 {
		t.Fatalf("hidden recommendation remained in the featured directory: page=%+v err=%v", visibleDirectory, err)
	}
}

func TestSmartAlbumOverrideMigrationPreservesSingleMatchAndSurfacesConflicts(t *testing.T) {
	service := &SmartAlbumService{
		statePath: filepath.Join(t.TempDir(), "smart-albums.json"),
		state: smartAlbumState{
			Version:   smartAlbumStateVersion,
			Overrides: map[string]SmartAlbumOverride{},
		},
	}
	albumID := "a_test"
	oldID := "sg_11111111111111111111"
	newID := "sg_22222222222222222222"
	firstMembers := []string{"a", "b", "c", "d", "e", "f", "g", "h"}
	mergedMembers := append(append([]string(nil), firstMembers...), "i", "j")
	service.state.Overrides[smartOverrideKey(albumID, SmartAlbumDimensionRecommended, oldID)] = SmartAlbumOverride{
		Name: "家人出游", Hidden: true,
	}
	groups, migration, err := service.migrateSmartAlbumOverrides(albumID, SmartAlbumDimensionRecommended,
		[]smartAlbumCachedGroup{{ID: oldID, Members: firstMembers}},
		[]SmartAlbumGroup{{ID: newID, Dimension: SmartAlbumDimensionRecommended, Members: mergedMembers}},
	)
	if err != nil || len(groups) != 1 || groups[0].OverrideConflict {
		t.Fatalf("unambiguous override migration failed: groups=%+v err=%v", groups, err)
	}
	// 迁移分两步：先写下新键，旧键等缓存落盘之后才删。
	if _, exists := service.state.Overrides[smartOverrideKey(albumID, SmartAlbumDimensionRecommended, newID)]; !exists {
		t.Fatal("migrated override key was not written")
	}
	if _, exists := service.state.Overrides[smartOverrideKey(albumID, SmartAlbumDimensionRecommended, oldID)]; !exists {
		t.Fatal("old override key was removed before the cache was persisted")
	}
	if err := service.commitSmartAlbumOverrideMigration(migration); err != nil {
		t.Fatalf("commitSmartAlbumOverrideMigration() error = %v", err)
	}
	if _, exists := service.state.Overrides[smartOverrideKey(albumID, SmartAlbumDimensionRecommended, oldID)]; exists {
		t.Fatal("old override key remained after an unambiguous migration")
	}
	updated := service.applyOverrides(albumID, SmartAlbumDimensionRecommended, groups)
	if updated[0].Name != "家人出游" || !updated[0].Hidden {
		t.Fatalf("migrated override was not applied: %+v", updated[0])
	}

	service.state.Overrides = map[string]SmartAlbumOverride{
		smartOverrideKey(albumID, SmartAlbumDimensionRecommended, oldID): {Name: "春日旅行"},
		smartOverrideKey(albumID, SmartAlbumDimensionRecommended, newID): {Name: "家人聚会", Hidden: true},
	}
	conflicted, _, err := service.migrateSmartAlbumOverrides(albumID, SmartAlbumDimensionRecommended,
		[]smartAlbumCachedGroup{{ID: oldID, Members: firstMembers}, {ID: newID, Members: mergedMembers}},
		[]SmartAlbumGroup{{ID: "sg_33333333333333333333", Dimension: SmartAlbumDimensionRecommended, Members: mergedMembers}},
	)
	if err != nil || len(conflicted) != 1 || !conflicted[0].OverrideConflict || len(conflicted[0].overrideSources) != 2 {
		t.Fatalf("conflicting overrides were not marked for review: groups=%+v err=%v", conflicted, err)
	}
	if len(service.state.Overrides) != 2 {
		t.Fatalf("conflicting user choices were overwritten: %+v", service.state.Overrides)
	}
	visibleConflict := service.applyOverrides(albumID, SmartAlbumDimensionRecommended, conflicted)
	if !visibleConflict[0].OverrideConflict || visibleConflict[0].Name == "春日旅行" || visibleConflict[0].Name == "家人聚会" {
		t.Fatalf("one conflicting user name was silently selected: %+v", visibleConflict[0])
	}
}

func TestSmartAlbumRecommendationScoreIsBoundedAndPrefersIndependentEvidence(t *testing.T) {
	weak := scoreSmartRecommendation(24, 80, 2, 0.55, 0.82, true)
	strong := scoreSmartRecommendation(24, 80, 4, 0.95, 0.9, true)
	if weak < 0 || strong > 1 || strong <= weak {
		t.Fatalf("scores do not reflect evidence quality: weak=%.3f strong=%.3f", weak, strong)
	}
	if math.IsNaN(strong) || math.IsInf(strong, 0) {
		t.Fatalf("invalid score %.3f", strong)
	}
	if strong < smartRecommendationMinimumQualityScore {
		t.Fatalf("strong evidence score %.3f is below the recommendation floor", strong)
	}
}

func recommendationFixture(
	count int,
	start time.Time,
	themes int,
) ([]smartAlbumMedia, map[string]AIAnalysisRecord, []smartSceneVector) {
	media := make([]smartAlbumMedia, count)
	metadata := make(map[string]AIAnalysisRecord, count)
	vectors := make([]smartSceneVector, 0, count)
	centers := make([][]float32, max(1, themes))
	for theme := range centers {
		center := make([]float32, AIEmbeddingDimension)
		center[theme] = 1
		centers[theme] = center
	}
	for index := range media {
		id := fmt.Sprintf("f_%05d", index)
		media[index] = smartAlbumMedia{id: id, version: "v1"}
		captured := start.Add(time.Duration(index/50) * 24 * time.Hour)
		data, _ := json.Marshal(ImageMetadata{DateTimeOriginal: captured.Format(time.RFC3339Nano)})
		metadata[id] = AIAnalysisRecord{Status: MetadataParseParsed, Data: data}
		if themes == 0 {
			continue
		}
		theme := min(themes-1, index/max(1, count/themes))
		vector := append([]float32(nil), centers[theme]...)
		vectors = append(vectors, smartSceneVector{id: id, vector: vector})
	}
	return media, metadata, vectors
}

func recommendationIDs(media []smartAlbumMedia, start, count int) []string {
	ids := make([]string, 0, count)
	for _, item := range media[start : start+count] {
		ids = append(ids, item.id)
	}
	return ids
}

func recommendationGroup(dimension, id, name string, members []string) SmartAlbumGroup {
	return SmartAlbumGroup{
		ID: "sg_" + id, Dimension: dimension,
		Name: name, SuggestedName: name, PhotoCount: len(members), Members: members,
	}
}

func logSmartAlbumRecommendationMetrics(t *testing.T, albumSize int, groups []SmartAlbumGroup) {
	t.Helper()
	sizes := make([]int, 0, len(groups))
	covered := make(map[string]struct{})
	qualityTotal := 0.0
	overlapPairs := 0
	smallGroups := 0
	for _, group := range groups {
		sizes = append(sizes, group.PhotoCount)
		if group.PhotoCount < 12 {
			smallGroups++
		}
		qualityTotal += group.QualityScore
		for _, id := range group.Members {
			covered[id] = struct{}{}
		}
	}
	for left := range groups {
		for right := left + 1; right < len(groups); right++ {
			if smartRecommendationIntersection(
				recommendationMemberSet(groups[left].Members),
				recommendationMemberSet(groups[right].Members),
			) > 0 {
				overlapPairs++
			}
		}
	}
	sort.Ints(sizes)
	median, p90, minimum, maximum := 0, 0, 0, 0
	if len(sizes) > 0 {
		minimum, maximum = sizes[0], sizes[len(sizes)-1]
		median = sizes[(len(sizes)-1)/2]
		p90 = sizes[(len(sizes)*9-1)/10]
	}
	coverage := 0.0
	if albumSize > 0 {
		coverage = 100 * float64(len(covered)) / float64(albumSize)
	}
	meanQuality := 0.0
	if len(groups) > 0 {
		meanQuality = qualityTotal / float64(len(groups))
	}
	t.Logf(
		"synthetic quality: photos=%d recommendations=%d coverage=%d/%.0f%% size[min/median/p90/max]=%d/%d/%d/%d mean_score=%.3f groups_under_12=%d overlapping_pairs=%d",
		albumSize, len(groups), len(covered), coverage, minimum, median, p90, maximum, meanQuality, smallGroups, overlapPairs,
	)
}

func recommendationMemberSet(ids []string) map[string]struct{} {
	result := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		result[id] = struct{}{}
	}
	return result
}

func TestSmartAlbumRecommendationOverlapThreshold(t *testing.T) {
	makePair := func(shared int) (map[string]struct{}, map[string]struct{}) {
		leftIDs := make([]string, 0, 80)
		rightIDs := make([]string, 0, 80)
		for index := 0; index < shared; index++ {
			id := fmt.Sprintf("shared-%d", index)
			leftIDs = append(leftIDs, id)
			rightIDs = append(rightIDs, id)
		}
		for index := shared; index < 80; index++ {
			leftIDs = append(leftIDs, fmt.Sprintf("left-%d", index))
			rightIDs = append(rightIDs, fmt.Sprintf("right-%d", index))
		}
		return recommendationMemberSet(leftIDs), recommendationMemberSet(rightIDs)
	}

	left, right := makePair(48)
	if !smartRecommendationIsDuplicate(left, right) {
		t.Fatal("60% containment / 42.9% Jaccard overlap was not rejected")
	}
	left, right = makePair(42)
	if smartRecommendationIsDuplicate(left, right) {
		t.Fatal("overlap below both duplicate thresholds was rejected")
	}
}

func BenchmarkSmartAlbumRecommendations(b *testing.B) {
	for _, count := range []int{100, 1000, 5000} {
		b.Run(fmt.Sprint(count), func(b *testing.B) {
			start := time.Date(2025, 8, 1, 9, 0, 0, 0, time.UTC)
			media, metadata, vectors := recommendationFixture(count, start, 5)
			details := recommendationBenchmarkDetails(media, start)
			b.ReportAllocs()
			b.ResetTimer()
			for index := 0; index < b.N; index++ {
				_ = buildSmartAlbumRecommendations("a_benchmark", "照片", media, details, metadata, vectors)
			}
		})
	}
}

func recommendationBenchmarkDetails(media []smartAlbumMedia, start time.Time) map[string][]SmartAlbumGroup {
	details := make(map[string][]SmartAlbumGroup)
	for first := 0; first < len(media); first += 50 {
		end := min(first+50, len(media))
		members := recommendationIDs(media, first, end-first)
		day := start.Add(time.Duration(first/50) * 24 * time.Hour)
		details[SmartAlbumDimensionTime] = append(details[SmartAlbumDimensionTime], recommendationGroup(
			SmartAlbumDimensionTime, fmt.Sprintf("time-%d", first/50), day.Format("2006年1月2日"), members,
		))
	}
	themeSize := (len(media) + 4) / 5
	for theme := 0; theme < 5; theme++ {
		first := theme * themeSize
		if first >= len(media) {
			break
		}
		end := min(first+themeSize, len(media))
		members := recommendationIDs(media, first, end-first)
		details[SmartAlbumDimensionPlace] = append(details[SmartAlbumDimensionPlace], recommendationGroup(
			SmartAlbumDimensionPlace, fmt.Sprintf("place-%d", theme), fmt.Sprintf("城市 %d", theme+1), members,
		))
		details[SmartAlbumDimensionScene] = append(details[SmartAlbumDimensionScene], recommendationGroup(
			SmartAlbumDimensionScene, fmt.Sprintf("scene-%d", theme), fmt.Sprintf("建议 · 主题 %d", theme+1), members,
		))
	}
	return details
}

func TestSmartAlbumFaceCachesFollowActiveModel(t *testing.T) {
	cacheDir := t.TempDir()
	jobs := &AIJobService{settings: AIJobSettings{FaceModel: FaceModelBuffaloM}}
	service := &SmartAlbumService{cacheDir: cacheDir, jobs: jobs}
	for _, dimension := range []string{SmartAlbumDimensionPeople, SmartAlbumDimensionRecommended} {
		cache := smartAlbumCache{
			Version: smartAlbumCacheVersion, AlbumID: "album-profile-cache", Dimension: dimension,
			FaceModel: FaceModelQualityV2, Groups: []smartAlbumCachedGroup{},
		}
		path := service.cachePath(cache.AlbumID, dimension)
		if err := writeAIJSONAtomic(path, cache); err != nil {
			t.Fatal(err)
		}
		if _, ok := service.readCachedGroups(cache.AlbumID, dimension); ok {
			t.Fatalf("%s cache from quality-v2 was served while Buffalo_m is active", dimension)
		}

		cache.FaceModel = FaceModelBuffaloM
		if err := writeAIJSONAtomic(path, cache); err != nil {
			t.Fatal(err)
		}
		if _, ok := service.readCachedGroups(cache.AlbumID, dimension); !ok {
			t.Fatalf("%s cache for the active Buffalo_m model was rejected", dimension)
		}
	}
}
