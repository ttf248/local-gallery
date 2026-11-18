package services

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	// peopleMatchSourceMaximumPhotoCount 划出「待确认匹配」的来源范围。
	// 过去只收 1～2 张的小组，3～9 张的重复人物既不在待确认里，
	// 也不在常见人物里，等于凭空消失。
	peopleMatchSourceMaximumPhotoCount = 9
	// peopleMatchTargetMinimumPhotos 与 peopleMatchTargetMinimumFaces 是
	// 稳定目标组的准入门槛。旧门槛要求 10 张脸，3～9 张的重复人物
	// 既当不了来源也当不了目标，只能各自沉默。
	peopleMatchTargetMinimumPhotos = 3
	peopleMatchTargetMinimumFaces  = 3
	// peopleMatchRelationCentroidThreshold 是记录「可能重复」关系时的宽松门槛。
	// 真正的判定交给多代表脸精确复核；这里只负责不漏。
	peopleMatchRelationCentroidThreshold = 0.62
	peopleMatchRelationLimit             = 48
	peopleMatchRelationSearchEf          = 64
	// peopleMatchSourceFaceSearchLimit 限制一次复核里按代表脸补搜的次数。
	peopleMatchSourceFaceSearchLimit  = 4
	peopleMatchANNTopK                = 32
	peopleMatchANNFaceTopK            = 24
	peopleMatchExactCandidateLimit    = 12
	peopleMatchMaximumRepresentatives = 16
	peopleMatchCandidatesPerGroup     = 3
	peopleMatchSinglePhotoThreshold   = 0.82
	peopleMatchAmbiguousMargin        = 0.035
	// peopleMatchStrongMargin 是「最优与次优差多少才敢算证据充分」。
	peopleMatchStrongMargin = 0.05
	// peopleMatchSmallFaceAreaThreshold 是「脸部只占画面这么小」的相对面积门槛。
	peopleMatchSmallFaceAreaThreshold = 0.01
	// peopleMatchSimilaritySpreadLimit 是组内代表脸相似度的离散度上限。
	peopleMatchSimilaritySpreadLimit = 0.12
	// peopleMatchMaximumYearGapYears 是提示「拍摄年份相隔太远」的年限门槛。
	// 跨年龄的同一个人必须仍然能被合并，因此它只影响风险评级。
	peopleMatchMaximumYearGapYears = 12
	// peopleMatchStrongEvidencePairs 是「证据充分」所需的独立照片对数。
	peopleMatchStrongEvidencePairs = 3
	// peopleMatchMinimumCorroboration 是弱证据候选需要的印证张数：
	// 目标组至少要在两张不同的照片上与来源组的那张脸相像。
	peopleMatchMinimumCorroboration = 2
	// peopleMatchInternalSlack 是外部脸相对目标组内部一致性的容忍幅度。
	peopleMatchInternalSlack = 0.10
)

const (
	peopleMatchRiskLow    = "low"
	peopleMatchRiskMedium = "medium"
	peopleMatchRiskHigh   = "high"
)

// PeopleMatchPolicy 决定哪些分组进入待确认复核、以及哪些分组能当合并目标。
//
// 默认值覆盖 1～9 张照片的来源组与至少 3 张脸、3 张照片的目标组。评测工具
// 会用旧口径再跑一遍，以便在同一份标注集上做前后对照。
type PeopleMatchPolicy struct {
	// SourceMaximumPhotoCount 是来源组照片数的上限。
	SourceMaximumPhotoCount int
	// TargetMinimumPhotos 与 TargetMinimumFaces 是目标组的准入门槛。
	TargetMinimumPhotos int
	TargetMinimumFaces  int
}

// DefaultPeopleMatchPolicy 是生产使用的复核口径。
func DefaultPeopleMatchPolicy() PeopleMatchPolicy {
	return PeopleMatchPolicy{
		SourceMaximumPhotoCount: peopleMatchSourceMaximumPhotoCount,
		TargetMinimumPhotos:     peopleMatchTargetMinimumPhotos,
		TargetMinimumFaces:      peopleMatchTargetMinimumFaces,
	}
}

// LegacyPeopleMatchPolicy 复现扩大召回之前的口径：来源组只收 1～2 张照片，
// 目标组要求至少 10 张脸且至少 3 张照片。
func LegacyPeopleMatchPolicy() PeopleMatchPolicy {
	return PeopleMatchPolicy{
		SourceMaximumPhotoCount: 2,
		TargetMinimumPhotos:     3,
		TargetMinimumFaces:      10,
	}
}

// PersonMatchCandidate contains similarity measurements for manual review.
// None of these values is an identity probability or an automatic merge result.
type PersonMatchCandidate struct {
	Person                    PersonGroup `json:"person"`
	Similarity                float64     `json:"similarity"`
	BestFaceSimilarity        float64     `json:"bestFaceSimilarity"`
	SecondBestSimilarity      float64     `json:"secondBestSimilarity"`
	Margin                    float64     `json:"margin"`
	IndependentPhotoPairs     int         `json:"independentPhotoPairs"`
	SourceEvidencePhotos      int         `json:"sourceEvidencePhotos"`
	TargetEvidencePhotos      int         `json:"targetEvidencePhotos"`
	HumanConfirmationRequired bool        `json:"humanConfirmationRequired"`
	Ambiguous                 bool        `json:"ambiguous"`
	// Risk 描述这条建议的可靠程度。它不是身份概率，只决定界面怎么提示，
	// 以及是否值得优先让用户先看这一条。
	Risk string `json:"risk"`
	// RiskReasons 用中文说明风险来自哪里，方便用户判断要不要核对。
	RiskReasons []string `json:"riskReasons,omitempty"`
	// SourcePhotoCount 与 TargetPhotoCount 描述两侧的照片规模。
	SourcePhotoCount int `json:"sourcePhotoCount"`
	TargetPhotoCount int `json:"targetPhotoCount"`
	// SourceYears 与 TargetYears 是两侧照片出现过的拍摄年份。
	SourceYears []int `json:"sourceYears,omitempty"`
	TargetYears []int `json:"targetYears,omitempty"`
	// YearOverlap 表示两侧有共同的拍摄年份。跨年龄的同一个人不会重叠，
	// 所以它只作为参考证据，不作为拒绝合并的理由。
	YearOverlap bool `json:"yearOverlap"`
	// SmallFaceShare 是两侧证据里脸部相对面积过小的比例。
	SmallFaceShare float64 `json:"smallFaceShare"`
	// SimilaritySpread 是组内代表脸相似度的离散度，偏高说明组里混了不同姿态。
	SimilaritySpread float64 `json:"similaritySpread"`
	// EvidenceFaces 是来源侧提供互证的真实照片与人脸，界面可直接翻看。
	EvidenceFaces []PersonMatchEvidence `json:"evidenceFaces,omitempty"`
	// TargetEvidenceFaces 是目标侧提供互证的真实照片与人脸。
	TargetEvidenceFaces []PersonMatchEvidence `json:"targetEvidenceFaces,omitempty"`
}

