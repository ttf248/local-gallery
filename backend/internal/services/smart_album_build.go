package services

// 本文件按维度构建分组草稿：拍摄时间、离线地点、人物与场景。
//
// 人物维度直接用现有人物候选，不另建一份分组逻辑。

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"
)

func (s *SmartAlbumService) buildGroups(
	ctx context.Context,
	albumID, dimension string,
	media []smartAlbumMedia,
	mediaByID map[string]smartAlbumMedia,
	metadata map[string]AIAnalysisRecord,
	faceRecords map[string]AIAnalysisRecordSummary,
	peopleGroups []PeopleAlbumGroup,
) ([]SmartAlbumGroup, error) {
	drafts := make(map[string]*smartAlbumDraft)
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	switch dimension {
	case SmartAlbumDimensionTime:
		addTimeDrafts(drafts, metadata)
	case SmartAlbumDimensionPlace:
		addPlaceDrafts(ctx, drafts, media, metadata)
	case SmartAlbumDimensionPeople:
		for _, person := range peopleGroups {
			if person.Group.Hidden || person.Group.PhotoCount < smartAlbumMinimumGroupSize {
				continue
			}
			addDraft(drafts, "person:"+person.Group.ID, person.Group.Name, person.Group.Name, person.ResourceIDs)
		}
	case SmartAlbumDimensionScene:
		vectors := s.currentSmartSceneVectorsFromMedia(media)
		scenes, err := clusterSmartScenes(ctx, vectors)
		if err != nil {
			return nil, err
		}
		for _, scene := range scenes {
			addDraft(drafts, "scene:"+scene.anchor, "相似场景", "相似场景", scene.members)
		}
		if len(drafts) > 0 {
			if err := s.nameSceneDrafts(ctx, drafts, vectors); err != nil && !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
				// Scene grouping does not depend on text inference. A missing Worker or
				// failed label request leaves the conservative generic name in place.
			}
		}
		sceneKeys := make([]string, 0, len(drafts))
		for key := range drafts {
			if strings.HasPrefix(key, "scene:") {
				sceneKeys = append(sceneKeys, key)
			}
		}
		sort.Strings(sceneKeys)
		for index, key := range sceneKeys {
			if drafts[key].name == "相似场景" {
				drafts[key].name = fmt.Sprintf("相似场景 %02d", index+1)
			}
		}
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	groups := make([]SmartAlbumGroup, 0, len(drafts))
	mediaOrder := make(map[string]int, len(media))
	for index, item := range media {
		mediaOrder[item.id] = index
	}
	for _, draft := range drafts {
		members := make([]string, 0, len(draft.members))
		for id := range draft.members {
			if _, exists := mediaByID[id]; exists {
				members = append(members, id)
			}
		}
		sort.Slice(members, func(i, j int) bool { return mediaOrder[members[i]] < mediaOrder[members[j]] })
		if len(members) < smartAlbumMinimumGroupSize {
			continue
		}
		cover := mediaByID[members[0]]
		groups = append(groups, SmartAlbumGroup{
			ID: smartGroupID(dimension, draft.key), Dimension: dimension,
			Name: draft.name, SuggestedName: draft.name, PhotoCount: len(members),
			CoverResourceID: cover.id, CoverVersion: cover.version, Members: members, sortKey: draft.sortKey,
		})
	}
	sortSmartAlbumGroups(groups, dimension)
	return groups, nil
}

