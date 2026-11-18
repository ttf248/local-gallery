package services

// 本文件管分组查询：人物列表、单个分组的详情、按相册过滤的分组、
// 照片数统计与复核排序。
//
// 列表不逐张访问媒体文件，照片数从当前快照汇总。

import (
	"container/heap"
	"crypto/sha256"
	"encoding/hex"
	"math"
	"sort"
	"strconv"
	"strings"
)

func (s *PeopleService) Groups(includeHidden bool) []PersonGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := make(map[string]*PersonGroup)
	photos := make(map[string]map[string]struct{})
	for _, face := range s.faces {
		id := s.effectivePersonIDLocked(face)
		group := groups[id]
		if group == nil {
			group = &PersonGroup{
				ID: id, Name: s.personNameLocked(id, ordinals),
				Confirmed: confirmed[id], Hidden: s.manual.Hidden[id],
			}
			groups[id] = group
			photos[id] = map[string]struct{}{}
		}
		group.FaceCount++
		photos[id][face.ResourceID] = struct{}{}
		if group.CoverResourceID == "" || face.ResourceID < group.CoverResourceID {
			group.CoverResourceID = face.ResourceID
		}
	}
	result := make([]PersonGroup, 0, len(groups))
	for id, group := range groups {
		group.PhotoCount = len(photos[id])
		if includeHidden || !group.Hidden {
			result = append(result, *group)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return peopleGroupRanksBefore(result[i], result[j])
	})
	return result
}

// AlbumGroups returns only people represented by files in the supplied album
// whose indexed file fingerprints still match the current media snapshot.
func (s *PeopleService) AlbumGroups(fingerprints map[string]smartAlbumFileFingerprint) []PeopleAlbumGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	type albumGroupState struct {
		group        PersonGroup
		photos       map[string]struct{}
		fingerprints []string
	}
	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := make(map[string]*albumGroupState)
	for resourceID, fingerprint := range fingerprints {
		for _, faceKey := range s.facesByResource[resourceID] {
			face, exists := s.faces[faceKey]
			if !exists || fingerprint.Size != face.Size || fingerprint.MTimeNs != face.MTimeNs {
				continue
			}
			personID := s.effectivePersonIDLocked(face)
			group := groups[personID]
			if group == nil {
				group = &albumGroupState{
					group: PersonGroup{
						ID: personID, Name: s.personNameLocked(personID, ordinals),
						Confirmed: confirmed[personID], Hidden: s.manual.Hidden[personID],
					},
					photos: make(map[string]struct{}),
				}
				groups[personID] = group
			}
			group.group.FaceCount++
			group.photos[face.ResourceID] = struct{}{}
			if group.group.CoverResourceID == "" || face.ResourceID < group.group.CoverResourceID {
				group.group.CoverResourceID = face.ResourceID
			}
			group.fingerprints = append(group.fingerprints, face.Key+"\x00"+face.recordHash)
		}
	}
	result := make([]PeopleAlbumGroup, 0, len(groups))
	for _, group := range groups {
		group.group.PhotoCount = len(group.photos)
		resourceIDs := make([]string, 0, len(group.photos))
		for resourceID := range group.photos {
			resourceIDs = append(resourceIDs, resourceID)
		}
		sort.Strings(resourceIDs)
		sort.Strings(group.fingerprints)
		hash := sha256.New()
		for _, value := range group.fingerprints {
			_, _ = hash.Write([]byte(value))
			_, _ = hash.Write([]byte{0})
		}
		result = append(result, PeopleAlbumGroup{
			Group: group.group, ResourceIDs: resourceIDs, Fingerprint: hex.EncodeToString(hash.Sum(nil)),
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].Group.Name == result[j].Group.Name {
			return result[i].Group.ID < result[j].Group.ID
		}
		return strings.ToLower(result[i].Group.Name) < strings.ToLower(result[j].Group.Name)
	})
	return result
}