// PersonMatchEvidence 描述一条互证证据：哪张照片里的哪张脸。
// 宽高来自原图像素，界面据此把人脸框画在正确的位置。
type PersonMatchEvidence struct {
	ResourceID string    `json:"resourceId"`
	FaceIndex  int       `json:"faceIndex"`
	Box        []float32 `json:"box"`
	Width      int       `json:"width"`
	Height     int       `json:"height"`
	Year       int       `json:"year,omitempty"`
}

// PersonMatchSuggestion groups up to three possible stable targets for one
// small, unconfirmed face group.
type PersonMatchSuggestion struct {
	Source     PersonGroup            `json:"source"`
	Candidates []PersonMatchCandidate `json:"candidates"`
}

// PersonMatchPage pages through small groups in deterministic review order.
// CheckedSources includes groups for which the ANN search found no candidate.
type PersonMatchPage struct {
	Items          []PersonMatchSuggestion `json:"items"`
	TotalSources   int                     `json:"totalSources"`
	Offset         int                     `json:"offset"`
	NextOffset     int                     `json:"nextOffset"`
	CheckedSources int                     `json:"checkedSources"`
	HasMore        bool                    `json:"hasMore"`
}

type peopleMatchGroup struct {
	group           PersonGroup
	faces           []PersonFace
	resources       map[string]struct{}
	centroid        []float32
	representatives []PersonFace
	// representativesReady 让代表脸只算一次：分组视图要为所有分组建表，
	// 而代表脸只有真正参与比对的分组才需要。
	representativesReady bool
	years                map[int]struct{}
	smallFaceCount       int
}

func (group *peopleMatchGroup) reps() []PersonFace {
	if !group.representativesReady {
		group.representatives = peopleGroupRepresentatives(group.faces, peopleMatchMaximumRepresentatives)
		group.representativesReady = true
	}
	return group.representatives
}

type peopleMatchScore struct {
	person                PersonGroup
	target                *peopleMatchGroup
	similarity            float64
	bestFaceSimilarity    float64
	independentPhotoPairs int
	sourceEvidencePhotos  int
	targetEvidencePhotos  int
	sourceEvidence        []PersonMatchEvidence
	targetEvidence        []PersonMatchEvidence
	similaritySpread      float64
	corroboratingFaces    int
}

// peopleMatchView 是一次复核需要的分组视图与「可能重复」关系。
type peopleMatchView struct {
	groups           map[string]*peopleMatchGroup
	rawToEffective   map[string]map[string]struct{}
	effectiveToRaw   map[string][]string
	relations        map[string][]string
	reverseRelations map[string][]string
	reviewSources    map[string]bool
}

// MatchSuggestions returns manual-review candidates for small groups. The ANN
// only narrows the search; every returned candidate is rescored against several
// representative faces in the active model's own feature space.
func (s *PeopleService) MatchSuggestions(offset, limit int, includeHidden bool, includeResource func(string) bool) PersonMatchPage {
	return s.MatchSuggestionsExcluding(offset, limit, includeHidden, includeResource, nil)
}

// MatchSuggestionsExcluding omits sources assigned to another review section.
// Targets still include every eligible stable group in the current photo set.
func (s *PeopleService) MatchSuggestionsExcluding(offset, limit int, includeHidden bool, includeResource func(string) bool, excludedSources map[string]bool) PersonMatchPage {
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 50 {
		limit = 20
	}

	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ann == nil && len(s.clusters) > 0 {
		s.rebuildPeopleANNLocked()
	}
	view := s.peopleMatchViewLocked(includeHidden, includeResource)
	var sources []*peopleMatchGroup
	for id, group := range view.groups {
		if group.group.Hidden && !includeHidden {
			continue
		}
		if !s.peopleMatchSourceEligibleLocked(group, excludedSources) {
			continue
		}
		view.reviewSources[id] = true
		if group.group.PhotoCount >= s.matchPolicyLocked().TargetMinimumPhotos &&
			!view.relationsForEffectiveLocked(id) {
			// 三张以上的重复人物只在真有可能的重复对象时才进复核列表，
			// 否则整页都是「没有候选」的噪声。
			continue
		}
		sources = append(sources, group)
	}
	sort.Slice(sources, func(i, j int) bool {
		left, right := sources[i].group, sources[j].group
		if left.FaceCount != right.FaceCount {
			return left.FaceCount > right.FaceCount
		}
		if left.PhotoCount != right.PhotoCount {
			return left.PhotoCount > right.PhotoCount
		}
		if left.CoverResourceID != right.CoverResourceID {
			return left.CoverResourceID < right.CoverResourceID
		}
		return left.ID < right.ID
	})

	page := PersonMatchPage{Items: []PersonMatchSuggestion{}, TotalSources: len(sources), Offset: offset}
	if offset >= len(sources) {
		return page
	}
	end := min(offset+limit, len(sources))
	page.NextOffset = end
	page.CheckedSources = end - offset
	page.HasMore = end < len(sources)
	thresholds := s.groupingThresholdsLocked()
	for _, source := range sources[offset:end] {
		matches := s.matchGroupTargetsLocked(source, view, thresholds)
		if len(matches) > peopleMatchCandidatesPerGroup {
			matches = matches[:peopleMatchCandidatesPerGroup]
		}
		for index := range matches {
			matches[index].SecondBestSimilarity = 0
			if index+1 < len(matches) {
				matches[index].SecondBestSimilarity = matches[index+1].Similarity
			}
			matches[index].Margin = matches[index].Similarity - matches[index].SecondBestSimilarity
			matches[index].HumanConfirmationRequired = true
			matches[index].Ambiguous = matches[index].IndependentPhotoPairs < 2 ||
				matches[index].SourceEvidencePhotos < 2 || matches[index].TargetEvidencePhotos < 2 ||
				matches[index].Margin < peopleMatchAmbiguousMargin
			matches[index].Risk, matches[index].RiskReasons = peopleMatchAssessRisk(source, matches[index])
		}
		page.Items = append(page.Items, PersonMatchSuggestion{Source: source.group, Candidates: matches})
	}
	return page
}

