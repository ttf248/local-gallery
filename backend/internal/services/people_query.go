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

// peopleGroupList 按人脸汇总出分组。
//
// include 决定哪些脸计入（资源过滤与隐藏分组由调用方给）。
// 照片数是「出现在多少张不同的照片里」：同一张照片里同一个人的两张脸
// 只算一张。用（分组, 照片）组成键去重，而不是给每个分组各建一张表 ——
// 后者在一万张脸上要几万次分配，而分组列表每次请求都要算一遍。
func peopleGroupList(
	faces map[string]PersonFace,
	effective func(PersonFace) string,
	include func(resourceID, personID string) bool,
) map[string]*PersonGroup {
	groups := make(map[string]*PersonGroup)
	photos := make(map[string]int)
	seen := make(map[peopleGroupResource]struct{}, len(faces))
	// 归属分组先记下来：第二遍要为每组挑代表脸，不必再算一次归属。
	effectiveIDs := make(map[string]string, len(faces))
	for _, face := range faces {
		id := effective(face)
		if include != nil && !include(face.ResourceID, id) {
			continue
		}
		effectiveIDs[face.Key] = id
		group := groups[id]
		if group == nil {
			group = &PersonGroup{ID: id}
			groups[id] = group
		}
		group.FaceCount++
		key := peopleGroupResource{group: id, resource: face.ResourceID}
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			photos[id]++
			if group.CoverResourceID == "" || face.ResourceID < group.CoverResourceID {
				group.CoverResourceID = face.ResourceID
			}
		}
	}
	// 代表脸：封面照片里最大、最清晰的那张脸。
	//
	// 封面照片是按资源 ID 最小的那一张定的 —— 确定性强，但那张照片里
	// 可能有好几张脸。第二遍只在该组的那张封面里挑，挑完再定，
	// 因此结果与遍历顺序无关。
	coverFaces := make(map[string]PersonFace, len(groups))
	for key, face := range faces {
		id := effectiveIDs[key]
		if id == "" {
			continue
		}
		group := groups[id]
		if group == nil || face.ResourceID != group.CoverResourceID {
			continue
		}
		if len(face.Box) != 4 || face.Box[2] <= 0 || face.Box[3] <= 0 {
			continue
		}
		current, exists := coverFaces[id]
		if !exists || personFaceMoreProminent(face, current) {
			coverFaces[id] = face
		}
	}
	for id, face := range coverFaces {
		if len(face.Box) != 4 {
			continue
		}
		groups[id].CoverFace = &PersonCoverFace{
			ResourceID: face.ResourceID,
			Box:        append([]float32(nil), face.Box...),
		}
	}
	for id, group := range groups {
		group.PhotoCount = photos[id]
	}
	return groups
}

// personFaceMoreProminent 判断两张脸哪一张更适合当代表脸。
//
// 先看脸在画面里有多大 —— 大脸认得出人，小脸只是一团模糊；
// 一样大再看检测分；都一样就按稳定键取小的那个，结果与顺序无关。
func personFaceMoreProminent(candidate, current PersonFace) bool {
	candidateArea := float64(candidate.Box[2]) * float64(candidate.Box[3])
	currentArea := float64(current.Box[2]) * float64(current.Box[3])
	if candidateArea != currentArea {
		return candidateArea > currentArea
	}
	if candidate.Score != current.Score {
		return candidate.Score > current.Score
	}
	return candidate.Key < current.Key
}

// fillCoverFaceSizes 补齐代表脸的原图尺寸。
//
// 尺寸是按需查的（读一次图片头），所以只给**要返回给界面的**那几组补，
// 不给全库几千个分组补。原图尺寸拿不到时留空，界面退回整张封面。
func (s *PeopleService) fillCoverFaceSizes(groups []PersonGroup) {
	if s.sourceDimensions == nil {
		return
	}
	for i := range groups {
		face := groups[i].CoverFace
		if face == nil || face.Width > 0 && face.Height > 0 {
			continue
		}
		dimensions := s.sourceDimensions(face.ResourceID)
		if !dimensions.Known() {
			continue
		}
		face.Width = dimensions.Width
		face.Height = dimensions.Height
	}
}

