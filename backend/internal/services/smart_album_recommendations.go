package services

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
)

const (
	smartRecommendationMinimumQualityScore  = 0.82
	smartRecommendationDuplicateContainment = 0.60
	smartRecommendationDuplicateJaccard     = 0.40
)

type smartRecommendationEvidence struct {
	group   SmartAlbumGroup
	members map[string]struct{}
}

type smartRecommendationCandidate struct {
	seedDimension string
	seedGroups    []SmartAlbumGroup
	members       map[string]struct{}
	start         time.Time
	end           time.Time
}

type smartRecommendationMatch struct {
	evidence smartRecommendationEvidence
	overlap  int
	strength float64
}

func buildSmartAlbumRecommendations(
	albumID string,
	albumName string,
	media []smartAlbumMedia,
	detailGroups map[string][]SmartAlbumGroup,
	metadata map[string]AIAnalysisRecord,
	vectors []smartSceneVector,
) []SmartAlbumGroup {
	if len(media) < 8 {
		return nil
	}
	mediaByID := make(map[string]smartAlbumMedia, len(media))
	mediaOrder := make(map[string]int, len(media))
	for index, item := range media {
		mediaByID[item.id] = item
		mediaOrder[item.id] = index
	}
	vectorByID := make(map[string][]float32, len(vectors))
	for _, item := range vectors {
		vectorByID[item.id] = item.vector
	}

	evidence := make([]smartRecommendationEvidence, 0)
	evidenceByDimension := make(map[string][]smartRecommendationEvidence)
	for _, dimension := range smartAlbumDetailDimensions() {
		for _, group := range detailGroups[dimension] {
			members := smartRecommendationMemberSet(group.Members, mediaByID)
			if len(members) == 0 {
				continue
			}
			item := smartRecommendationEvidence{group: group, members: members}
			evidence = append(evidence, item)
			evidenceByDimension[dimension] = append(evidenceByDimension[dimension], item)
		}
	}

	// 时间分组先保留拍摄段。相邻段只有在另有地点、人物或场景证据时
	// 才合并，避免把同一活动切碎，也避免单凭时间把无关活动拼在一起。
	events := make([]smartRecommendationCandidate, 0, len(evidenceByDimension[SmartAlbumDimensionTime]))
	for _, item := range evidenceByDimension[SmartAlbumDimensionTime] {
		candidate := smartRecommendationCandidate{
			seedDimension: SmartAlbumDimensionTime,
			seedGroups:    []SmartAlbumGroup{item.group},
			members:       cloneSmartMembers(item.members),
		}
		candidate.start, candidate.end = smartRecommendationTimeBounds(candidate.members, metadata)
		events = append(events, candidate)
	}
	events = mergeAdjacentSmartEvents(events, evidenceByDimension)

	candidates := make([]smartRecommendationCandidate, 0, len(events)+len(evidence))
	candidates = append(candidates, events...)
	for _, dimension := range []string{
		SmartAlbumDimensionScene, SmartAlbumDimensionPlace, SmartAlbumDimensionPeople,
	} {
		for _, item := range evidenceByDimension[dimension] {
			candidates = append(candidates, smartRecommendationCandidate{
				seedDimension: dimension,
				seedGroups:    []SmartAlbumGroup{item.group},
				members:       cloneSmartMembers(item.members),
			})
		}
	}

	minimumPhotos := 12
	maxRecommendations := min(8, max(1, int(math.Ceil(math.Sqrt(float64(len(media))/50)))))
	qualified := make([]SmartAlbumGroup, 0, len(candidates))
	for _, candidate := range candidates {
		if len(candidate.members) < minimumPhotos {
			continue
		}
		matches, evidenceDimensions := matchSmartRecommendationEvidence(candidate.members, evidence)
		if candidate.seedDimension == SmartAlbumDimensionTime {
			if !containsSmartDimension(evidenceDimensions, SmartAlbumDimensionTime) {
				evidenceDimensions = append(evidenceDimensions, SmartAlbumDimensionTime)
			}
		}
		if candidate.seedDimension == SmartAlbumDimensionScene || candidate.seedDimension == SmartAlbumDimensionPlace {
			if !containsSmartDimension(evidenceDimensions, candidate.seedDimension) {
				evidenceDimensions = append(evidenceDimensions, candidate.seedDimension)
			}
		}
		evidenceDimensions = orderSmartEvidenceDimensions(evidenceDimensions)

		scene, sceneOverlap := bestSmartRecommendationMatch(matches, SmartAlbumDimensionScene)
		place, _ := bestSmartRecommendationMatch(matches, SmartAlbumDimensionPlace)
		name := smartRecommendationName(candidate, scene, place, metadata)
		if name == "" {
			continue
		}

		memberCount := len(candidate.members)
		ratio := float64(memberCount) / float64(len(media))
		specificEvidence := !isGenericSmartRecommendationName(scene.Name) || !isGenericSmartRecommendationName(place.Name)
		cohesion := 0.78
		if sceneOverlap > 0 {
			cohesion = smartRecommendationSceneCohesion(candidate.members, vectorByID)
		}
		if candidate.seedDimension == SmartAlbumDimensionTime && !candidate.start.IsZero() {
			cohesion = max(cohesion, 0.82)
		}
		if candidate.seedDimension == SmartAlbumDimensionPlace {
			cohesion = max(cohesion, 0.80)
		}
		singleDistinctPlace := candidate.seedDimension == SmartAlbumDimensionPlace &&
			len(evidenceDimensions) == 1 && memberCount >= 12 && ratio <= 0.65
		personSceneSupport := sceneOverlap >= max(8, int(math.Ceil(float64(memberCount)*0.45))) &&
			!isGenericSmartRecommendationName(scene.Name) && cohesion >= 0.82
		representativePeople := candidate.seedDimension == SmartAlbumDimensionPeople &&
			memberCount >= 12 && ratio >= 0.10 && ratio <= 0.65 &&
			personSceneSupport &&
			containsSmartDimension(evidenceDimensions, SmartAlbumDimensionPeople)
		if len(evidenceDimensions) < 2 && !singleDistinctPlace && !representativePeople {
			continue
		}
		if ratio >= 0.82 {
			if memberCount < 32 || !specificEvidence || !smartRecommendationAddsParentValue(albumName, name) {
				continue
			}
			crossDay := !candidate.start.IsZero() && !candidate.end.IsZero() &&
				(candidate.start.Year() != candidate.end.Year() || candidate.start.YearDay() != candidate.end.YearDay())
			if len(evidenceDimensions) < 3 && !crossDay {
				continue
			}
		}

		evidenceStrength := smartRecommendationEvidenceStrength(matches)
		score := scoreSmartRecommendation(
			memberCount, len(media), len(evidenceDimensions), evidenceStrength, cohesion, specificEvidence,
		)
		if candidate.seedDimension == SmartAlbumDimensionTime && len(candidate.seedGroups) > 1 {
			// 多个连续拍摄段被独立地点、人物或场景证据串成同一活动时，
			// 让完整活动优先于其中一个高密度子集，避免多日行程被拆散。
			score = math.Min(1, score+math.Min(0.12, float64(len(candidate.seedGroups)-1)*0.06))
		}
		if representativePeople {
			score = math.Min(1, score+0.02)
		}
		if score < smartRecommendationMinimumQualityScore {
			continue
		}

		reasons := make([]string, 0, len(evidenceDimensions))
		for _, dimension := range evidenceDimensions {
			switch dimension {
			case SmartAlbumDimensionTime:
				reasons = append(reasons, "连续拍摄时间")
			case SmartAlbumDimensionPlace:
				reasons = append(reasons, "同一地点")
			case SmartAlbumDimensionPeople:
				reasons = append(reasons, "人物线索")
			case SmartAlbumDimensionScene:
				reasons = append(reasons, "相近场景")
			}
		}
		if len(reasons) == 0 {
			continue
		}
		members := sortedSmartRecommendationMembers(candidate.members, mediaOrder)
		cover := members[0]
		if candidate.seedDimension == SmartAlbumDimensionScene || sceneOverlap > 0 {
			cover = mostRepresentativeSmartSceneMember(members, vectorByID, cover)
		}
		ids := make([]string, 0, len(candidate.seedGroups))
		for _, group := range candidate.seedGroups {
			ids = append(ids, group.ID)
		}
		sort.Strings(ids)
		stableKey := albumID + ":" + candidate.seedDimension + ":" + strings.Join(ids, ":")
		qualified = append(qualified, SmartAlbumGroup{
			ID:        smartGroupID(SmartAlbumDimensionRecommended, stableKey),
			Dimension: SmartAlbumDimensionRecommended,
			Name:      name, SuggestedName: name, PhotoCount: memberCount,
			QualityScore: score, EvidenceDimensions: evidenceDimensions,
			RecommendationReasons: reasons, CoverResourceID: cover,
			CoverVersion: mediaByID[cover].version, Members: members,
			recommendationSeed: candidate.seedDimension,
		})
	}

	sort.Slice(qualified, func(i, j int) bool {
		if qualified[i].QualityScore != qualified[j].QualityScore {
			return qualified[i].QualityScore > qualified[j].QualityScore
		}
		if qualified[i].PhotoCount != qualified[j].PhotoCount {
			return qualified[i].PhotoCount > qualified[j].PhotoCount
		}
		if qualified[i].Name != qualified[j].Name {
			return qualified[i].Name < qualified[j].Name
		}
		return qualified[i].ID < qualified[j].ID
	})
	selected := make([]SmartAlbumGroup, 0, maxRecommendations)
	peopleRecommendationSelected := false
	for _, candidate := range qualified {
		if candidate.recommendationSeed == SmartAlbumDimensionPeople && peopleRecommendationSelected {
			continue
		}
		duplicate := false
		for _, existing := range selected {
			left := smartRecommendationMemberSet(candidate.Members, mediaByID)
			right := smartRecommendationMemberSet(existing.Members, mediaByID)
			if smartRecommendationIsDuplicate(left, right) {
				duplicate = true
				break
			}
		}
		if duplicate {
			continue
		}
		selected = append(selected, candidate)
		if candidate.recommendationSeed == SmartAlbumDimensionPeople {
			peopleRecommendationSelected = true
		}
		if len(selected) >= maxRecommendations {
			break
		}
	}
	return selected
}