// peopleMatchSourceEligibleLocked 判断一个分组是否该进「待确认匹配」。
func (s *PeopleService) peopleMatchSourceEligibleLocked(group *peopleMatchGroup, excludedSources map[string]bool) bool {
	if group.group.Confirmed || s.manual.RetainedGroups[group.group.ID] {
		return false
	}
	if excludedSources[group.group.ID] {
		return false
	}
	if group.group.PhotoCount > s.matchPolicyLocked().SourceMaximumPhotoCount {
		return false
	}
	for _, face := range group.faces {
		if s.manual.Assignments[face.Key] != "" {
			return false
		}
	}
	return true
}

// peopleMatchTargetEligibleLocked 判断一个分组能否作为合并目标。
// 旧的准入要求 10 张脸，3～9 张的重复人物因此没有落点。
func (s *PeopleService) peopleMatchTargetEligibleLocked(group *peopleMatchGroup) bool {
	if group.group.Confirmed || s.manual.RetainedGroups[group.group.ID] {
		return true
	}
	policy := s.matchPolicyLocked()
	return group.group.PhotoCount >= policy.TargetMinimumPhotos &&
		group.group.FaceCount >= policy.TargetMinimumFaces
}

// matchPolicyLocked 返回当前生效的复核口径。
func (s *PeopleService) matchPolicyLocked() PeopleMatchPolicy {
	if s.matchPolicy.SourceMaximumPhotoCount <= 0 {
		return DefaultPeopleMatchPolicy()
	}
	return s.matchPolicy
}

// SetMatchPolicy 覆盖复核口径。评测工具用它跑旧口径，做前后对照。
func (s *PeopleService) SetMatchPolicy(policy PeopleMatchPolicy) {
	s.mu.Lock()
	s.matchPolicy = policy
	s.mu.Unlock()
}

func (s *PeopleService) peopleMatchViewLocked(includeHidden bool, includeResource func(string) bool) *peopleMatchView {
	groups, rawToEffective := s.peopleMatchGroupsLocked(includeHidden, includeResource)
	relations := s.peopleMatchRelationsLocked()
	reverse := make(map[string][]string)
	for rawID, related := range relations {
		for _, other := range related {
			reverse[other] = append(reverse[other], rawID)
		}
	}
	effectiveToRaw := make(map[string][]string, len(groups))
	for rawID, effectiveIDs := range rawToEffective {
		for effectiveID := range effectiveIDs {
			effectiveToRaw[effectiveID] = append(effectiveToRaw[effectiveID], rawID)
		}
	}
	for id := range effectiveToRaw {
		sort.Strings(effectiveToRaw[id])
	}
	view := &peopleMatchView{
		groups: groups, rawToEffective: rawToEffective, effectiveToRaw: effectiveToRaw,
		relations: relations, reverseRelations: reverse,
		reviewSources: map[string]bool{},
	}
	return view
}

// relationsForEffectiveLocked 判断一个有效分组是否有可能重复的对象。
func (view *peopleMatchView) relationsForEffectiveLocked(effectiveID string) bool {
	for _, rawID := range view.effectiveToRaw[effectiveID] {
		if len(view.relations[rawID]) > 0 || len(view.reverseRelations[rawID]) > 0 {
			return true
		}
	}
	return false
}

// peopleMatchRelationsLocked 记录「可能重复」的分组关系。
//
// 关系只在索引变化后重算一次：全库分组各做一次近邻查找，把中心足够接近的
// 彼此记下来。真正的「是不是同一个人」留给多代表脸精确复核回答。
func (s *PeopleService) peopleMatchRelationsLocked() map[string][]string {
	if s.matchRelations != nil && !s.matchRelationsStale {
		return s.matchRelations
	}
	relations := make(map[string][]string, len(s.clusters))
	if s.ann != nil && len(s.clusters) > 1 {
		ids := make([]string, 0, len(s.clusters))
		for id := range s.clusters {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			cluster := s.clusters[id]
			if len(cluster.centroid) == 0 {
				continue
			}
			candidates := map[string]float32{}
			s.peopleMatchCollectNearLocked(id, cluster.centroid, peopleMatchANNTopK, candidates)
			if len(cluster.anchor.embedding) > 0 {
				// 锚点是这一簇里质量最好的一张脸；只用中心向量找邻居，
				// 会被混入的其它姿态拉偏，锚点能把真正的重复对象捞回来。
				s.peopleMatchCollectNearLocked(id, cluster.anchor.embedding, peopleMatchANNFaceTopK, candidates)
			}
			list := make([]string, 0, len(candidates))
			for other := range candidates {
				list = append(list, other)
			}
			sort.Strings(list)
			relations[id] = list
		}
	}
	s.matchRelations = relations
	s.matchRelationsStale = false
	return relations
}

