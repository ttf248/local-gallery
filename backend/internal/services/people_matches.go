package services

import (
	"math"
	"sort"
	"strconv"
	"strings"
)

const (
	peopleMatchANNTopK                = 32
	peopleMatchExactCandidateLimit    = 8
	peopleMatchMaximumRepresentatives = 16
	peopleMatchCandidatesPerGroup     = 3
	peopleMatchSinglePhotoThreshold   = 0.82
	peopleMatchAmbiguousMargin        = 0.035
)

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
}

type peopleMatchScore struct {
	person                 PersonGroup
	similarity             float64
	bestFaceSimilarity     float64
	independentPhotoPairs  int
	sourceEvidencePhotos   int
	targetEvidencePhotos   int
	needsHumanConfirmation bool
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
	groups, rawToEffective := s.peopleMatchGroupsLocked(includeHidden, includeResource)
	var sources []*peopleMatchGroup
	stableTargets := make(map[string]*peopleMatchGroup)
	for id, group := range groups {
		if group.group.Hidden && !includeHidden {
			continue
		}
		if group.group.PhotoCount < PeopleCommonMinimumPhotoCount && !group.group.Confirmed && !excludedSources[id] {
			hasAssignment := false
			for _, face := range group.faces {
				if s.manual.Assignments[face.Key] != "" {
					hasAssignment = true
					break
				}
			}
			if !hasAssignment {
				sources = append(sources, group)
			}
		}
		if group.group.Confirmed || group.group.FaceCount >= 10 && group.group.PhotoCount >= 3 {
			stableTargets[id] = group
		}
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
		matches := s.matchGroupTargetsLocked(source, groups, stableTargets, rawToEffective, thresholds)
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
		}
		page.Items = append(page.Items, PersonMatchSuggestion{Source: source.group, Candidates: matches})
	}
	return page
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
	for _, group := range groups {
		sort.Slice(group.faces, func(i, j int) bool { return personFaceLess(group.faces[i], group.faces[j]) })
		group.group.PhotoCount = len(group.resources)
		group.centroid = peopleGroupCentroid(group.faces)
		group.representatives = peopleGroupRepresentatives(group.faces, peopleMatchMaximumRepresentatives)
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

func (s *PeopleService) matchGroupTargetsLocked(source *peopleMatchGroup, groups, stableTargets map[string]*peopleMatchGroup, rawToEffective map[string]map[string]struct{}, thresholds peopleGroupingThresholds) []PersonMatchCandidate {
	if len(source.centroid) == 0 || len(source.faces) == 0 || s.ann == nil {
		return nil
	}
	approximate := make(map[string]float32)
	for _, hit := range s.ann.Search(source.centroid, peopleMatchANNTopK) {
		for effectiveID := range rawToEffective[hit.id] {
			if effectiveID == source.group.ID || stableTargets[effectiveID] == nil {
				continue
			}
			if previous, ok := approximate[effectiveID]; !ok || hit.score > previous {
				approximate[effectiveID] = hit.score
			}
		}
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
		target := groups[targetID]
		if target == nil || target.group.Hidden && !source.group.Hidden || peopleGroupsSharePhoto(source, target) || s.peopleGroupsMatchExcludedLocked(source.group.ID, targetID) {
			continue
		}
		score := peopleCompareMatchGroups(source, target, thresholds)
		if !score.match {
			continue
		}
		matches = append(matches, peopleMatchScore{
			person: target.group, similarity: score.meanSimilarity,
			bestFaceSimilarity:    score.bestSimilarity,
			independentPhotoPairs: score.independentPairs,
			sourceEvidencePhotos:  score.sourceEvidencePhotos,
			targetEvidencePhotos:  score.targetEvidencePhotos,
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
		result[index] = PersonMatchCandidate{
			Person: match.person, Similarity: roundPeopleSimilarity(match.similarity),
			BestFaceSimilarity:    roundPeopleSimilarity(match.bestFaceSimilarity),
			IndependentPhotoPairs: match.independentPhotoPairs,
			SourceEvidencePhotos:  match.sourceEvidencePhotos,
			TargetEvidencePhotos:  match.targetEvidencePhotos,
		}
	}
	return result
}

type peopleMatchComparison struct {
	match                bool
	bestSimilarity       float64
	meanSimilarity       float64
	independentPairs     int
	sourceEvidencePhotos int
	targetEvidencePhotos int
}

func peopleCompareMatchGroups(source, target *peopleMatchGroup, thresholds peopleGroupingThresholds) peopleMatchComparison {
	leftFaces, rightFaces := source.faces, target.representatives
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
	mutualPairs := 0
	for leftIndex, rightIndex := range leftBest {
		if rightIndex < 0 || rightBest[rightIndex] != leftIndex || leftScores[leftIndex] < thresholds.mergeFaceThreshold {
			continue
		}
		mutualPairs++
		sourceEvidence[leftFaces[leftIndex].ResourceID] = struct{}{}
		targetEvidence[rightFaces[rightIndex].ResourceID] = struct{}{}
	}
	crossPhotoEvidence := mutualPairs >= 2 && len(sourceEvidence) >= 2 && len(targetEvidence) >= 2
	if crossPhotoEvidence {
		if bestSimilarity < thresholds.mergeFaceThreshold || meanSimilarity < thresholds.mergeMinimumMeanSimilarity {
			return peopleMatchComparison{}
		}
	} else if bestSimilarity < thresholds.mergeCentroidThreshold || meanSimilarity < peopleMatchSinglePhotoThreshold {
		return peopleMatchComparison{}
	}
	return peopleMatchComparison{
		match: true, bestSimilarity: bestSimilarity, meanSimilarity: meanSimilarity,
		independentPairs:     mutualPairs,
		sourceEvidencePhotos: len(sourceEvidence), targetEvidencePhotos: len(targetEvidence),
	}
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