func smartAlbumDetailDimensions() []string {
	return []string{
		SmartAlbumDimensionTime,
		SmartAlbumDimensionPlace,
		SmartAlbumDimensionPeople,
		SmartAlbumDimensionScene,
	}
}

func smartRecommendationMemberSet(ids []string, media map[string]smartAlbumMedia) map[string]struct{} {
	result := make(map[string]struct{}, len(ids))
	for _, id := range ids {
		if _, exists := media[id]; exists {
			result[id] = struct{}{}
		}
	}
	return result
}

func cloneSmartMembers(members map[string]struct{}) map[string]struct{} {
	result := make(map[string]struct{}, len(members))
	for id := range members {
		result[id] = struct{}{}
	}
	return result
}

func smartRecommendationTimeBounds(
	members map[string]struct{},
	metadata map[string]AIAnalysisRecord,
) (time.Time, time.Time) {
	var start, end time.Time
	for id := range members {
		record, exists := metadata[id]
		if !exists || record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var parsed ImageMetadata
		if err := json.Unmarshal(record.Data, &parsed); err != nil {
			continue
		}
		captured, ok := parseSmartCaptureTime(parsed.DateTimeOriginal)
		if !ok {
			continue
		}
		if start.IsZero() || captured.Before(start) {
			start = captured
		}
		if end.IsZero() || captured.After(end) {
			end = captured
		}
	}
	return start, end
}