func (s *PeopleService) peopleMatchCollectNearLocked(selfID string, vector []float32, limit int, candidates map[string]float32) {
	for _, hit := range s.ann.SearchWithEf(vector, limit, peopleMatchRelationSearchEf) {
		if hit.id == selfID {
			continue
		}
		if float64(hit.score) < peopleMatchRelationCentroidThreshold {
			continue
		}
		if previous, exists := candidates[hit.id]; !exists || hit.score > previous {
			candidates[hit.id] = hit.score
		}
	}
}

func (s *PeopleService) peopleMatchGroupsLocked(includeHidden bool, includeResource func(string) bool) (map[string]*peopleMatchGroup, map[string]map[string]struct{}) {
	ordinals := s.personOrdinalNamesLocked()
	confirmed := peopleConfirmedPersonIDs(s.manual)
	groups := make(map[string]*peopleMatchGroup)
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
			group = &peopleMatchGroup{
				group: PersonGroup{
					ID: id, Name: s.personNameLocked(id, ordinals),
					Confirmed: confirmed[id], Hidden: s.manual.Hidden[id],
				},
				resources: make(map[string]struct{}),
				years:     make(map[int]struct{}),
			}
			groups[id] = group
		}
		group.faces = append(group.faces, face)
		group.group.FaceCount++
		group.resources[face.ResourceID] = struct{}{}
		if group.group.CoverResourceID == "" || face.ResourceID < group.group.CoverResourceID {
			group.group.CoverResourceID = face.ResourceID
		}
	}
	yearByResource := make(map[string]int)
	smallFaceByResource := make(map[string]bool)
	for _, group := range groups {
		sort.Slice(group.faces, func(i, j int) bool { return personFaceLess(group.faces[i], group.faces[j]) })
		group.group.PhotoCount = len(group.resources)
		group.centroid = peopleGroupCentroid(group.faces)
		for _, face := range group.faces {
			year, cached := yearByResource[face.ResourceID]
			if !cached {
				year = s.peopleCaptureYearLocked(face.ResourceID)
				yearByResource[face.ResourceID] = year
			}
			if year > 0 {
				group.years[year] = struct{}{}
			}
			small, cached := smallFaceByResource[face.ResourceID]
			if !cached {
				small = s.peopleFaceIsSmallLocked(face)
				smallFaceByResource[face.ResourceID] = small
			}
			if small {
				group.smallFaceCount++
			}
		}
	}
	rawToEffective := make(map[string]map[string]struct{}, len(s.clusters))
	for rawID, cluster := range s.clusters {
		for key := range cluster.members {
			face, exists := s.faces[key]
			if !exists {
				continue
			}
			effectiveID := s.effectivePersonIDLocked(face)
			if groups[effectiveID] == nil {
				continue
			}
			if rawToEffective[rawID] == nil {
				rawToEffective[rawID] = make(map[string]struct{})
			}
			rawToEffective[rawID][effectiveID] = struct{}{}
		}
	}
	return groups, rawToEffective
}

// peopleCaptureYearLocked 返回资源的拍摄年份；没有可靠来源时返回 0。
func (s *PeopleService) peopleCaptureYearLocked(resourceID string) int {
	if s.sourceCaptureYear == nil {
		return 0
	}
	return s.sourceCaptureYear(resourceID)
}

// peopleFaceIsSmallLocked 判断这张脸在画面里是不是小到不可靠。
func (s *PeopleService) peopleFaceIsSmallLocked(face PersonFace) bool {
	if s.sourceDimensions == nil || len(face.Box) != 4 {
		return false
	}
	dimensions := s.sourceDimensions(face.ResourceID)
	if dimensions.Width <= 0 || dimensions.Height <= 0 {
		return false
	}
	area := float64(face.Box[2] * face.Box[3])
	return area/float64(dimensions.Width*dimensions.Height) < peopleMatchSmallFaceAreaThreshold
}

func peopleGroupCentroid(faces []PersonFace) []float32 {
	if len(faces) == 0 {
		return nil
	}
	sum := make([]float64, len(faces[0].embedding))
	for _, face := range faces {
		if len(face.embedding) != len(sum) {
			return nil
		}
		for index, value := range face.embedding {
			sum[index] += float64(value)
		}
	}
	return normalizedCentroid(sum)
}

func peopleGroupRepresentatives(faces []PersonFace, limit int) []PersonFace {
	bestByResource := make(map[string]PersonFace)
	for _, face := range faces {
		previous, exists := bestByResource[face.ResourceID]
		if !exists || peopleRepresentativeRanksBefore(face, previous) {
			bestByResource[face.ResourceID] = face
		}
	}
	candidates := make([]PersonFace, 0, len(bestByResource))
	for _, face := range bestByResource {
		candidates = append(candidates, face)
	}
	sort.Slice(candidates, func(i, j int) bool {
		if peopleRepresentativeRanksBefore(candidates[i], candidates[j]) {
			return true
		}
		if peopleRepresentativeRanksBefore(candidates[j], candidates[i]) {
			return false
		}
		return candidates[i].Key < candidates[j].Key
	})
	if len(candidates) <= limit {
		return candidates
	}
	selected := make([]PersonFace, 0, limit)
	selected = append(selected, candidates[0])
	selectedResources := map[string]struct{}{candidates[0].ResourceID: {}}
	for len(selected) < limit {
		bestIndex := -1
		bestDistance := math.Inf(-1)
		for index, candidate := range candidates {
			if _, used := selectedResources[candidate.ResourceID]; used {
				continue
			}
			nearestSimilarity := math.Inf(1)
			for _, chosen := range selected {
				similarity := peopleCosine(candidate.embedding, chosen.embedding)
				if similarity < nearestSimilarity {
					nearestSimilarity = similarity
				}
			}
			distance := 1 - nearestSimilarity
			quality := 0.75 + 0.25*float64(candidate.Score)
			distance *= quality
			if distance > bestDistance || distance == bestDistance && (bestIndex < 0 || candidate.Key < candidates[bestIndex].Key) {
				bestIndex, bestDistance = index, distance
			}
		}
		if bestIndex < 0 {
			break
		}
		selected = append(selected, candidates[bestIndex])
		selectedResources[candidates[bestIndex].ResourceID] = struct{}{}
	}
	return selected
}