// TopGroups aggregates current face records and returns the most photographed
// people. A nil resource filter includes every indexed resource; limit <= 0
// returns all matching groups.
func (s *PeopleService) TopGroups(limit int, includeHidden bool, includeResource func(string) bool) ([]PersonGroup, int) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := make(map[string]*PersonGroup)
	photos := make(map[string]map[string]struct{})
	for _, face := range s.faces {
		if includeResource != nil && !includeResource(face.ResourceID) {
			continue
		}
		id := s.effectivePersonIDLocked(face)
		if !includeHidden && s.manual.Hidden[id] {
			continue
		}
		group := groups[id]
		if group == nil {
			group = &PersonGroup{
				ID: id, Name: s.personNameLocked(id, ordinals),
				Confirmed: confirmed[id], Hidden: s.manual.Hidden[id],
			}
			groups[id] = group
			photos[id] = make(map[string]struct{})
		}
		group.FaceCount++
		photos[id][face.ResourceID] = struct{}{}
		if group.CoverResourceID == "" || face.ResourceID < group.CoverResourceID {
			group.CoverResourceID = face.ResourceID
		}
	}

	capacity := 0
	if limit > 0 {
		capacity = min(limit, len(s.faces))
	}
	selected := make(peopleGroupHeap, 0, capacity)
	if limit > 0 {
		heap.Init(&selected)
	}
	result := make([]PersonGroup, 0, len(groups))
	total := 0
	for id, group := range groups {
		group.PhotoCount = len(photos[id])
		if !includeHidden && group.Hidden {
			continue
		}
		total++
		if limit <= 0 {
			result = append(result, *group)
			continue
		}
		if len(selected) < limit {
			heap.Push(&selected, *group)
			continue
		}
		if peopleGroupRanksBefore(*group, selected[0]) {
			selected[0] = *group
			heap.Fix(&selected, 0)
		}
	}
	if limit > 0 {
		result = append(result, selected...)
	}
	sort.Slice(result, func(i, j int) bool {
		return peopleGroupRanksBefore(result[i], result[j])
	})
	return result, total
}

// SearchGroups returns a bounded set of people matching a display name or ID.
// An empty query returns the most photographed groups, which gives merge dialogs
// useful initial choices without sending the full people index to the browser.
func (s *PeopleService) SearchGroups(query string, limit int, includeHidden bool, includeResource func(string) bool) ([]PersonGroup, int) {
	return s.searchGroups(query, limit, includeHidden, includeResource, false)
}

// SearchGroupsForReview orders groups by the weakest lower-tail similarity
// evidence so users can inspect uncertain groups before large but consistent ones.
func (s *PeopleService) SearchGroupsForReview(query string, limit int, includeHidden bool, includeResource func(string) bool) ([]PersonGroup, int) {
	return s.searchGroups(query, limit, includeHidden, includeResource, true)
}

func (s *PeopleService) searchGroups(query string, limit int, includeHidden bool, includeResource func(string) bool, reviewOrder bool) ([]PersonGroup, int) {
	query = strings.ToLower(strings.TrimSpace(query))
	if query == "人物" {
		query = ""
	}
	if strings.HasPrefix(query, "人物 ") {
		rest := strings.TrimSpace(strings.TrimPrefix(query, "人物 "))
		// 「人物 3」就是分组的名字本身，别把它剥成「3」：那会连
		// 「人物 13」「人物 30」一起搜出来。要按旧名字搜的人才写全名。
		if !isDigitsOnly(rest) {
			query = rest
		}
	}
	if query == "" && !reviewOrder {
		return s.TopGroups(limit, includeHidden, includeResource)
	}
	if limit <= 0 {
		limit = 20
	}

	s.mu.RLock()
	defer s.mu.RUnlock()
	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := make(map[string]*PersonGroup)
	photos := make(map[string]map[string]struct{})
	qualitySamples := make(map[string]*peopleGroupQualitySamples)
	for _, face := range s.faces {
		if includeResource != nil && !includeResource(face.ResourceID) {
			continue
		}
		id := s.effectivePersonIDLocked(face)
		if !includeHidden && s.manual.Hidden[id] {
			continue
		}
		name := s.personNameLocked(id, ordinals)
		if !strings.Contains(strings.ToLower(name), query) && !strings.Contains(strings.ToLower(id), query) {
			continue
		}
		group := groups[id]
		if group == nil {
			group = &PersonGroup{ID: id, Name: name, Confirmed: confirmed[id], Hidden: s.manual.Hidden[id]}
			groups[id] = group
			photos[id] = make(map[string]struct{})
		}
		group.FaceCount++
		photos[id][face.ResourceID] = struct{}{}
		if group.CoverResourceID == "" || face.ResourceID < group.CoverResourceID {
			group.CoverResourceID = face.ResourceID
		}
		if reviewOrder {
			samples := qualitySamples[id]
			if samples == nil {
				samples = &peopleGroupQualitySamples{sum: make([]float64, len(face.embedding))}
				if cluster := s.clusters[id]; cluster != nil {
					samples.anchor = cluster.anchor.embedding
				}
				qualitySamples[id] = samples
			}
			samples.members = append(samples.members, face)
			for index, value := range face.embedding {
				samples.sum[index] += float64(value)
			}
			if face.Score > samples.fallback.Score || samples.fallback.Key == "" ||
				(face.Score == samples.fallback.Score && face.Key < samples.fallback.Key) {
				samples.fallback = face
			}
		}
	}
	if reviewOrder {
		result := make([]PersonGroup, 0, len(groups))
		for id, group := range groups {
			group.PhotoCount = len(photos[id])
			if samples := qualitySamples[id]; samples != nil {
				group.Quality = samples.summarize()
			}
			result = append(result, *group)
		}
		sort.Slice(result, func(i, j int) bool {
			return peopleGroupReviewRanksBefore(result[i], result[j])
		})
		total := len(result)
		if len(result) > limit {
			result = result[:limit]
		}
		return result, total
	}

	selected := make(peopleGroupHeap, 0, min(limit, len(groups)))
	heap.Init(&selected)
	total := 0
	for _, group := range groups {
		group.PhotoCount = len(photos[group.ID])
		total++
		if len(selected) < limit {
			heap.Push(&selected, *group)
			continue
		}
		if peopleGroupRanksBefore(*group, selected[0]) {
			selected[0] = *group
			heap.Fix(&selected, 0)
		}
	}
	result := append(make([]PersonGroup, 0, len(selected)), selected...)
	sort.Slice(result, func(i, j int) bool {
		return peopleGroupRanksBefore(result[i], result[j])
	})
	return result, total
}

