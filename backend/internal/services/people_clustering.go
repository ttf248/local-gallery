package services

import (
	"math"
	"sort"
)

// 人物聚类：把每张脸放进分组，并复核可能重复的组。
// 匹配建议在 people_matches.go，组质量评估在 people_quality.go。

func (s *PeopleService) addFaceLocked(face PersonFace) {
	s.matchRelationsStale = true
	thresholds := s.groupingThresholdsLocked()
	if s.ann == nil {
		s.rebuildPeopleANNLocked()
	}
	if pinnedID := s.manual.PinnedFaces[face.Key]; pinnedID != "" {
		s.addPinnedFaceLocked(face, pinnedID)
		return
	}
	bestID := ""
	bestScore := thresholds.centroidThreshold
	for _, candidate := range s.ann.Search(face.embedding, peopleANNCandidateLimit) {
		id := candidate.id
		cluster := s.clusters[id]
		if cluster == nil {
			continue
		}
		if s.peopleFaceExcludedFromClusterLocked(face.Key, cluster) {
			continue
		}
		if candidate.score <= float32(thresholds.centroidThreshold-thresholds.annScoreMargin) {
			continue
		}
		s.comparisons++
		score := peopleCosine(face.embedding, cluster.centroid)
		if score <= thresholds.centroidThreshold || !peopleClusterHasMatchingAnchorAtThreshold(face, cluster, thresholds.anchorThreshold) {
			continue
		}
		if score > bestScore || (bestID != "" && score == bestScore && id < bestID) {
			bestID, bestScore = id, score
		}
	}
	newCluster := bestID == ""
	if newCluster {
		bestID = stablePersonID(face.Key)
		s.clusters[bestID] = &peopleCluster{
			sum:       make([]float64, len(face.embedding)),
			centroid:  make([]float32, len(face.embedding)),
			anchor:    peopleClusterAnchor{key: face.Key, resourceID: face.ResourceID, embedding: face.embedding},
			members:   map[string]struct{}{},
			resources: map[string]struct{}{},
		}
	}
	cluster := s.clusters[bestID]
	for index, value := range face.embedding {
		cluster.sum[index] += float64(value)
	}
	cluster.count++
	cluster.members[face.Key] = struct{}{}
	if cluster.resources == nil {
		cluster.resources = make(map[string]struct{})
	}
	cluster.resources[face.ResourceID] = struct{}{}
	updatePeopleCentroid(cluster)
	// 分组中心变了，索引里的节点向量要跟着变：旧向量会让下一批脸
	// 在近邻查找里找错分组。
	s.ann.Add(bestID, cluster.centroid)
	face.PersonID = bestID
	if face.originID == "" {
		face.originID = bestID
	}
	s.faces[face.Key] = face
	if s.facesByResource == nil {
		s.facesByResource = make(map[string][]string)
	}
	s.facesByResource[face.ResourceID] = append(s.facesByResource[face.ResourceID], face.Key)
}

func (s *PeopleService) addPinnedFaceLocked(face PersonFace, personID string) {
	s.matchRelationsStale = true
	cluster := s.clusters[personID]
	newCluster := cluster == nil
	if newCluster {
		cluster = &peopleCluster{
			sum: make([]float64, len(face.embedding)), centroid: make([]float32, len(face.embedding)),
			anchor:  peopleClusterAnchor{key: face.Key, resourceID: face.ResourceID, embedding: face.embedding},
			members: make(map[string]struct{}), resources: make(map[string]struct{}),
		}
		s.clusters[personID] = cluster
	}
	for index, value := range face.embedding {
		cluster.sum[index] += float64(value)
	}
	cluster.count++
	cluster.members[face.Key] = struct{}{}
	cluster.resources[face.ResourceID] = struct{}{}
	updatePeopleCentroid(cluster)
	s.ann.Add(personID, cluster.centroid)
	face.PersonID = personID
	face.originID = personID
	s.faces[face.Key] = face
	if s.facesByResource == nil {
		s.facesByResource = make(map[string][]string)
	}
	s.facesByResource[face.ResourceID] = append(s.facesByResource[face.ResourceID], face.Key)
	if newCluster {
		s.ann.Add(personID, cluster.centroid)
	}
}