func peopleRepresentativeRanksBefore(left, right PersonFace) bool {
	if left.Score != right.Score {
		return left.Score > right.Score
	}
	leftArea := float64(left.Box[2] * left.Box[3])
	rightArea := float64(right.Box[2] * right.Box[3])
	if leftArea != rightArea {
		return leftArea > rightArea
	}
	return left.Key < right.Key
}

func (s *PeopleService) matchGroupTargetsLocked(source *peopleMatchGroup, view *peopleMatchView, thresholds peopleGroupingThresholds) []PersonMatchCandidate {
	if len(source.centroid) == 0 || len(source.faces) == 0 || s.ann == nil {
		return nil
	}
	approximate := make(map[string]float32)
	collect := func(vector []float32, limit int) {
		for _, hit := range s.ann.SearchWithEf(vector, limit, peopleMatchRelationSearchEf) {
			for effectiveID := range view.rawToEffective[hit.id] {
				if effectiveID == source.group.ID {
					continue
				}
				if previous, ok := approximate[effectiveID]; !ok || hit.score > previous {
					approximate[effectiveID] = hit.score
				}
			}
		}
	}
	// 候选来源有三处：关系表里记下的近邻、关系表的反向边，
	// 以及用代表脸补做的近邻查找。三者互补，缺一不可。
	for _, rawID := range view.effectiveToRaw[source.group.ID] {
		for _, other := range view.relations[rawID] {
			for effectiveID := range view.rawToEffective[other] {
				if effectiveID == source.group.ID {
					continue
				}
				approximate[effectiveID] = 1
			}
		}
		for _, other := range view.reverseRelations[rawID] {
			for effectiveID := range view.rawToEffective[other] {
				if effectiveID == source.group.ID {
					continue
				}
				approximate[effectiveID] = 1
			}
		}
	}
	collect(source.centroid, peopleMatchANNTopK)
	representatives := source.reps()
	for index, face := range representatives {
		if index >= peopleMatchSourceFaceSearchLimit {
			break
		}
		collect(face.embedding, peopleMatchANNFaceTopK)
	}

	ordered := make([]string, 0, len(approximate))
	for id := range approximate {
		ordered = append(ordered, id)
	}
	sort.Slice(ordered, func(i, j int) bool {
		if approximate[ordered[i]] != approximate[ordered[j]] {
			return approximate[ordered[i]] > approximate[ordered[j]]
		}
		return ordered[i] < ordered[j]
	})
	if len(ordered) > peopleMatchExactCandidateLimit {
		ordered = ordered[:peopleMatchExactCandidateLimit]
	}
	var matches []peopleMatchScore
	for _, targetID := range ordered {
		target := view.groups[targetID]
		if target == nil || target.group.Hidden && !source.group.Hidden {
			continue
		}
		if !s.peopleMatchTargetEligibleLocked(target) {
			continue
		}
		if view.reviewSources[targetID] && peopleMatchReviewOrder(source, target) >= 0 {
			// 两侧都在复核范围内时只提示一次方向：由证据更弱的一侧发起。
			continue
		}
		if peopleGroupsSharePhoto(source, target) || s.peopleGroupsMatchExcludedLocked(source.group.ID, targetID) {
			continue
		}
		score := s.peopleCompareMatchGroups(source, target, thresholds)
		if !score.match {
			continue
		}
		matches = append(matches, peopleMatchScore{
			person: target.group, target: target, similarity: score.meanSimilarity,
			bestFaceSimilarity:    score.bestSimilarity,
			independentPhotoPairs: score.independentPairs,
			sourceEvidencePhotos:  score.sourceEvidencePhotos,
			targetEvidencePhotos:  score.targetEvidencePhotos,
			sourceEvidence:        score.sourceEvidence,
			targetEvidence:        score.targetEvidence,
			similaritySpread:      score.similaritySpread,
		})
	}
	sort.Slice(matches, func(i, j int) bool {
		if matches[i].similarity != matches[j].similarity {
			return matches[i].similarity > matches[j].similarity
		}
		if matches[i].bestFaceSimilarity != matches[j].bestFaceSimilarity {
			return matches[i].bestFaceSimilarity > matches[j].bestFaceSimilarity
		}
		return matches[i].person.ID < matches[j].person.ID
	})
	result := make([]PersonMatchCandidate, len(matches))
	for index, match := range matches {
		sourceYears := peopleMatchSortedYears(source.years)
		targetYears := peopleMatchSortedYears(match.target.years)
		result[index] = PersonMatchCandidate{
			Person: match.person, Similarity: roundPeopleSimilarity(match.similarity),
			BestFaceSimilarity:    roundPeopleSimilarity(match.bestFaceSimilarity),
			IndependentPhotoPairs: match.independentPhotoPairs,
			SourceEvidencePhotos:  match.sourceEvidencePhotos,
			TargetEvidencePhotos:  match.targetEvidencePhotos,
			SourcePhotoCount:      source.group.PhotoCount,
			TargetPhotoCount:      match.target.group.PhotoCount,
			SourceYears:           sourceYears,
			TargetYears:           targetYears,
			YearOverlap:           peopleMatchYearsOverlap(sourceYears, targetYears),
			SmallFaceShare:        roundPeopleSimilarity(peopleMatchSmallFaceShare(source)),
			SimilaritySpread:      roundPeopleSimilarity(match.similaritySpread),
			EvidenceFaces:         match.sourceEvidence,
			TargetEvidenceFaces:   match.targetEvidence,
		}
	}
	return result
}