// GroupAndFaces returns one group's current summary and its faces in one pass.
func (s *PeopleService) GroupAndFaces(personID string) (PersonGroup, []PersonFace, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	group := PersonGroup{
		ID: personID, Name: s.personNameLocked(personID, s.personOrdinalNamesLocked()),
		Confirmed: peopleConfirmedPersonIDs(s.manual)[personID], Hidden: s.manual.Hidden[personID],
	}
	photos := make(map[string]struct{})
	faces := make([]PersonFace, 0)
	for _, face := range s.faces {
		if s.effectivePersonIDLocked(face) != personID {
			continue
		}
		group.FaceCount++
		photos[face.ResourceID] = struct{}{}
		if group.CoverResourceID == "" || face.ResourceID < group.CoverResourceID {
			group.CoverResourceID = face.ResourceID
		}
		face.PersonID = personID
		face.embedding = nil
		face.recordHash = ""
		faces = append(faces, face)
	}
	if group.FaceCount == 0 {
		return PersonGroup{}, nil, false
	}
	group.PhotoCount = len(photos)
	sort.Slice(faces, func(i, j int) bool {
		if faces[i].ResourceID == faces[j].ResourceID {
			return faces[i].FaceIndex < faces[j].FaceIndex
		}
		return faces[i].ResourceID < faces[j].ResourceID
	})
	return group, faces, true
}

// personOrdinalNamesLocked 给未改名的分组算出序数名。
//
// 未改名的分组原先拿哈希后缀当名字（「人物 513e12」）：那是内部标识，
// 摆到界面上既读不懂，也分不出先后。改成按展示顺序编号 —— 照片多的在前 ——
// 名字至少说得出「这是第几个」。序数会随分组集合变化而重排：分组多了少了，
// 后面那些的号跟着挪。这是可接受的 —— 用户一旦改名就固定下来
// （改名存在 state/people.json）。
func (s *PeopleService) personOrdinalNamesLocked() map[string]string {
	photos := make(map[string]map[string]struct{})
	covers := make(map[string]string)
	for _, face := range s.faces {
		id := s.effectivePersonIDLocked(face)
		if photos[id] == nil {
			photos[id] = make(map[string]struct{})
		}
		photos[id][face.ResourceID] = struct{}{}
		if cover, ok := covers[id]; !ok || face.ResourceID < cover {
			covers[id] = face.ResourceID
		}
	}
	ids := make([]string, 0, len(photos))
	for id := range photos {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		left, right := ids[i], ids[j]
		if len(photos[left]) != len(photos[right]) {
			return len(photos[left]) > len(photos[right])
		}
		if covers[left] != covers[right] {
			return covers[left] < covers[right]
		}
		return left < right
	})
	names := make(map[string]string, len(ids))
	number := 0
	for _, id := range ids {
		if s.manual.Names[id] != "" {
			// 用户改过名的分组不占号：没改名的那些连着排下去，
			// 中间有人改名也不会让「人物 1」「人物 2」断开。
			continue
		}
		number++
		names[id] = "人物 " + strconv.Itoa(number)
	}
	return names
}