func mergeAdjacentSmartEvents(
	events []smartRecommendationCandidate,
	evidenceByDimension map[string][]smartRecommendationEvidence,
) []smartRecommendationCandidate {
	if len(events) < 2 {
		return events
	}
	sort.Slice(events, func(i, j int) bool {
		if events[i].start.Equal(events[j].start) {
			return events[i].seedGroups[0].ID < events[j].seedGroups[0].ID
		}
		return events[i].start.Before(events[j].start)
	})
	result := make([]smartRecommendationCandidate, 0, len(events))
	for _, event := range events {
		if len(result) == 0 {
			result = append(result, event)
			continue
		}
		previous := &result[len(result)-1]
		gap := event.start.Sub(previous.end)
		if gap >= 0 && gap <= 36*time.Hour &&
			shareSmartRecommendationEvidence(previous.members, event.members, evidenceByDimension) {
			for id := range event.members {
				previous.members[id] = struct{}{}
			}
			previous.seedGroups = append(previous.seedGroups, event.seedGroups...)
			previous.end = event.end
			continue
		}
		result = append(result, event)
	}
	return result
}

func shareSmartRecommendationEvidence(
	left, right map[string]struct{},
	evidenceByDimension map[string][]smartRecommendationEvidence,
) bool {
	for _, dimension := range []string{
		SmartAlbumDimensionPlace, SmartAlbumDimensionPeople, SmartAlbumDimensionScene,
	} {
		for _, item := range evidenceByDimension[dimension] {
			leftOverlap := smartRecommendationIntersection(left, item.members)
			rightOverlap := smartRecommendationIntersection(right, item.members)
			if leftOverlap < smartEvidenceOverlapMinimum(left, item.members) ||
				rightOverlap < smartEvidenceOverlapMinimum(right, item.members) {
				continue
			}
			return true
		}
	}
	return false
}