func peopleMatchSortedYears(years map[int]struct{}) []int {
	if len(years) == 0 {
		return nil
	}
	result := make([]int, 0, len(years))
	for year := range years {
		result = append(result, year)
	}
	sort.Ints(result)
	return result
}

func peopleMatchYearsOverlap(left, right []int) bool {
	if len(left) == 0 || len(right) == 0 {
		return false
	}
	index := 0
	for _, year := range left {
		for index < len(right) && right[index] < year {
			index++
		}
		if index < len(right) && right[index] == year {
			return true
		}
	}
	return false
}

// peopleMatchReviewOrder 比较两个都在复核范围内的分组，返回 -1 表示左边更弱。
func peopleMatchReviewOrder(left, right *peopleMatchGroup) int {
	if left.group.PhotoCount != right.group.PhotoCount {
		if left.group.PhotoCount < right.group.PhotoCount {
			return -1
		}
		return 1
	}
	if left.group.FaceCount != right.group.FaceCount {
		if left.group.FaceCount < right.group.FaceCount {
			return -1
		}
		return 1
	}
	if left.group.ID < right.group.ID {
		return -1
	}
	if left.group.ID > right.group.ID {
		return 1
	}
	return 0
}

type peopleMatchComparison struct {
	match                bool
	bestSimilarity       float64
	meanSimilarity       float64
	independentPairs     int
	sourceEvidencePhotos int
	targetEvidencePhotos int
	sourceEvidence       []PersonMatchEvidence
	targetEvidence       []PersonMatchEvidence
	similaritySpread     float64
	corroboratingFaces   int
}

// peopleCompareMatchGroups 用两侧的代表脸互相复核。
//
// 代表脸按照片取，同一张照片最多贡献一张脸，因此每一对互证天然来自
// 两张不同的照片。这让「独立照片证据」有了明确含义，也挡住了同照里
// 两个不同人被当成同一个人的风险。
func (s *PeopleService) peopleCompareMatchGroups(source, target *peopleMatchGroup, thresholds peopleGroupingThresholds) peopleMatchComparison {
	leftFaces, rightFaces := source.reps(), target.reps()
	if len(leftFaces) == 0 || len(rightFaces) == 0 {
		return peopleMatchComparison{}
	}
	leftBest := make([]int, len(leftFaces))
	rightBest := make([]int, len(rightFaces))
	leftScores := make([]float64, len(leftFaces))
	rightScores := make([]float64, len(rightFaces))
	for i := range leftBest {
		leftBest[i] = -1
	}
	for i := range rightBest {
		rightBest[i] = -1
	}
	for leftIndex, left := range leftFaces {
		for rightIndex, right := range rightFaces {
			similarity := peopleCosine(left.embedding, right.embedding)
			if leftBest[leftIndex] < 0 || similarity > leftScores[leftIndex] || similarity == leftScores[leftIndex] && right.Key < rightFaces[leftBest[leftIndex]].Key {
				leftBest[leftIndex], leftScores[leftIndex] = rightIndex, similarity
			}
			if rightBest[rightIndex] < 0 || similarity > rightScores[rightIndex] || similarity == rightScores[rightIndex] && left.Key < leftFaces[rightBest[rightIndex]].Key {
				rightBest[rightIndex], rightScores[rightIndex] = leftIndex, similarity
			}
		}
	}
	bestSimilarity := -1.0
	var totalSimilarity float64
	for _, score := range leftScores {
		totalSimilarity += score
		bestSimilarity = max(bestSimilarity, score)
	}
	meanSimilarity := totalSimilarity / float64(len(leftScores))
	sourceEvidence := make(map[string]struct{})
	targetEvidence := make(map[string]struct{})
	sourceFaces := make([]PersonMatchEvidence, 0, len(leftScores))
	targetFaces := make([]PersonMatchEvidence, 0, len(rightScores))
	mutualPairs := 0
	for leftIndex, rightIndex := range leftBest {
		if rightIndex < 0 || rightBest[rightIndex] != leftIndex || leftScores[leftIndex] < thresholds.mergeFaceThreshold {
			continue
		}
		mutualPairs++
		sourceEvidence[leftFaces[leftIndex].ResourceID] = struct{}{}
		targetEvidence[rightFaces[rightIndex].ResourceID] = struct{}{}
		sourceFaces = append(sourceFaces, s.peopleMatchEvidenceOf(leftFaces[leftIndex]))
		targetFaces = append(targetFaces, s.peopleMatchEvidenceOf(rightFaces[rightIndex]))
	}
	sort.Slice(sourceFaces, func(i, j int) bool { return sourceFaces[i].ResourceID < sourceFaces[j].ResourceID })
	sort.Slice(targetFaces, func(i, j int) bool { return targetFaces[i].ResourceID < targetFaces[j].ResourceID })
	crossPhotoEvidence := mutualPairs >= 2 && len(sourceEvidence) >= 2 && len(targetEvidence) >= 2
	if crossPhotoEvidence {
		if bestSimilarity < thresholds.mergeFaceThreshold || meanSimilarity < thresholds.mergeMinimumMeanSimilarity {
			return peopleMatchComparison{}
		}
	} else if !peopleMatchWeakEvidenceAccepts(source, target, bestSimilarity, meanSimilarity, thresholds) {
		return peopleMatchComparison{}
	}
	return peopleMatchComparison{
		match: true, bestSimilarity: bestSimilarity, meanSimilarity: meanSimilarity,
		independentPairs:     mutualPairs,
		sourceEvidencePhotos: len(sourceEvidence),
		targetEvidencePhotos: len(targetEvidence),
		sourceEvidence:       sourceFaces,
		targetEvidence:       targetFaces,
		similaritySpread:     peopleSimilaritySpread(leftScores),
		corroboratingFaces:   peopleMatchCorroboratingFaces(leftFaces, rightFaces, thresholds),
	}
}