// isDigitsOnly 判断一段文本是不是只有数字（且非空）。
func isDigitsOnly(value string) bool {
	if value == "" {
		return false
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

func (s *PeopleService) personNameLocked(personID string, ordinals map[string]string) string {
	if name := s.manual.Names[personID]; name != "" {
		return name
	}
	if name, ok := ordinals[personID]; ok {
		return name
	}
	suffix := strings.TrimPrefix(personID, "p_")
	return "人物 " + suffix[:min(6, len(suffix))]
}

func peopleGroupRanksBefore(left, right PersonGroup) bool {
	if left.Confirmed != right.Confirmed {
		return left.Confirmed
	}
	if left.PhotoCount != right.PhotoCount {
		return left.PhotoCount > right.PhotoCount
	}
	if left.CoverResourceID != right.CoverResourceID {
		return left.CoverResourceID < right.CoverResourceID
	}
	return left.ID < right.ID
}

func peopleConfirmedPersonIDs(state peopleManualState) map[string]bool {
	confirmed := make(map[string]bool, len(state.Names)+len(state.Assignments)+len(state.RetainedGroups))
	for id, name := range state.Names {
		if name != "" {
			confirmed[id] = true
		}
	}
	for _, id := range state.Assignments {
		if id != "" {
			confirmed[id] = true
		}
	}
	for id, retained := range state.RetainedGroups {
		if retained {
			confirmed[id] = true
		}
	}
	return confirmed
}

type peopleGroupHeap []PersonGroup

func (groups peopleGroupHeap) Len() int { return len(groups) }

func (groups peopleGroupHeap) Less(i, j int) bool {
	return peopleGroupRanksBefore(groups[j], groups[i])
}

func (groups peopleGroupHeap) Swap(i, j int) { groups[i], groups[j] = groups[j], groups[i] }

func (groups *peopleGroupHeap) Push(value any) {
	*groups = append(*groups, value.(PersonGroup))
}

func (groups *peopleGroupHeap) Pop() any {
	previous := *groups
	last := previous[len(previous)-1]
	*groups = previous[:len(previous)-1]
	return last
}

func (s *PeopleService) Faces(personID string) []PersonFace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]PersonFace, 0)
	for _, face := range s.faces {
		if s.effectivePersonIDLocked(face) != personID {
			continue
		}
		face.PersonID = personID
		face.embedding = nil
		face.recordHash = ""
		result = append(result, face)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].ResourceID == result[j].ResourceID {
			return result[i].FaceIndex < result[j].FaceIndex
		}
		return result[i].ResourceID < result[j].ResourceID
	})
	return result
}

func (s *PeopleService) AllFaces() []PersonFace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]PersonFace, 0, len(s.faces))
	for _, face := range s.faces {
		face.PersonID = s.effectivePersonIDLocked(face)
		face.embedding = nil
		face.recordHash = ""
		result = append(result, face)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].PersonID == result[j].PersonID {
			if result[i].ResourceID == result[j].ResourceID {
				return result[i].FaceIndex < result[j].FaceIndex
			}
			return result[i].ResourceID < result[j].ResourceID
		}
		return result[i].PersonID < result[j].PersonID
	})
	return result
}