func (s *PeopleService) Groups(includeHidden bool) []PersonGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := peopleGroupList(s.faces, s.effectivePersonIDLocked, nil)
	result := make([]PersonGroup, 0, len(groups))
	for id, group := range groups {
		group.Name = s.personNameLocked(id, ordinals)
		group.Confirmed = confirmed[id]
		group.Hidden = s.manual.Hidden[id]
		if includeHidden || !group.Hidden {
			result = append(result, *group)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		return peopleGroupRanksBefore(result[i], result[j])
	})
	s.fillCoverFaceSizes(result)
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
	groups := peopleGroupList(s.faces, s.effectivePersonIDLocked, func(resourceID, personID string) bool {
		if includeResource != nil && !includeResource(resourceID) {
			return false
		}
		return includeHidden || !s.manual.Hidden[personID]
	})
	for id, group := range groups {
		group.Name = s.personNameLocked(id, ordinals)
		group.Confirmed = confirmed[id]
		group.Hidden = s.manual.Hidden[id]
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
	for _, group := range groups {
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
	s.fillCoverFaceSizes(result)
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
		s.fillCoverFaceSizes(result)
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
	s.fillCoverFaceSizes(result)
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
// peopleGroupResource 标识「某个分组出现在某张照片里」。
type peopleGroupResource struct {
	group    string
	resource string
}

// peopleGroupSummary 是一个分组的汇总。
type peopleGroupSummary struct {
	// PhotoCount 是这个分组出现在多少张不同的照片里。
	PhotoCount int
	// CoverResourceID 是其中最小的那个资源 ID。
	CoverResourceID string
	// FaceCount 是这个分组的人脸总数。
	FaceCount int
}

// peopleGroupSummaries 一次扫完人脸，给出每个分组的照片数、封面与人脸数。
//
// 照片数是「出现在多少张不同的照片里」：同一张照片里同一个人的两张脸
// 只算一张。用（分组, 照片）组成键去重，而不是给每个分组各建一张表 ——
// 后者在一万张脸上要几万次分配，而分组列表每次请求都要算一遍。
func peopleGroupSummaries(faces map[string]PersonFace, effective func(PersonFace) string) map[string]peopleGroupSummary {
	seen := make(map[peopleGroupResource]struct{}, len(faces))
	summaries := make(map[string]peopleGroupSummary, len(faces)/4)
	for _, face := range faces {
		id := effective(face)
		key := peopleGroupResource{group: id, resource: face.ResourceID}
		summary := summaries[id]
		summary.FaceCount++
		if _, exists := seen[key]; !exists {
			seen[key] = struct{}{}
			summary.PhotoCount++
			if summary.CoverResourceID == "" || face.ResourceID < summary.CoverResourceID {
				summary.CoverResourceID = face.ResourceID
			}
		}
		summaries[id] = summary
	}
	return summaries
}

func (s *PeopleService) personOrdinalNamesLocked() map[string]string {
	summaries := peopleGroupSummaries(s.faces, s.effectivePersonIDLocked)
	ids := make([]string, 0, len(summaries))
	for id := range summaries {
		ids = append(ids, id)
	}
	sort.Slice(ids, func(i, j int) bool {
		left, right := ids[i], ids[j]
		if summaries[left].PhotoCount != summaries[right].PhotoCount {
			return summaries[left].PhotoCount > summaries[right].PhotoCount
		}
		if summaries[left].CoverResourceID != summaries[right].CoverResourceID {
			return summaries[left].CoverResourceID < summaries[right].CoverResourceID
		}
		return left < right
	})
	names := make(map[string]string, len(ids))
	number := 0
	// 名字一次拼好：每组两次分配（数字与拼接）在这个列表页上是白花的。
	nameBuffer := make([]byte, 0, 16)
	for _, id := range ids {
		if s.manual.Names[id] != "" {
			// 用户改过名的分组不占号：没改名的那些连着排下去，
			// 中间有人改名也不会让「人物 1」「人物 2」断开。
			continue
		}
		number++
		nameBuffer = append(nameBuffer[:0], "人物 "...)
		nameBuffer = strconv.AppendInt(nameBuffer, int64(number), 10)
		names[id] = string(nameBuffer)
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

// peoplePhotoFace 是照片统计要用到的那张脸。
//
// 统计只需要资源、分组、框与检测分，所以用一条轻量记录代替整张 PersonFace：
// 整张复制会把特征向量与记录哈希也带着走，一次列表请求就要复制一遍全量人脸。
type peoplePhotoFace struct {
	resourceID string
	groupID    string
	box        []float32
	score      float32
}

// PersonGroupPhotoClassification 是一个分组的照片分类。
//
// 照片数是「出现在多少张不同的照片里」，合影与普通照片按资源分类。
// 相对脸尺寸与检测分的分位数要另算，见 GroupPhotoStats。
type PersonGroupPhotoClassification struct {
	PhotoCount           int
	LargeGroupPhotoCount int
	OrdinaryPhotoCount   int
}

// GroupPhotoClassifications 只算每个分组的照片数与合影分类。
//
// 合影判定分三档：脸数超过门槛就是合影，脸数不足八张就不是合影，
// 只有中间那一档要看人脸相对尺寸。而查原图尺寸要落盘校验路径，
// 六千张脸的照片就是一秒多 —— 所以这一档之外不去查尺寸。
// 判定口径与 GroupPhotoStats 一致，两者的分类结果逐项相同。
func (s *PeopleService) GroupPhotoClassifications(includeResource func(string) bool, faceCountThreshold int) map[string]PersonGroupPhotoClassification {
	classes, _ := s.groupPhotoStats(includeResource, faceCountThreshold, false, nil)
	return classes
}

// GroupPhotoStats counts each group's distinct current photos and classifies
// group photos using both detected face count and normalized face size. The
// callback excludes resources outside the current photo library.
//
// 相对脸尺寸的分位数要遍历每个资源的原图尺寸，所以这个口径比
// GroupPhotoClassifications 慢得多：只需要分类的调用方用后者。
func (s *PeopleService) GroupPhotoStats(includeResource func(string) bool, faceCountThreshold int) map[string]PersonGroupPhotoStats {
	_, stats := s.groupPhotoStats(includeResource, faceCountThreshold, true, nil)
	return stats
}

// GroupPhotoStatsForGroups 返回指定分组的照片统计。
//
// 人脸相对尺寸的分位数只给这些分组算：范围外的分组不必查原图尺寸。
// 先用 GroupPhotoClassifications 挑出要看的分组，再调这个，
// 比对全部分组都算一遍少一次落盘。
func (s *PeopleService) GroupPhotoStatsForGroups(includeResource func(string) bool, faceCountThreshold int, groups map[string]struct{}) map[string]PersonGroupPhotoStats {
	_, stats := s.groupPhotoStats(includeResource, faceCountThreshold, true, groups)
	return stats
}

// groupPhotoStats 是三种口径的共同实现。
//
// withSizes 决定要不要算人脸相对尺寸；sizeGroups 限定只给这些分组算，
// 为空表示全部分组都要算。判定合影始终只看「脸数在八张到门槛之间」
// 那一档的资源尺寸 —— 那一档之外的资源不必为分类付出查尺寸的代价。
func (s *PeopleService) groupPhotoStats(includeResource func(string) bool, faceCountThreshold int, withSizes bool, sizeGroups map[string]struct{}) (map[string]PersonGroupPhotoClassification, map[string]PersonGroupPhotoStats) {
	s.mu.RLock()
	faces := make([]peoplePhotoFace, 0, len(s.faces))
	dimensionsLookup := s.sourceDimensions
	for _, face := range s.faces {
		faces = append(faces, peoplePhotoFace{
			resourceID: face.ResourceID,
			groupID:    s.effectivePersonIDLocked(face),
			box:        face.Box,
			score:      face.Score,
		})
	}
	s.mu.RUnlock()

	// 先数一遍每个资源、每个分组各有多少张脸。
	// 后面按这个数量预分配缓冲，避免切片反复扩容。
	resourceFaceCounts := make(map[string]int)
	groupFaceCounts := make(map[string]int)
	for _, face := range faces {
		if includeResource != nil && !includeResource(face.resourceID) {
			continue
		}
		resourceFaceCounts[face.resourceID]++
		groupFaceCounts[face.groupID]++
	}

	// 要查原图尺寸的资源：判定合影只看「脸数在八张到门槛之间」那一档；
	// 还要算分组的人脸相对尺寸时，再加上要算尺寸的那些分组的资源。
	needsSizes := make(map[string]bool, len(resourceFaceCounts))
	for resourceID, faceCount := range resourceFaceCounts {
		if withSizes && sizeGroups == nil {
			// 全部分组都要算尺寸时，每个资源都得查一遍原图尺寸。
			needsSizes[resourceID] = true
			continue
		}
		if faceCount >= PeopleGroupPhotoMinimumFaces && faceCount <= faceCountThreshold {
			needsSizes[resourceID] = true
		}
	}
	if withSizes && sizeGroups != nil {
		for _, face := range faces {
			if includeResource != nil && !includeResource(face.resourceID) {
				continue
			}
			if _, wanted := sizeGroups[face.groupID]; wanted {
				needsSizes[face.resourceID] = true
			}
		}
	}

	// 每个分组出现的资源：照片数按资源算，不按脸算。
	groupResources := make(map[peopleGroupResource]struct{}, len(groupFaceCounts))
	// 每个分组的相对脸尺寸与检测分，列表要展示这两项的分位数。
	groupSizes := make(map[string][]float64, len(groupFaceCounts))
	groupScores := make(map[string][]float64, len(groupFaceCounts))
	for groupID, count := range groupFaceCounts {
		groupSizes[groupID] = make([]float64, 0, count)
		groupScores[groupID] = make([]float64, 0, count)
	}
	// 每个资源里所有脸的相对尺寸：判定合影要用该资源的脸数与尺寸中位数。
	resourceSizes := make(map[string][]float64, len(resourceFaceCounts))

	longSideByResource := make(map[string]float64, len(resourceFaceCounts))
	longSideOf := func(resourceID string) float64 {
		if longSide, ok := longSideByResource[resourceID]; ok {
			return longSide
		}
		longSide := 0.0
		if dimensionsLookup != nil {
			dimensions := dimensionsLookup(resourceID)
			if dimensions.Known() {
				longSide = float64(max(dimensions.Width, dimensions.Height))
			}
		}
		longSideByResource[resourceID] = longSide
		return longSide
	}

	for _, face := range faces {
		if includeResource != nil && !includeResource(face.resourceID) {
			continue
		}
		groupID := face.groupID
		groupScores[groupID] = append(groupScores[groupID], float64(face.score))
		groupResources[peopleGroupResource{group: groupID, resource: face.resourceID}] = struct{}{}
		if !needsSizes[face.resourceID] {
			continue
		}
		longSide := longSideOf(face.resourceID)
		if longSide <= 0 || len(face.box) < 4 {
			continue
		}
		size := float64(max(face.box[2], face.box[3])) / longSide
		if withSizes && (sizeGroups == nil || groupInScope(sizeGroups, groupID)) {
			groupSizes[groupID] = append(groupSizes[groupID], size)
		}
		sizes := resourceSizes[face.resourceID]
		if sizes == nil {
			sizes = make([]float64, 0, resourceFaceCounts[face.resourceID])
		}
		resourceSizes[face.resourceID] = append(sizes, size)
	}

	groupPhotos := make(map[string]bool, len(resourceFaceCounts))
	for resourceID, faceCount := range resourceFaceCounts {
		groupPhoto := faceCount > faceCountThreshold
		sizes := resourceSizes[resourceID]
		if !groupPhoto && faceCount >= PeopleGroupPhotoMinimumFaces && len(sizes) > 0 &&
			peopleP50(sizes) <= PeopleGroupPhotoRelativeFaceSizeThreshold {
			groupPhoto = true
		}
		groupPhotos[resourceID] = groupPhoto
	}

	photoCountByGroup := make(map[string]int, len(groupFaceCounts))
	largeCountByGroup := make(map[string]int, len(groupFaceCounts))
	for key := range groupResources {
		photoCountByGroup[key.group]++
		if groupPhotos[key.resource] {
			largeCountByGroup[key.group]++
		}
	}

	classes := make(map[string]PersonGroupPhotoClassification, len(groupFaceCounts))
	stats := make(map[string]PersonGroupPhotoStats, len(groupFaceCounts))
	for groupID := range groupFaceCounts {
		largeCount := largeCountByGroup[groupID]
		classes[groupID] = PersonGroupPhotoClassification{
			PhotoCount:           photoCountByGroup[groupID],
			LargeGroupPhotoCount: largeCount,
			OrdinaryPhotoCount:   photoCountByGroup[groupID] - largeCount,
		}
		if withSizes && (sizeGroups == nil || groupInScope(sizeGroups, groupID)) {
			stats[groupID] = PersonGroupPhotoStats{
				PhotoCount:           photoCountByGroup[groupID],
				LargeGroupPhotoCount: largeCount,
				OrdinaryPhotoCount:   photoCountByGroup[groupID] - largeCount,
				RelativeFaceSizeP10:  peopleP10(groupSizes[groupID]),
				DetectionP10:         peopleP10(groupScores[groupID]),
			}
		}
	}
	return classes, stats
}

// groupInScope 判断分组是否在要算尺寸的范围内。
func groupInScope(scope map[string]struct{}, groupID string) bool {
	_, ok := scope[groupID]
	return ok
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