func addTimeDrafts(drafts map[string]*smartAlbumDraft, records map[string]AIAnalysisRecord) {
	byDay := make(map[string][]smartCapture)
	for resourceID, record := range records {
		if record.Status != MetadataParseParsed || len(record.Data) == 0 {
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
		day := captured.Format("2006-01-02")
		byDay[day] = append(byDay[day], smartCapture{resourceID: resourceID, captured: captured})
	}
	days := make([]string, 0, len(byDay))
	for day := range byDay {
		days = append(days, day)
	}
	sort.Strings(days)
	for _, day := range days {
		photos := byDay[day]
		sort.Slice(photos, func(i, j int) bool {
			if photos[i].captured.Equal(photos[j].captured) {
				return photos[i].resourceID < photos[j].resourceID
			}
			return photos[i].captured.Before(photos[j].captured)
		})
		segments := splitSmartCaptureSessions(photos)
		for sessionIndex, segment := range segments {
			if len(segment) < smartAlbumMinimumGroupSize {
				continue
			}
			name := segment[0].captured.Format("2006年1月2日")
			if len(segments) > 1 {
				start := segment[0].captured.Format("15:04")
				end := segment[len(segment)-1].captured.Format("15:04")
				name += " · " + start + "–" + end
			}
			members := make([]string, 0, len(segment))
			for _, photo := range segment {
				members = append(members, photo.resourceID)
			}
			key := "date:" + day + ":" + segment[0].resourceID
			if len(segments) == 1 {
				key = "date:" + day
			}
			sortKey := segment[0].captured.Format(time.RFC3339Nano)
			if sessionIndex > 0 {
				sortKey += ":" + strconv.Itoa(sessionIndex)
			}
			addDraft(drafts, key, name, sortKey, members)
		}
	}
}

type smartCapture struct {
	resourceID string
	captured   time.Time
}

func parseSmartCaptureTime(value string) (time.Time, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return time.Time{}, false
	}
	layouts := []string{time.RFC3339Nano, "2006-01-02T15:04:05.999999999", "2006-01-02 15:04:05"}
	for _, layout := range layouts {
		captured, err := time.Parse(layout, value)
		if err != nil {
			continue
		}
		year := captured.Year()
		if year < 1900 || year > time.Now().Year()+1 {
			return time.Time{}, false
		}
		return captured, true
	}
	return time.Time{}, false
}

func splitSmartCaptureSessions(photos []smartCapture) [][]smartCapture {
	if len(photos) == 0 {
		return nil
	}
	gaps := make([]float64, 0, len(photos)-1)
	for index := 1; index < len(photos); index++ {
		gaps = append(gaps, photos[index].captured.Sub(photos[index-1].captured).Seconds())
	}
	threshold := 30 * 60.0
	if len(gaps) > 0 {
		median := medianFloat64(gaps)
		deviations := make([]float64, len(gaps))
		for index, gap := range gaps {
			deviations[index] = math.Abs(gap - median)
		}
		threshold = math.Max(threshold, median+4*medianFloat64(deviations))
	}
	threshold = math.Min(threshold, 8*60*60)
	segments := make([][]smartCapture, 0, 4)
	start := 0
	for index := 1; index < len(photos); index++ {
		gap := photos[index].captured.Sub(photos[index-1].captured).Seconds()
		if gap > threshold {
			segments = append(segments, append([]smartCapture(nil), photos[start:index]...))
			start = index
		}
	}
	segments = append(segments, append([]smartCapture(nil), photos[start:]...))
	return segments
}

func medianFloat64(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	ordered := append([]float64(nil), values...)
	sort.Float64s(ordered)
	middle := len(ordered) / 2
	if len(ordered)%2 == 1 {
		return ordered[middle]
	}
	return (ordered[middle-1] + ordered[middle]) / 2
}