type peopleClusterMergeEvidence struct {
	leftID      string
	rightID     string
	centroid    float64
	mutualCount int
	mutualMean  float64
}

func (s *PeopleService) consolidateClustersLocked(touched map[string]struct{}) {
	thresholds := s.groupingThresholdsLocked()
	if len(s.clusters) < 2 {
		return
	}
	if s.ann == nil {
		s.rebuildPeopleANNLocked()
	}

	clusterIDs := make([]string, 0, len(s.clusters))
	for id := range s.clusters {
		clusterIDs = append(clusterIDs, id)
	}
	sort.Strings(clusterIDs)
	referencedIDs := peopleReferencedIDs(s.manual)
	eligible := make(map[string]bool, len(s.clusters))
	for _, id := range clusterIDs {
		cluster := s.clusters[id]
		if cluster.count < thresholds.mergeMinimumFaces || referencedIDs[id] ||
			s.manual.Names[id] != "" || s.manual.Hidden[id] {
			continue
		}
		manuallyAssigned := false
		for key := range cluster.members {
			if s.manual.Assignments[key] != "" {
				manuallyAssigned = true
				break
			}
		}
		eligible[id] = !manuallyAssigned
	}
	matchFaces := make(map[string]map[string][]PersonFace, len(eligible))
	for id, canMerge := range eligible {
		if canMerge {
			matchFaces[id] = s.peopleClusterMatchSamples(s.clusters[id])
		}
	}

	evidenceByPair := make(map[string]peopleClusterMergeEvidence)
	var evidence []peopleClusterMergeEvidence
	for _, leftID := range clusterIDs {
		if !eligible[leftID] {
			continue
		}
		if touched != nil {
			if _, isTouched := touched[leftID]; !isTouched {
				continue
			}
		}
		left := s.clusters[leftID]
		for _, candidate := range s.ann.Search(left.centroid, thresholds.mergeCandidateLimit) {
			rightID := candidate.id
			if rightID == leftID || !eligible[rightID] {
				continue
			}
			pairLeftID, pairRightID := leftID, rightID
			if pairRightID < pairLeftID {
				pairLeftID, pairRightID = pairRightID, pairLeftID
			}
			pairKey := peopleClusterPairKey(pairLeftID, pairRightID)
			if _, checked := evidenceByPair[pairKey]; checked {
				continue
			}
			pairLeft, pairRight := s.clusters[pairLeftID], s.clusters[pairRightID]
			if s.peopleClustersExcludedLocked(pairLeft, pairRight) {
				continue
			}
			centroidScore := peopleCosine(pairLeft.centroid, pairRight.centroid)
			if centroidScore < thresholds.mergeCentroidThreshold {
				continue
			}
			mutualCount, mutualMean, ok := s.peopleClusterMutualMatchesWithThresholds(pairLeft, pairRight, matchFaces[pairLeftID], matchFaces[pairRightID], thresholds)
			if !ok || mutualCount < peopleGroupingMinimumMutualMatchesFor(min(pairLeft.count, pairRight.count), thresholds) || mutualMean < thresholds.mergeMinimumMeanSimilarity {
				continue
			}
			pair := peopleClusterMergeEvidence{
				leftID: pairLeftID, rightID: pairRightID, centroid: centroidScore,
				mutualCount: mutualCount, mutualMean: mutualMean,
			}
			evidenceByPair[pairKey] = pair
			evidence = append(evidence, pair)
		}
	}
	if len(evidence) == 0 {
		return
	}
	sort.Slice(evidence, func(i, j int) bool {
		if evidence[i].centroid != evidence[j].centroid {
			return evidence[i].centroid > evidence[j].centroid
		}
		if evidence[i].mutualCount != evidence[j].mutualCount {
			return evidence[i].mutualCount > evidence[j].mutualCount
		}
		if evidence[i].leftID != evidence[j].leftID {
			return evidence[i].leftID < evidence[j].leftID
		}
		return evidence[i].rightID < evidence[j].rightID
	})

	componentByID := make(map[string]string, len(clusterIDs))
	componentMembers := make(map[string][]string, len(clusterIDs))
	for _, id := range clusterIDs {
		componentByID[id] = id
		componentMembers[id] = []string{id}
	}
	for _, pair := range evidence {
		leftRoot, rightRoot := componentByID[pair.leftID], componentByID[pair.rightID]
		if leftRoot == rightRoot || !peopleClusterComponentsHaveEvidence(componentMembers[leftRoot], componentMembers[rightRoot], evidenceByPair) {
			continue
		}
		keeper, source := leftRoot, rightRoot
		if rightRoot < leftRoot {
			keeper, source = rightRoot, leftRoot
		}
		mergedMembers := append(componentMembers[keeper], componentMembers[source]...)
		sort.Strings(mergedMembers)
		componentMembers[keeper] = mergedMembers
		delete(componentMembers, source)
		for _, id := range mergedMembers {
			componentByID[id] = keeper
		}
	}

	var components [][]string
	for _, members := range componentMembers {
		if len(members) > 1 {
			components = append(components, members)
		}
	}
	sort.Slice(components, func(i, j int) bool { return components[i][0] < components[j][0] })
	for _, members := range components {
		keeperID := members[0]
		for _, id := range members[1:] {
			keeper, source := s.clusters[keeperID], s.clusters[id]
			if source.count > keeper.count || source.count == keeper.count && id < keeperID {
				keeperID = id
			}
		}
		for _, id := range members {
			if id != keeperID {
				s.mergePeopleClustersLocked(keeperID, id)
			}
		}
	}
	// 合并掉的分组在索引里留下旧节点：查近邻时按分组 ID 回查，
	// 查不到的直接跳过。保留下来的分组中心变了，合并时已经同步过节点向量。
	// 旧节点攒多了再整体重建索引。
}