// peopleMatchWeakEvidenceAccepts 判断「证据不足」的候选要不要仍然提示。
//
// 只有一张照片的来源组拿不出跨照片证据，这时唯一能用的判据是：目标组
// 自己是否从多张照片上印证了这张脸。门槛用的是人脸对人的相似度下限，
// 与自动归并时的互为最近邻规则一致；组中心相似度是两张脸平均后的量，
// 用在这里并不合适。
func peopleMatchWeakEvidenceAccepts(
	source, target *peopleMatchGroup,
	bestSimilarity, meanSimilarity float64,
	thresholds peopleGroupingThresholds,
) bool {
	if bestSimilarity < thresholds.mergeFaceThreshold || meanSimilarity < thresholds.mergeFaceThreshold {
		return false
	}
	// 目标组必须从至少两张照片上印证这张脸，才值得摆到用户面前。
	if peopleMatchCorroboratingFaces(source.reps(), target.reps(), thresholds) < peopleMatchMinimumCorroboration {
		return false
	}
	// 目标组自己的一致性是参照：明显比组内成员更不像的，不提示。
	internal := peopleGroupInternalSimilarity(target)
	if internal > 0 && bestSimilarity < internal-peopleMatchInternalSlack {
		return false
	}
	return true
}

// peopleMatchCorroboratingFaces 统计目标组里有多少张脸印证了来源组的那张脸。
func peopleMatchCorroboratingFaces(leftFaces, rightFaces []PersonFace, thresholds peopleGroupingThresholds) int {
	if len(leftFaces) == 0 || len(rightFaces) == 0 {
		return 0
	}
	best := -1.0
	for _, left := range leftFaces {
		for _, right := range rightFaces {
			similarity := peopleCosine(left.embedding, right.embedding)
			if similarity > best {
				best = similarity
			}
		}
	}
	if best < thresholds.mergeFaceThreshold {
		return 0
	}
	count := 0
	for _, right := range rightFaces {
		for _, left := range leftFaces {
			if peopleCosine(left.embedding, right.embedding) >= thresholds.mergeFaceThreshold {
				count++
				break
			}
		}
	}
	return count
}

// peopleGroupInternalSimilarity 返回组内各脸互相比对时的相似度下界。
// 它说明这一组自己有多一致，是判断外面那张脸算不算这一组的参照。
func peopleGroupInternalSimilarity(group *peopleMatchGroup) float64 {
	faces := group.reps()
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
	return scores[int(math.Floor(float64(len(scores)-1)*0.1))]
}

// peopleMatchEvidenceOf 把一张脸转成可以给界面直接用的证据。
// 宽高取自原图，界面据此把人脸框画在缩略图的正确位置。
func (s *PeopleService) peopleMatchEvidenceOf(face PersonFace) PersonMatchEvidence {
	evidence := PersonMatchEvidence{
		ResourceID: face.ResourceID, FaceIndex: face.FaceIndex,
		Box: append([]float32(nil), face.Box...),
	}
	if s.sourceDimensions != nil {
		dimensions := s.sourceDimensions(face.ResourceID)
		evidence.Width = dimensions.Width
		evidence.Height = dimensions.Height
	}
	evidence.Year = s.peopleCaptureYearLocked(face.ResourceID)
	return evidence
}

// peopleSimilaritySpread 计算代表脸相似度的离散度。
// 组里混进姿态差别很大的人脸时，离散度会明显升高。
func peopleSimilaritySpread(scores []float64) float64 {
	if len(scores) < 2 {
		return 0
	}
	var total float64
	for _, score := range scores {
		total += score
	}
	mean := total / float64(len(scores))
	var variance float64
	for _, score := range scores {
		difference := score - mean
		variance += difference * difference
	}
	return math.Sqrt(variance / float64(len(scores)))
}

// peopleMatchAssessRisk 给一条建议评级，并说明风险来自哪里。
func peopleMatchAssessRisk(source *peopleMatchGroup, candidate PersonMatchCandidate) (string, []string) {
	reasons := make([]string, 0, 4)
	if candidate.IndependentPhotoPairs < 2 {
		reasons = append(reasons, "只有单张照片互证，容易把同一个人拆成两组的重复线索")
	}
	if candidate.SourceEvidencePhotos < 2 || candidate.TargetEvidencePhotos < 2 {
		reasons = append(reasons, "两侧的照片证据都不足两张")
	}
	if candidate.Margin < peopleMatchAmbiguousMargin {
		reasons = append(reasons, "与次优候选的差距很小，两个候选难以区分")
	}
	if candidate.SimilaritySpread > peopleMatchSimilaritySpreadLimit {
		reasons = append(reasons, "来源组内各张脸的相似度分散，可能混入了不同姿态或不同人")
	}
	if candidate.SmallFaceShare >= 0.5 {
		reasons = append(reasons, "多数证据来自画面里很小的脸，识别本身就不稳")
	}
	if !candidate.YearOverlap && len(candidate.SourceYears) > 0 && len(candidate.TargetYears) > 0 {
		if gap := peopleMatchYearGap(candidate.SourceYears, candidate.TargetYears); gap > peopleMatchMaximumYearGapYears {
			reasons = append(reasons, "两侧照片的拍摄年份相隔较远，请确认是不是同一个人")
		}
	}
	if len(reasons) == 0 {
		return peopleMatchRiskLow, reasons
	}
	if candidate.IndependentPhotoPairs < 2 ||
		candidate.SourceEvidencePhotos < 2 || candidate.TargetEvidencePhotos < 2 ||
		candidate.Margin < peopleMatchAmbiguousMargin {
		return peopleMatchRiskHigh, reasons
	}
	return peopleMatchRiskMedium, reasons
}

func peopleMatchSmallFaceShare(source *peopleMatchGroup) float64 {
	if len(source.faces) == 0 {
		return 0
	}
	return float64(source.smallFaceCount) / float64(len(source.faces))
}