func addPlaceDrafts(ctx context.Context, drafts map[string]*smartAlbumDraft, media []smartAlbumMedia, records map[string]AIAnalysisRecord) error {
	metadataIndex, _ := loadChinaAdminIndex()
	type smartPlacePoint struct {
		id        string
		latitude  float64
		longitude float64
		chain     []*chinaAdminFeature
	}
	points := make([]smartPlacePoint, 0)
	maxDepth := 0
	for _, item := range media {
		if err := ctx.Err(); err != nil {
			return err
		}
		record, exists := records[item.id]
		if !exists || record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil || metadata.GPS == nil ||
			!validCoordinates(metadata.GPS.Latitude, metadata.GPS.Longitude) {
			continue
		}
		gps := metadata.GPS
		longitude, latitude, datumValid := coordinatesToChinaMap(gps.Longitude, gps.Latitude, gps.MapDatum)
		point := smartPlacePoint{id: item.id, latitude: gps.Latitude, longitude: gps.Longitude}
		if datumValid && metadataIndex != nil {
			province := matchingChinaFeature(metadataIndex.provinces, longitude, latitude)
			if province != nil {
				area := deepestChinaFeature(metadataIndex, province, longitude, latitude)
				if area == nil {
					area = province
				}
				for current := area; current != nil; current = metadataIndex.byAdcode[current.parentAdcode] {
					point.chain = append(point.chain, current)
					if current.parentAdcode == 0 {
						break
					}
				}
				for left, right := 0, len(point.chain)-1; left < right; left, right = left+1, right-1 {
					point.chain[left], point.chain[right] = point.chain[right], point.chain[left]
				}
			}
		}
		maxDepth = max(maxDepth, len(point.chain))
		points = append(points, point)
	}
	if len(points) == 0 {
		return nil
	}
	maxGroups := max(1, min(12, int(math.Ceil(math.Sqrt(float64(len(points))/8)))))
	level := maxDepth
	if level == 0 {
		level = 3
	}
	type smartPlaceBucket struct {
		name    string
		members []string
	}
	buckets := map[string]*smartPlaceBucket{}
	for currentLevel := level; currentLevel >= 0; currentLevel-- {
		buckets = make(map[string]*smartPlaceBucket)
		for _, point := range points {
			key, name := "", ""
			if currentLevel > 0 && len(point.chain) >= currentLevel {
				feature := point.chain[currentLevel-1]
				key = "admin:" + strconv.Itoa(feature.adcode)
				name = chinaFeatureLabel(metadataIndex, feature)
			} else {
				precision := min(5, max(2, currentLevel+2))
				key = "cell:" + encodeSmartGeohash(point.latitude, point.longitude, precision)
			}
			bucket := buckets[key]
			if bucket == nil {
				bucket = &smartPlaceBucket{name: name}
				buckets[key] = bucket
			}
			if bucket.name == "" {
				bucket.name = name
			}
			bucket.members = append(bucket.members, point.id)
		}
		if len(buckets) <= maxGroups || currentLevel == 0 {
			break
		}
	}
	keys := make([]string, 0, len(buckets))
	for key := range buckets {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	nearbyIndex := 0
	for _, key := range keys {
		bucket := buckets[key]
		if len(bucket.members) < smartAlbumMinimumGroupSize {
			continue
		}
		name := bucket.name
		if name == "" {
			nearbyIndex++
			name = fmt.Sprintf("附近位置 %02d", nearbyIndex)
		}
		addDraft(drafts, "place:"+key, name, key, bucket.members)
	}
	return nil
}

func chinaFeatureLabel(index *chinaAdminIndex, feature *chinaAdminFeature) string {
	if index == nil || feature == nil {
		return ""
	}
	parts := make([]string, 0, 3)
	current := feature
	for depth := 0; current != nil && depth < 3; depth++ {
		if current.name != "" {
			parts = append(parts, current.name)
		}
		if current.parentAdcode == 0 {
			break
		}
		current = index.byAdcode[current.parentAdcode]
	}
	for left, right := 0, len(parts)-1; left < right; left, right = left+1, right-1 {
		parts[left], parts[right] = parts[right], parts[left]
	}
	return strings.Join(parts, " · ")
}

func encodeSmartGeohash(latitude, longitude float64, precision int) string {
	const alphabet = "0123456789bcdefghjkmnpqrstuvwxyz"
	latMin, latMax := -90.0, 90.0
	lonMin, lonMax := -180.0, 180.0
	result := make([]byte, 0, precision)
	value, bits, even := 0, 0, true
	for len(result) < precision {
		value <<= 1
		if even {
			middle := (lonMin + lonMax) / 2
			if longitude >= middle {
				value |= 1
				lonMin = middle
			} else {
				lonMax = middle
			}
		} else {
			middle := (latMin + latMax) / 2
			if latitude >= middle {
				value |= 1
				latMin = middle
			} else {
				latMax = middle
			}
		}
		even = !even
		bits++
		if bits == 5 {
			result = append(result, alphabet[value])
			value, bits = 0, 0
		}
	}
	return string(result)
}

type smartSceneVector struct {
	id     string
	vector []float32
}

type smartSceneCluster struct {
	anchor   string
	members  []string
	cohesion float64
}

func normalizeSmartVector(values []float32) []float32 {
	if len(values) != AIEmbeddingDimension {
		return nil
	}
	norm := 0.0
	for _, value := range values {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return nil
		}
		norm += float64(value) * float64(value)
	}
	if norm == 0 {
		return nil
	}
	length := float32(math.Sqrt(norm))
	result := make([]float32, len(values))
	for index, value := range values {
		result[index] = value / length
	}
	return result
}