func peopleClusterPairKey(leftID, rightID string) string {
	if rightID < leftID {
		leftID, rightID = rightID, leftID
	}
	return leftID + "\x00" + rightID
}

func peopleGroupingMinimumMutualMatches(smallerClusterSize int) int {
	return peopleGroupingMinimumMutualMatchesFor(smallerClusterSize, qualityV2GroupingThresholds)
}

func peopleGroupingMinimumMutualMatchesFor(smallerClusterSize int, thresholds peopleGroupingThresholds) int {
	return max(thresholds.mergeMinimumMutual, int(math.Ceil(float64(smallerClusterSize)*thresholds.mergeMutualRatio)))
}

func (s *PeopleService) peopleClusterMutualMatches(left, right *peopleCluster, leftFaces, rightFaces map[string][]PersonFace) (int, float64, bool) {
	return s.peopleClusterMutualMatchesWithThresholds(left, right, leftFaces, rightFaces, qualityV2GroupingThresholds)
}

func (s *PeopleService) peopleClusterMutualMatchesWithThresholds(left, right *peopleCluster, leftFaces, rightFaces map[string][]PersonFace, thresholds peopleGroupingThresholds) (int, float64, bool) {
	if left.anchor.embedding == nil || right.anchor.embedding == nil || len(left.centroid) != len(right.centroid) {
		return 0, 0, false
	}
	for resourceID := range left.resources {
		if _, shared := right.resources[resourceID]; shared {
			return 0, 0, false
		}
	}
	leftCounts := s.peopleClusterOriginCounts(left)
	rightCounts := s.peopleClusterOriginCounts(right)
	if len(leftFaces) == 0 || len(rightFaces) == 0 || len(leftCounts) == 0 || len(rightCounts) == 0 {
		return 0, 0, false
	}
	leftOrigins := make([]string, 0, len(leftCounts))
	for originID := range leftCounts {
		leftOrigins = append(leftOrigins, originID)
	}
	sort.Strings(leftOrigins)
	rightOrigins := make([]string, 0, len(rightCounts))
	for originID := range rightCounts {
		rightOrigins = append(rightOrigins, originID)
	}
	sort.Strings(rightOrigins)
	totalMatches := 0
	var totalSimilarity float64
	for _, leftOrigin := range leftOrigins {
		for _, rightOrigin := range rightOrigins {
			count, mean := peopleReciprocalFaceMatchesAtThreshold(leftFaces[leftOrigin], rightFaces[rightOrigin], thresholds.mergeFaceThreshold)
			minimum := peopleGroupingMinimumMutualMatchesFor(min(leftCounts[leftOrigin], rightCounts[rightOrigin]), thresholds)
			if count < minimum || mean < thresholds.mergeMinimumMeanSimilarity {
				return 0, 0, true
			}
			totalMatches += count
			totalSimilarity += mean * float64(count)
		}
	}
	if totalMatches == 0 {
		return 0, 0, true
	}
	return totalMatches, totalSimilarity / float64(totalMatches), true
}