func peopleMatchYearGap(left, right []int) int {
	if len(left) == 0 || len(right) == 0 {
		return 0
	}
	lowest, highest := left[0], left[0]
	for _, year := range left {
		lowest = min(lowest, year)
		highest = max(highest, year)
	}
	for _, year := range right {
		lowest = min(lowest, year)
		highest = max(highest, year)
	}
	return highest - lowest
}

func peopleGroupsSharePhoto(left, right *peopleMatchGroup) bool {
	for resourceID := range left.resources {
		if _, exists := right.resources[resourceID]; exists {
			return true
		}
	}
	return false
}

func roundPeopleSimilarity(value float64) float64 {
	return math.Round(value*1000) / 1000
}

func normalizePeopleMatchExclusions(exclusions []PeopleMatchExclusion) []PeopleMatchExclusion {
	unique := make(map[string]PeopleMatchExclusion, len(exclusions))
	for _, exclusion := range exclusions {
		if !validPeopleFaceKey(exclusion.FirstFaceKey) || !validPeopleFaceKey(exclusion.SecondFaceKey) || exclusion.FirstFaceKey == exclusion.SecondFaceKey {
			continue
		}
		if exclusion.SecondFaceKey < exclusion.FirstFaceKey {
			exclusion.FirstFaceKey, exclusion.SecondFaceKey = exclusion.SecondFaceKey, exclusion.FirstFaceKey
		}
		unique[exclusion.FirstFaceKey+"\x00"+exclusion.SecondFaceKey] = exclusion
	}
	result := make([]PeopleMatchExclusion, 0, len(unique))
	for _, exclusion := range unique {
		result = append(result, exclusion)
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].FirstFaceKey != result[j].FirstFaceKey {
			return result[i].FirstFaceKey < result[j].FirstFaceKey
		}
		return result[i].SecondFaceKey < result[j].SecondFaceKey
	})
	return result
}

func validPeopleFaceKey(key string) bool {
	separator := strings.LastIndex(key, "#")
	if separator <= 0 {
		return false
	}
	faceIndex, err := strconv.Atoi(key[separator+1:])
	return err == nil && faceIndex >= 0
}

func (s *PeopleService) peopleFaceExcludedFromClusterLocked(faceKey string, cluster *peopleCluster) bool {
	for _, exclusion := range s.manual.ExcludedMatches {
		if faceKey == exclusion.FirstFaceKey {
			if _, exists := cluster.members[exclusion.SecondFaceKey]; exists {
				return true
			}
		}
		if faceKey == exclusion.SecondFaceKey {
			if _, exists := cluster.members[exclusion.FirstFaceKey]; exists {
				return true
			}
		}
	}
	return false
}

func (s *PeopleService) peopleClustersExcludedLocked(left, right *peopleCluster) bool {
	for _, exclusion := range s.manual.ExcludedMatches {
		_, firstOnLeft := left.members[exclusion.FirstFaceKey]
		_, secondOnLeft := left.members[exclusion.SecondFaceKey]
		_, firstOnRight := right.members[exclusion.FirstFaceKey]
		_, secondOnRight := right.members[exclusion.SecondFaceKey]
		if firstOnLeft && secondOnRight || secondOnLeft && firstOnRight {
			return true
		}
	}
	return false
}

func (s *PeopleService) peopleGroupsMatchExcludedLocked(leftID, rightID string) bool {
	for _, exclusion := range s.manual.ExcludedMatches {
		leftFace, leftExists := s.faces[exclusion.FirstFaceKey]
		rightFace, rightExists := s.faces[exclusion.SecondFaceKey]
		if !leftExists || !rightExists {
			continue
		}
		firstID := s.effectivePersonIDLocked(leftFace)
		secondID := s.effectivePersonIDLocked(rightFace)
		if firstID == leftID && secondID == rightID || firstID == rightID && secondID == leftID {
			return true
		}
	}
	return false
}

// ExcludeMatch persists the user's decision to keep two reviewed groups
// separate. The exclusion follows stable face keys rather than rebuildable IDs.
func (s *PeopleService) ExcludeMatch(sourceID, targetID string) error {
	if sourceID == targetID || !validPersonID(sourceID) || !validPersonID(targetID) {
		return ErrInvalidPerson
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	var sourceFace, targetFace *PersonFace
	for key, face := range s.faces {
		effectiveID := s.effectivePersonIDLocked(face)
		if effectiveID == sourceID && (sourceFace == nil || personFaceLess(face, *sourceFace)) {
			copy := s.faces[key]
			sourceFace = &copy
		}
		if effectiveID == targetID && (targetFace == nil || personFaceLess(face, *targetFace)) {
			copy := s.faces[key]
			targetFace = &copy
		}
	}
	if sourceFace == nil || targetFace == nil {
		return ErrPersonNotFound
	}
	for key, face := range s.faces {
		if s.effectivePersonIDLocked(face) == sourceID {
			s.manual.PinnedFaces[key] = sourceID
		}
	}
	s.manual.ExcludedMatches = normalizePeopleMatchExclusions(append(s.manual.ExcludedMatches, PeopleMatchExclusion{
		FirstFaceKey: sourceFace.Key, SecondFaceKey: targetFace.Key,
	}))
	return s.persistManualLocked()
}

// RetainGroup records a user's decision to keep a group as a distinct person.
// It is promoted in the people list and pinned through future index rebuilds.
func (s *PeopleService) RetainGroup(personID string) error {
	if !validPersonID(personID) {
		return ErrInvalidPerson
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPersonLocked(personID) {
		return ErrPersonNotFound
	}
	for key, face := range s.faces {
		if s.effectivePersonIDLocked(face) == personID {
			s.manual.PinnedFaces[key] = personID
		}
	}
	s.manual.RetainedGroups[personID] = true
	return s.persistManualLocked()
}