// GroupPhotoStats counts each group's distinct current photos and classifies
// group photos using both detected face count and normalized face size. The
// callback excludes resources outside the current photo library.
func (s *PeopleService) GroupPhotoStats(includeResource func(string) bool, faceCountThreshold int) map[string]PersonGroupPhotoStats {
	s.mu.RLock()
	faces := make([]PersonFace, 0, len(s.faces))
	dimensionsLookup := s.sourceDimensions
	for _, face := range s.faces {
		face.PersonID = s.effectivePersonIDLocked(face)
		face.embedding = nil
		face.recordHash = ""
		faces = append(faces, face)
	}
	s.mu.RUnlock()

	stats := make(map[string]PersonGroupPhotoStats)
	facesByResource := make(map[string][]PersonFace)
	dimensionsByResource := make(map[string]MediaDimensions)
	resourcesByGroup := make(map[string]map[string][]PersonFace)
	for _, face := range faces {
		if includeResource != nil && !includeResource(face.ResourceID) {
			continue
		}
		facesByResource[face.ResourceID] = append(facesByResource[face.ResourceID], face)
		groupID := face.PersonID
		if resourcesByGroup[groupID] == nil {
			resourcesByGroup[groupID] = make(map[string][]PersonFace)
		}
		resourcesByGroup[groupID][face.ResourceID] = append(resourcesByGroup[groupID][face.ResourceID], face)
	}
	groupPhotos := make(map[string]bool, len(facesByResource))
	for resourceID, resourceFaces := range facesByResource {
		groupPhoto := len(resourceFaces) > faceCountThreshold
		faceSizes := make([]float64, 0, len(resourceFaces))
		if dimensionsLookup != nil {
			dimensions := dimensionsLookup(resourceID)
			dimensionsByResource[resourceID] = dimensions
			if dimensions.Known() {
				longSide := float64(max(dimensions.Width, dimensions.Height))
				for _, face := range resourceFaces {
					if len(face.Box) >= 4 && longSide > 0 {
						faceSizes = append(faceSizes, float64(max(face.Box[2], face.Box[3]))/longSide)
					}
				}
			}
		}
		if !groupPhoto && len(resourceFaces) >= PeopleGroupPhotoMinimumFaces && len(faceSizes) > 0 &&
			peopleP50(faceSizes) <= PeopleGroupPhotoRelativeFaceSizeThreshold {
			groupPhoto = true
		}
		groupPhotos[resourceID] = groupPhoto
	}
	for groupID, resources := range resourcesByGroup {
		groupStats := PersonGroupPhotoStats{PhotoCount: len(resources)}
		faceSizes := make([]float64, 0)
		detectionScores := make([]float64, 0)
		for resourceID, groupFaces := range resources {
			if groupPhotos[resourceID] {
				groupStats.LargeGroupPhotoCount++
			} else {
				groupStats.OrdinaryPhotoCount++
			}
			if dimensionsLookup != nil {
				dimensions := dimensionsByResource[resourceID]
				if dimensions.Known() {
					longSide := float64(max(dimensions.Width, dimensions.Height))
					for _, face := range groupFaces {
						if len(face.Box) >= 4 && longSide > 0 {
							faceSizes = append(faceSizes, float64(max(face.Box[2], face.Box[3]))/longSide)
						}
					}
				}
			}
			for _, face := range groupFaces {
				detectionScores = append(detectionScores, float64(face.Score))
			}
		}
		groupStats.RelativeFaceSizeP10 = peopleP10(faceSizes)
		groupStats.DetectionP10 = peopleP10(detectionScores)
		stats[groupID] = groupStats
	}
	return stats
}

func peopleP50(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sort.Float64s(values)
	return values[(len(values)-1)/2]
}

func (s *PeopleService) FacesLocked(personID string) int {
	count := 0
	for _, face := range s.faces {
		if s.effectivePersonIDLocked(face) == personID {
			count++
		}
	}
	return count
}

// ResourceFaces returns every detected face in one resource.
// The annotation view needs the raw detections to show boxes beside the
// human labels; it never modifies them.
func (s *PeopleService) ResourceFaces(resourceID string) []PersonFace {
	s.mu.RLock()
	defer s.mu.RUnlock()
	faces := s.facesForResourceLocked(resourceID)
	result := make([]PersonFace, len(faces))
	copy(result, faces)
	return result
}

// PeopleGroupBestSimilarity returns the highest face similarity between two
// groups. The evaluation tool uses it to explain why a duplicate pair was not
// surfaced.
func PeopleGroupBestSimilarity(people *PeopleService, leftID, rightID string) float64 {
	people.mu.RLock()
	defer people.mu.RUnlock()
	left := people.groupFacesLocked(leftID)
	right := people.groupFacesLocked(rightID)
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	best := 0.0
	for _, leftFace := range left {
		for _, rightFace := range right {
			similarity := peopleCosine(leftFace.embedding, rightFace.embedding)
			if similarity > best {
				best = similarity
			}
		}
	}
	return math.Round(best*1000) / 1000
}

// PeopleGroupInternalSimilarity returns the lower tenth of the within-group
// face similarities. It shows how consistent a group is on its own, which is
// the yardstick for judging whether an outside face belongs to it.
func PeopleGroupInternalSimilarity(people *PeopleService, groupID string) float64 {
	people.mu.RLock()
	defer people.mu.RUnlock()
	faces := people.groupFacesLocked(groupID)
	if len(faces) < 2 {
		return 0
	}
	scores := make([]float64, 0, len(faces))
	for index, face := range faces {
		best := 0.0
		for otherIndex, other := range faces {
			if otherIndex == index {
				continue
			}
			similarity := peopleCosine(face.embedding, other.embedding)
			if similarity > best {
				best = similarity
			}
		}
		scores = append(scores, best)
	}
	sort.Float64s(scores)
	return math.Round(scores[int(math.Floor(float64(len(scores)-1)*0.1))]*1000) / 1000
}

func (s *PeopleService) groupFacesLocked(personID string) []PersonFace {
	result := make([]PersonFace, 0)
	for _, face := range s.faces {
		if s.effectivePersonIDLocked(face) == personID {
			result = append(result, face)
		}
	}
	return result
}