func peopleReciprocalFaceMatches(leftFaces, rightFaces []PersonFace) (int, float64) {
	return peopleReciprocalFaceMatchesAtThreshold(leftFaces, rightFaces, qualityV2GroupingThresholds.mergeFaceThreshold)
}

func peopleReciprocalFaceMatchesAtThreshold(leftFaces, rightFaces []PersonFace, minimumSimilarity float64) (int, float64) {
	if len(leftFaces) == 0 || len(rightFaces) == 0 {
		return 0, 0
	}
	leftBest := make([]int, len(leftFaces))
	rightBest := make([]int, len(rightFaces))
	leftScores := make([]float64, len(leftFaces))
	rightScores := make([]float64, len(rightFaces))
	for index := range leftBest {
		leftBest[index] = -1
	}
	for index := range rightBest {
		rightBest[index] = -1
	}
	for leftIndex, leftFace := range leftFaces {
		for rightIndex, rightFace := range rightFaces {
			score := peopleCosine(leftFace.embedding, rightFace.embedding)
			if leftBest[leftIndex] < 0 || score > leftScores[leftIndex] ||
				score == leftScores[leftIndex] && rightFace.Key < rightFaces[leftBest[leftIndex]].Key {
				leftScores[leftIndex] = score
				leftBest[leftIndex] = rightIndex
			}
			if rightBest[rightIndex] < 0 || score > rightScores[rightIndex] ||
				score == rightScores[rightIndex] && leftFace.Key < leftFaces[rightBest[rightIndex]].Key {
				rightScores[rightIndex] = score
				rightBest[rightIndex] = leftIndex
			}
		}
	}
	mutualCount := 0
	var mutualTotal float64
	for leftIndex, rightIndex := range leftBest {
		if rightIndex < 0 || rightBest[rightIndex] != leftIndex || leftScores[leftIndex] < minimumSimilarity {
			continue
		}
		mutualCount++
		mutualTotal += leftScores[leftIndex]
	}
	if mutualCount == 0 {
		return 0, 0
	}
	return mutualCount, mutualTotal / float64(mutualCount)
}

func (s *PeopleService) peopleClusterMatchSamples(cluster *peopleCluster) map[string][]PersonFace {
	faces := s.peopleClusterFacesLocked(cluster)
	byOrigin := make(map[string][]PersonFace)
	for _, face := range faces {
		originID := face.originID
		if originID == "" {
			originID = face.PersonID
		}
		if originID != "" {
			byOrigin[originID] = append(byOrigin[originID], face)
		}
	}
	for originID, originFaces := range byOrigin {
		maximumSampleFaces := s.groupingThresholdsLocked().mergeMaximumSampleFaces
		if len(originFaces) <= maximumSampleFaces {
			continue
		}
		samples := make([]PersonFace, maximumSampleFaces)
		for index := range samples {
			position := index * (len(originFaces) - 1) / (len(samples) - 1)
			samples[index] = originFaces[position]
		}
		byOrigin[originID] = samples
	}
	return byOrigin
}

func (s *PeopleService) peopleClusterOriginCounts(cluster *peopleCluster) map[string]int {
	counts := make(map[string]int)
	for key := range cluster.members {
		face, exists := s.faces[key]
		if !exists {
			continue
		}
		originID := face.originID
		if originID == "" {
			originID = face.PersonID
		}
		if originID != "" {
			counts[originID]++
		}
	}
	return counts
}

func (s *PeopleService) peopleClusterFacesLocked(cluster *peopleCluster) []PersonFace {
	faces := make([]PersonFace, 0, len(cluster.members))
	for key := range cluster.members {
		if face, exists := s.faces[key]; exists {
			faces = append(faces, face)
		}
	}
	sort.Slice(faces, func(i, j int) bool { return personFaceLess(faces[i], faces[j]) })
	return faces
}