func clusterSmartScenes(ctx context.Context, vectors []smartSceneVector) ([]smartSceneCluster, error) {
	if len(vectors) < smartAlbumMinimumGroupSize {
		return nil, nil
	}
	index := newPeopleANNIndexForDimension(AIEmbeddingDimension)
	index.efConstruction = smartSceneANNConstruction
	index.efSearch = smartSceneANNSearch
	positionByID := make(map[string]int, len(vectors))
	for position, item := range vectors {
		index.Add(item.id, item.vector)
		positionByID[item.id] = position
	}
	neighbors := make([]map[int]float32, len(vectors))
	limit := min(16, len(vectors))
	for position, item := range vectors {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		neighbors[position] = make(map[int]float32, limit)
		for _, hit := range index.Search(item.vector, limit) {
			neighborPosition, exists := positionByID[hit.id]
			if !exists || neighborPosition == position {
				continue
			}
			neighbors[position][neighborPosition] = hit.score
		}
	}
	// Mutual neighbors find local photo sets. A fixed cosine floor keeps the
	// threshold interpretable; random-pair P99 made it depend on unrelated
	// photos elsewhere in the folder.
	threshold := float32(smartSceneSimilarityFloor)
	parents := make([]int, len(vectors))
	for index := range parents {
		parents[index] = index
	}
	var find func(int) int
	find = func(value int) int {
		if parents[value] != value {
			parents[value] = find(parents[value])
		}
		return parents[value]
	}
	union := func(left, right int) {
		leftRoot, rightRoot := find(left), find(right)
		if leftRoot != rightRoot {
			if leftRoot < rightRoot {
				parents[rightRoot] = leftRoot
			} else {
				parents[leftRoot] = rightRoot
			}
		}
	}
	for left, candidates := range neighbors {
		for right, score := range candidates {
			if right <= left || score < threshold {
				continue
			}
			reverse, mutual := neighbors[right][left]
			if mutual && reverse >= threshold {
				union(left, right)
			}
		}
	}
	components := make(map[int][]string)
	for position, item := range vectors {
		components[find(position)] = append(components[find(position)], item.id)
	}
	vectorByID := make(map[string][]float32, len(vectors))
	for _, item := range vectors {
		vectorByID[item.id] = item.vector
	}
	result := make([]smartSceneCluster, 0, len(components))
	for _, members := range components {
		if len(members) < smartAlbumMinimumGroupSize {
			continue
		}
		sort.Strings(members)
		memberSet := make(map[string]struct{}, len(members))
		for _, id := range members {
			memberSet[id] = struct{}{}
		}
		cohesion := smartRecommendationSceneCohesion(memberSet, vectorByID)
		if cohesion < 0.80 {
			continue
		}
		result = append(result, smartSceneCluster{anchor: members[0], members: members, cohesion: cohesion})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].anchor < result[j].anchor })
	return result, nil
}

func smartVectorDot(left, right []float32) float32 {
	var score float32
	for index, value := range left {
		score += value * right[index]
	}
	return score
}