func matchSmartRecommendationEvidence(
	members map[string]struct{},
	evidence []smartRecommendationEvidence,
) ([]smartRecommendationMatch, []string) {
	matches := make([]smartRecommendationMatch, 0)
	dimensions := make([]string, 0, 4)
	for _, item := range evidence {
		overlap := smartRecommendationIntersection(members, item.members)
		if overlap < smartEvidenceOverlapMinimum(members, item.members) {
			continue
		}
		candidateCoverage := float64(overlap) / float64(len(members))
		evidenceCoverage := float64(overlap) / float64(len(item.members))
		if candidateCoverage < 0.25 && evidenceCoverage < 0.60 {
			continue
		}
		strength := 2 * candidateCoverage * evidenceCoverage / (candidateCoverage + evidenceCoverage)
		matches = append(matches, smartRecommendationMatch{
			evidence: item, overlap: overlap, strength: strength,
		})
		if !containsSmartDimension(dimensions, item.group.Dimension) {
			dimensions = append(dimensions, item.group.Dimension)
		}
	}
	return matches, dimensions
}

func smartEvidenceOverlapMinimum(left, right map[string]struct{}) int {
	return max(2, int(math.Ceil(float64(min(len(left), len(right)))*0.15)))
}

func smartRecommendationEvidenceStrength(matches []smartRecommendationMatch) float64 {
	strongest := make(map[string]float64, len(smartAlbumDetailDimensions()))
	for _, match := range matches {
		dimension := match.evidence.group.Dimension
		if match.strength > strongest[dimension] {
			strongest[dimension] = match.strength
		}
	}
	if len(strongest) == 0 {
		return 0
	}
	total := 0.0
	for _, strength := range strongest {
		total += strength
	}
	return total / float64(len(strongest))
}

func bestSmartRecommendationMatch(matches []smartRecommendationMatch, dimension string) (SmartAlbumGroup, int) {
	var best SmartAlbumGroup
	bestOverlap := 0
	for _, match := range matches {
		if match.evidence.group.Dimension != dimension {
			continue
		}
		if match.overlap > bestOverlap ||
			(match.overlap == bestOverlap && match.evidence.group.ID < best.ID) {
			best = match.evidence.group
			bestOverlap = match.overlap
		}
	}
	return best, bestOverlap
}