func peopleClusterComponentsHaveEvidence(leftIDs, rightIDs []string, evidence map[string]peopleClusterMergeEvidence) bool {
	for _, leftID := range leftIDs {
		for _, rightID := range rightIDs {
			if _, exists := evidence[peopleClusterPairKey(leftID, rightID)]; !exists {
				return false
			}
		}
	}
	return true
}

func (s *PeopleService) mergePeopleClustersLocked(keeperID, sourceID string) {
	s.matchRelationsStale = true
	keeper, source := s.clusters[keeperID], s.clusters[sourceID]
	if keeper == nil || source == nil || len(keeper.sum) != len(source.sum) {
		return
	}
	for index := range keeper.sum {
		keeper.sum[index] += source.sum[index]
	}
	keeper.count += source.count
	for key := range source.members {
		keeper.members[key] = struct{}{}
		face := s.faces[key]
		face.PersonID = keeperID
		s.faces[key] = face
	}
	for resourceID := range source.resources {
		keeper.resources[resourceID] = struct{}{}
	}
	if source.anchor.embedding != nil && (keeper.anchor.embedding == nil || personFaceLess(s.faces[source.anchor.key], s.faces[keeper.anchor.key])) {
		keeper.anchor = source.anchor
	}
	updatePeopleCentroid(keeper)
	// 合并后保留下来的分组中心变了，索引里的节点向量要跟着变。
	s.ann.Add(keeperID, keeper.centroid)
	delete(s.clusters, sourceID)
}

func peopleClusterHasMatchingAnchor(face PersonFace, cluster *peopleCluster) bool {
	return peopleClusterHasMatchingAnchorAtThreshold(face, cluster, qualityV2GroupingThresholds.anchorThreshold)
}

func peopleClusterHasMatchingAnchorAtThreshold(face PersonFace, cluster *peopleCluster, threshold float64) bool {
	if cluster.anchor.embedding == nil || face.ResourceID == cluster.anchor.resourceID {
		return false
	}
	if _, alreadyPresent := cluster.resources[face.ResourceID]; alreadyPresent {
		return false
	}
	return peopleCosine(face.embedding, cluster.anchor.embedding) > threshold
}

func updatePeopleCentroid(cluster *peopleCluster) {
	var norm float64
	for _, value := range cluster.sum {
		rounded := float32(value)
		norm += float64(rounded) * float64(rounded)
	}
	if norm == 0 {
		clear(cluster.centroid)
		return
	}
	length := float32(math.Sqrt(norm))
	for index, value := range cluster.sum {
		cluster.centroid[index] = float32(value) / length
	}
}

func (s *PeopleService) removeFaceLocked(key string) {
	s.matchRelationsStale = true
	face, exists := s.faces[key]
	if !exists {
		return
	}
	delete(s.faces, key)
	s.removeResourceFaceKeyLocked(face.ResourceID, key)
	cluster := s.clusters[face.PersonID]
	if cluster == nil {
		return
	}
	delete(cluster.members, key)
	if len(cluster.members) == 0 {
		// 分组没了，索引里的旧节点留着：查近邻时按分组 ID 回查，
		// 查不到的直接跳过。旧节点攒多了再整体重建索引。
		delete(s.clusters, face.PersonID)
		return
	}
	cluster.sum = make([]float64, len(face.embedding))
	cluster.count = 0
	cluster.resources = make(map[string]struct{}, len(cluster.members))
	cluster.anchor = peopleClusterAnchor{}
	memberKeys := make([]string, 0, len(cluster.members))
	for memberKey := range cluster.members {
		memberKeys = append(memberKeys, memberKey)
	}
	sort.Slice(memberKeys, func(i, j int) bool {
		return personFaceLess(s.faces[memberKeys[i]], s.faces[memberKeys[j]])
	})
	for _, memberKey := range memberKeys {
		member := s.faces[memberKey]
		for index, value := range member.embedding {
			cluster.sum[index] += float64(value)
		}
		cluster.count++
		cluster.resources[member.ResourceID] = struct{}{}
		if cluster.anchor.embedding == nil {
			cluster.anchor = peopleClusterAnchor{key: member.Key, resourceID: member.ResourceID, embedding: member.embedding}
		}
	}
	updatePeopleCentroid(cluster)
	// 分组少了一张脸，中心变了，索引里的节点向量要跟着变。
	s.ann.Add(face.PersonID, cluster.centroid)
}