var smartSceneLabels = []string{
	"海边、海浪与海岸", "山脉、山峰与峡谷", "森林、树木与绿地", "花卉、植物与庭院",
	"城市街道与建筑", "室内空间与家具", "夜景与灯光", "天空、云朵与日落",
	"雪景与冰面", "湖泊、河流与瀑布", "动物与野生生物", "猫、狗与宠物",
	"美食与餐桌", "人物与聚会", "运动与户外活动", "旅行地标与景点",
	"汽车与交通工具", "展览与艺术品", "建筑细节", "家庭日常",
	"文档、屏幕与文字", "烟花与节庆", "海岛与船只", "乡村与农田",
}

func (s *SmartAlbumService) nameSceneDrafts(
	ctx context.Context,
	drafts map[string]*smartAlbumDraft,
	vectors []smartSceneVector,
) error {
	if s.textEmbedder == nil {
		return errors.New("scene labeler is unavailable")
	}
	readyCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	if err := s.textEmbedder.Ready(readyCtx); err != nil {
		return err
	}
	prompts := make([]string, len(smartSceneLabels))
	for index, label := range smartSceneLabels {
		prompts[index] = "一张关于" + label + "的照片"
	}
	textVectors, err := s.textEmbedder.SearchTexts(readyCtx, prompts)
	if err != nil {
		return err
	}
	if len(textVectors) != len(smartSceneLabels) {
		return errors.New("scene labeler returned an incomplete result")
	}
	vectorByID := make(map[string][]float32, len(vectors))
	for _, item := range vectors {
		vectorByID[item.id] = item.vector
	}
	draftKeys := make([]string, 0, len(drafts))
	for key := range drafts {
		if strings.HasPrefix(key, "scene:") {
			draftKeys = append(draftKeys, key)
		}
	}
	sort.Strings(draftKeys)
	for index, key := range draftKeys {
		draft := drafts[key]
		centroid := make([]float32, AIEmbeddingDimension)
		count := 0
		for resourceID := range draft.members {
			vector := vectorByID[resourceID]
			if len(vector) != AIEmbeddingDimension {
				continue
			}
			for position, value := range vector {
				centroid[position] += value
			}
			count++
		}
		if count == 0 {
			continue
		}
		centroid = normalizeSmartVector(centroid)
		if centroid == nil {
			continue
		}
		bestLabel, bestScore := "", float32(-1)
		for labelIndex, candidate := range textVectors {
			candidate = normalizeSmartVector(candidate)
			if candidate == nil {
				continue
			}
			score := smartVectorDot(centroid, candidate)
			if score > bestScore {
				bestScore = score
				bestLabel = smartSceneLabels[labelIndex]
			}
		}
		if bestLabel != "" {
			draft.name = "建议 · " + bestLabel
		}
		if draft.sortKey == "" {
			draft.sortKey = strings.TrimPrefix(key, "scene:")
		}
		if draft.name == "" {
			draft.name = fmt.Sprintf("相似场景 %02d", index+1)
		}
	}
	return nil
}

func addDraft(drafts map[string]*smartAlbumDraft, key, name, sortKey string, members []string) {
	draft := drafts[key]
	if draft == nil {
		draft = &smartAlbumDraft{key: key, name: name, sortKey: sortKey, members: make(map[string]struct{})}
		drafts[key] = draft
	}
	if draft.name == "" {
		draft.name = name
	}
	if draft.sortKey == "" {
		draft.sortKey = sortKey
	}
	for _, resourceID := range members {
		draft.members[resourceID] = struct{}{}
	}
}

func sortSmartAlbumGroups(groups []SmartAlbumGroup, dimension string) {
	sort.Slice(groups, func(i, j int) bool {
		if dimension == SmartAlbumDimensionTime && groups[i].sortKey != groups[j].sortKey {
			return groups[i].sortKey > groups[j].sortKey
		}
		if groups[i].PhotoCount != groups[j].PhotoCount {
			return groups[i].PhotoCount > groups[j].PhotoCount
		}
		if groups[i].Name != groups[j].Name {
			return strings.ToLower(groups[i].Name) < strings.ToLower(groups[j].Name)
		}
		return groups[i].ID < groups[j].ID
	})
}