func smartRecommendationName(
	candidate smartRecommendationCandidate,
	scene, place SmartAlbumGroup,
	metadata map[string]AIAnalysisRecord,
) string {
	sceneName := smartRecommendationSpecificName(scene.Name)
	placeName := smartRecommendationSpecificName(place.Name)
	if candidate.seedDimension == SmartAlbumDimensionPeople {
		parts := []string{"合影"}
		if sceneName != "" {
			parts = append(parts, sceneName)
		}
		if placeName != "" {
			parts = append(parts, placeName)
		}
		if len(parts) == 1 {
			if period := smartRecommendationPeriod(candidate, metadata); period != "" {
				parts = append(parts, period)
			}
		}
		if len(parts) == 1 {
			return ""
		}
		return strings.Join(parts, " · ")
	}
	if sceneName != "" && placeName != "" {
		return sceneName + " · " + placeName
	}
	period := smartRecommendationPeriod(candidate, metadata)
	if sceneName != "" && period != "" {
		return sceneName + " · " + period
	}
	if placeName != "" && period != "" {
		return period + " · " + placeName
	}
	if sceneName != "" {
		return sceneName
	}
	if placeName != "" {
		return placeName
	}
	for _, group := range candidate.seedGroups {
		if group.Dimension == SmartAlbumDimensionTime && !isGenericSmartRecommendationName(group.Name) {
			return group.Name
		}
	}
	return ""
}

func smartRecommendationSpecificName(name string) string {
	name = strings.TrimSpace(name)
	name = strings.TrimPrefix(name, "建议 · ")
	if isGenericSmartRecommendationName(name) {
		return ""
	}
	return name
}

func isGenericSmartRecommendationName(name string) bool {
	name = strings.TrimSpace(name)
	return name == "" || name == "相似场景" || strings.HasPrefix(name, "相似场景 ") ||
		strings.HasPrefix(name, "附近位置 ") || strings.HasPrefix(name, "人物 ")
}

func smartRecommendationAddsParentValue(parentName, recommendationName string) bool {
	parent := normalizeSmartAlbumLabel(parentName)
	recommendation := normalizeSmartAlbumLabel(recommendationName)
	if parent == "" || isGenericSmartAlbumName(parent) {
		return true
	}
	if recommendation == "" || strings.Contains(parent, recommendation) || strings.Contains(recommendation, parent) {
		return false
	}
	return smartAlbumLabelSimilarity(parent, recommendation) < 0.60
}

func isGenericSmartAlbumName(name string) bool {
	name = normalizeSmartAlbumLabel(name)
	if name == "" {
		return true
	}
	switch strings.ToLower(name) {
	case "album", "photos", "photo", "pictures", "picture", "images", "image", "camera", "dcim",
		"相册", "照片", "图片", "相机", "导入", "微信图片", "本目录媒体":
		return true
	default:
		return false
	}
}

func normalizeSmartAlbumLabel(value string) string {
	var normalized strings.Builder
	for _, char := range strings.ToLower(strings.TrimSpace(value)) {
		if unicode.IsLetter(char) || unicode.IsNumber(char) {
			normalized.WriteRune(char)
		}
	}
	return normalized.String()
}

func smartAlbumLabelSimilarity(left, right string) float64 {
	leftRunes, rightRunes := []rune(left), []rune(right)
	if len(leftRunes) < 2 || len(rightRunes) < 2 {
		if left == right {
			return 1
		}
		return 0
	}
	leftPairs := make(map[string]struct{}, len(leftRunes)-1)
	for index := 0; index+1 < len(leftRunes); index++ {
		leftPairs[string(leftRunes[index:index+2])] = struct{}{}
	}
	shared := 0
	seen := make(map[string]struct{}, len(rightRunes)-1)
	for index := 0; index+1 < len(rightRunes); index++ {
		pair := string(rightRunes[index : index+2])
		if _, duplicate := seen[pair]; duplicate {
			continue
		}
		seen[pair] = struct{}{}
		if _, exists := leftPairs[pair]; exists {
			shared++
		}
	}
	return 2 * float64(shared) / float64(len(leftPairs)+len(seen))
}

func smartRecommendationPeriod(
	candidate smartRecommendationCandidate,
	metadata map[string]AIAnalysisRecord,
) string {
	start, end := smartRecommendationTimeBounds(candidate.members, metadata)
	if start.IsZero() {
		return ""
	}
	if end.IsZero() || start.Year() == end.Year() && start.Month() == end.Month() {
		return fmt.Sprintf("%d年%d月", start.Year(), int(start.Month()))
	}
	if start.Year() == end.Year() {
		return fmt.Sprintf("%d年%d–%d月", start.Year(), int(start.Month()), int(end.Month()))
	}
	return fmt.Sprintf("%d年%d月–%d年%d月", start.Year(), int(start.Month()), end.Year(), int(end.Month()))
}

func scoreSmartRecommendation(
	size, albumSize, dimensions int,
	evidenceStrength, cohesion float64,
	specific bool,
) float64 {
	if size <= 0 || albumSize <= 0 {
		return 0
	}
	ratio := float64(size) / float64(albumSize)
	sizeScore := math.Min(1, math.Log2(float64(size)+1)/math.Log2(65))
	distinctiveness := math.Max(0.15, 1-ratio)
	dimensionScore := math.Min(1, float64(max(0, dimensions-1))/2)
	evidenceScore := 0.60*dimensionScore + 0.40*math.Max(0, math.Min(1, evidenceStrength))
	labelScore := 0.45
	if specific {
		labelScore = 1
	}
	score := 0.20*sizeScore + 0.34*evidenceScore + 0.22*cohesion +
		0.14*distinctiveness + 0.10*labelScore
	return math.Round(score*1000) / 1000
}

func smartRecommendationSceneCohesion(members map[string]struct{}, vectors map[string][]float32) float64 {
	centroid := make([]float32, AIEmbeddingDimension)
	count := 0
	for id := range members {
		vector := vectors[id]
		if len(vector) != AIEmbeddingDimension {
			continue
		}
		for index, value := range vector {
			centroid[index] += value
		}
		count++
	}
	if count < 2 {
		return 0.72
	}
	centroid = normalizeSmartVector(centroid)
	if centroid == nil {
		return 0
	}
	var score float64
	for id := range members {
		vector := vectors[id]
		if len(vector) == AIEmbeddingDimension {
			score += float64(smartVectorDot(centroid, vector))
		}
	}
	return score / float64(count)
}

func mostRepresentativeSmartSceneMember(
	members []string,
	vectors map[string][]float32,
	fallback string,
) string {
	centroid := make([]float32, AIEmbeddingDimension)
	count := 0
	for _, id := range members {
		vector := vectors[id]
		if len(vector) != AIEmbeddingDimension {
			continue
		}
		for index, value := range vector {
			centroid[index] += value
		}
		count++
	}
	if count == 0 {
		return fallback
	}
	centroid = normalizeSmartVector(centroid)
	if centroid == nil {
		return fallback
	}
	bestID, bestScore := fallback, float32(-2)
	for _, id := range members {
		vector := vectors[id]
		if len(vector) != AIEmbeddingDimension {
			continue
		}
		if score := smartVectorDot(centroid, vector); score > bestScore {
			bestID, bestScore = id, score
		}
	}
	return bestID
}

func sortedSmartRecommendationMembers(members map[string]struct{}, order map[string]int) []string {
	result := make([]string, 0, len(members))
	for id := range members {
		result = append(result, id)
	}
	sort.Slice(result, func(i, j int) bool {
		left, leftOK := order[result[i]]
		right, rightOK := order[result[j]]
		if leftOK && rightOK && left != right {
			return left < right
		}
		return result[i] < result[j]
	})
	return result
}

func smartRecommendationIntersection(left, right map[string]struct{}) int {
	if len(left) > len(right) {
		left, right = right, left
	}
	count := 0
	for id := range left {
		if _, exists := right[id]; exists {
			count++
		}
	}
	return count
}

func smartRecommendationIsDuplicate(left, right map[string]struct{}) bool {
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	intersection := smartRecommendationIntersection(left, right)
	containment := float64(intersection) / float64(min(len(left), len(right)))
	jaccard := float64(intersection) / float64(len(left)+len(right)-intersection)
	return containment >= smartRecommendationDuplicateContainment ||
		jaccard >= smartRecommendationDuplicateJaccard
}

func containsSmartDimension(dimensions []string, dimension string) bool {
	for _, current := range dimensions {
		if current == dimension {
			return true
		}
	}
	return false
}

func orderSmartEvidenceDimensions(dimensions []string) []string {
	order := map[string]int{
		SmartAlbumDimensionTime: 0, SmartAlbumDimensionPlace: 1,
		SmartAlbumDimensionPeople: 2, SmartAlbumDimensionScene: 3,
	}
	sort.Slice(dimensions, func(i, j int) bool { return order[dimensions[i]] < order[dimensions[j]] })
	return dimensions
}
