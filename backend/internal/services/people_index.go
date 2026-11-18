package services

// 本文件管可重建的人物索引：把人脸记录聚成组、按组维护中心与锚脸、
// 建 ANN 索引，以及增量到达时的局部更新。
//
// 索引落在 derived/ai/people-index-<model>.json，删了可以重算；
// 但重建时要把用户改过的地方迁移过去，不能静默丢掉。

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"sort"
)

// Sync rebuilds clusters from the existing face-analysis records after startup.
func (s *PeopleService) Sync(records []AIAnalysisRecord) error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.faceModelVersion == "" {
		for _, record := range records {
			if dimension := FaceEmbeddingDimensionForVersion(record.ModuleVersion); dimension != 0 {
				s.embeddingDimension = dimension
				break
			}
		}
	}
	previousIDs := cloneMap(s.previousIDs)
	sourceIsPhoto := s.sourceIsPhoto
	for key, face := range s.faces {
		previousIDs[key] = face.PersonID
	}
	faces := make(map[string]PersonFace)
	for _, record := range records {
		if sourceIsPhoto != nil && !sourceIsPhoto(record.ResourceID) {
			continue
		}
		for _, face := range s.facesFromRecord(record) {
			faces[face.Key] = face
		}
	}
	if s.matchesCachedAssignmentsLocked(faces) {
		s.restoreAssignmentsLocked(faces)
	} else {
		s.rebuildLocked(faces, previousIDs)
	}
	s.cleanAssignmentsLocked()
	return s.persistLocked()
}

func (s *PeopleService) matchesCachedAssignmentsLocked(faces map[string]PersonFace) bool {
	if len(faces) == 0 || len(faces) != len(s.cachedIDs) || len(faces) != len(s.cachedHashes) || len(faces) != len(s.cachedOrigins) {
		return false
	}
	for key, face := range faces {
		if s.cachedIDs[key] == "" || s.cachedHashes[key] != face.recordHash || s.cachedOrigins[key] == "" {
			return false
		}
	}
	return true
}

func (s *PeopleService) restoreAssignmentsLocked(faces map[string]PersonFace) {
	s.faces = make(map[string]PersonFace, len(faces))
	s.facesByResource = make(map[string][]string, len(faces))
	s.clusters = make(map[string]*peopleCluster)
	keys := make([]string, 0, len(faces))
	for key := range faces {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return personFaceLess(faces[keys[i]], faces[keys[j]]) })
	for _, key := range keys {
		face := faces[key]
		face.PersonID = s.cachedIDs[key]
		face.originID = s.cachedOrigins[key]
		s.faces[key] = face
		s.facesByResource[face.ResourceID] = append(s.facesByResource[face.ResourceID], key)
		cluster := s.clusters[face.PersonID]
		if cluster == nil {
			cluster = &peopleCluster{
				sum:       make([]float64, len(face.embedding)),
				centroid:  make([]float32, len(face.embedding)),
				members:   make(map[string]struct{}),
				resources: make(map[string]struct{}),
			}
			s.clusters[face.PersonID] = cluster
		}
		for index, value := range face.embedding {
			cluster.sum[index] += float64(value)
		}
		cluster.count++
		cluster.members[key] = struct{}{}
		cluster.resources[face.ResourceID] = struct{}{}
		if cluster.anchor.embedding == nil {
			cluster.anchor = peopleClusterAnchor{key: face.Key, resourceID: face.ResourceID, embedding: face.embedding}
		}
	}
	for _, cluster := range s.clusters {
		updatePeopleCentroid(cluster)
	}
	for resourceID := range s.facesByResource {
		sort.Strings(s.facesByResource[resourceID])
	}
	// The ANN graph is only needed when new faces arrive. Deferring its build
	// keeps warm application startup from rebuilding a large in-memory index.
	s.ann = nil
	s.comparisons = 0
}

// ApplyRecords updates affected resources without replacing the task system's records.
func (s *PeopleService) ApplyRecords(records []AIAnalysisRecord) error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.RLock()
	existingFaces := clonePeopleFaces(s.faces)
	existingFaceKeys := clonePeopleFaceKeys(s.facesByResource)
	previousIDs := cloneMap(s.previousIDs)
	cachedIDs := cloneMap(s.cachedIDs)
	cachedHashes := cloneMap(s.cachedHashes)
	cachedOrigins := cloneMap(s.cachedOrigins)
	sourceIsPhoto := s.sourceIsPhoto
	manual := clonePeopleManualState(s.manual)
	annAvailable := s.ann != nil
	comparisons := s.comparisons
	var clusters map[string]*peopleCluster
	if !annAvailable {
		clusters = clonePeopleClusters(s.clusters)
	}
	changed := false
	updatedFaces := existingFaces
	lastExisting := PersonFace{}
	for key, face := range existingFaces {
		previousIDs[key] = face.PersonID
		if lastExisting.Key == "" || personFaceLess(lastExisting, face) {
			lastExisting = face
		}
	}
	orderedRecords := append([]AIAnalysisRecord(nil), records...)
	sort.Slice(orderedRecords, func(i, j int) bool { return orderedRecords[i].ResourceID < orderedRecords[j].ResourceID })
	appendedFaces := make([]PersonFace, 0)
	appendOnly := true
	for _, record := range orderedRecords {
		if record.Type != AIJobTypeFace {
			continue
		}
		if s.faceModelVersion != "" && record.ModuleVersion != s.faceModelVersion {
			continue
		}
		var incoming []PersonFace
		if sourceIsPhoto == nil || sourceIsPhoto(record.ResourceID) {
			incoming = s.facesFromRecord(record)
		}
		current := make([]PersonFace, 0, len(existingFaceKeys[record.ResourceID]))
		for _, key := range existingFaceKeys[record.ResourceID] {
			if face, exists := existingFaces[key]; exists {
				current = append(current, face)
			}
		}
		if samePeopleFaces(current, incoming) {
			continue
		}
		for _, face := range current {
			delete(updatedFaces, face.Key)
			appendOnly = false
		}
		for _, face := range incoming {
			if lastExisting.Key != "" && !personFaceLess(lastExisting, face) {
				appendOnly = false
			}
			appendedFaces = append(appendedFaces, face)
			updatedFaces[face.Key] = face
		}
		changed = true
	}
	s.mu.RUnlock()
	if !changed {
		return nil
	}
	if appendOnly && annAvailable {
		sort.Slice(appendedFaces, func(i, j int) bool { return personFaceLess(appendedFaces[i], appendedFaces[j]) })
		s.mu.Lock()
		touchedClusters := make(map[string]struct{})
		for _, face := range appendedFaces {
			s.addFaceLocked(face)
			if added, exists := s.faces[face.Key]; exists {
				touchedClusters[added.PersonID] = struct{}{}
			}
		}
		s.consolidateClustersLocked(touchedClusters)
		s.cleanAssignmentsLocked()
		disk := s.indexSnapshotLocked()
		s.mu.Unlock()
		// 先落人工纠错，再落派生索引：纠错不可重建，索引可以。
		s.mu.Lock()
		if err := s.persistManualLocked(); err != nil {
			s.mu.Unlock()
			return err
		}
		s.updatePreviousIDsLocked()
		s.updateCachedAssignmentsLocked()
		s.mu.Unlock()
		return s.persistIndexSnapshot(disk)
	}

	candidate := &PeopleService{
		statePath: s.statePath, derivedPath: s.derivedPath,
		stateBasePath: s.stateBasePath, derivedBasePath: s.derivedBasePath,
		activeModel: s.activeModel, manualByModel: clonePeopleManualProfiles(s.manualByModel),
		faceModelVersion: s.faceModelVersion, embeddingDimension: s.embeddingDimension,
		previousIDs: previousIDs, cachedIDs: cachedIDs, cachedHashes: cachedHashes,
		cachedOrigins: cachedOrigins, manual: manual,
	}
	if appendOnly {
		candidate.faces = existingFaces
		candidate.facesByResource = existingFaceKeys
		candidate.clusters = clusters
		candidate.ann = nil
		candidate.comparisons = comparisons
		touchedClusters := make(map[string]struct{})
		sort.Slice(appendedFaces, func(i, j int) bool { return personFaceLess(appendedFaces[i], appendedFaces[j]) })
		for _, face := range appendedFaces {
			candidate.addFaceLocked(face)
			if added, exists := candidate.faces[face.Key]; exists {
				touchedClusters[added.PersonID] = struct{}{}
			}
		}
		candidate.consolidateClustersLocked(touchedClusters)
	} else {
		candidate.rebuildLocked(updatedFaces, previousIDs)
	}
	candidate.cleanAssignmentsLocked()
	return s.publishRebuiltIndex(candidate)
}

func clonePeopleFaces(source map[string]PersonFace) map[string]PersonFace {
	result := make(map[string]PersonFace, len(source))
	for key, face := range source {
		result[key] = face
	}
	return result
}

func clonePeopleFaceKeys(source map[string][]string) map[string][]string {
	result := make(map[string][]string, len(source))
	for resourceID, keys := range source {
		result[resourceID] = append([]string(nil), keys...)
	}
	return result
}

func clonePeopleClusters(source map[string]*peopleCluster) map[string]*peopleCluster {
	result := make(map[string]*peopleCluster, len(source))
	for id, cluster := range source {
		copy := *cluster
		copy.sum = append([]float64(nil), cluster.sum...)
		copy.centroid = append([]float32(nil), cluster.centroid...)
		copy.anchor.embedding = append([]float32(nil), cluster.anchor.embedding...)
		copy.members = make(map[string]struct{}, len(cluster.members))
		for key := range cluster.members {
			copy.members[key] = struct{}{}
		}
		copy.resources = make(map[string]struct{}, len(cluster.resources))
		for resourceID := range cluster.resources {
			copy.resources[resourceID] = struct{}{}
		}
		result[id] = &copy
	}
	return result
}

func (s *PeopleService) publishRebuiltIndex(candidate *PeopleService) error {
	// 先落人工纠错，再落派生索引：纠错不可重建，索引可以重算。
	// 索引写失败也要把纠错写下去，否则用户改过的名字会跟着这次重建一起丢。
	manualErr := candidate.persistManualLocked()
	candidate.updatePreviousIDsLocked()
	candidate.updateCachedAssignmentsLocked()
	indexErr := candidate.persistIndexSnapshot(candidate.indexSnapshotLocked())

	s.mu.Lock()
	s.faces = candidate.faces
	s.facesByResource = candidate.facesByResource
	s.clusters = candidate.clusters
	s.ann = candidate.ann
	s.previousIDs = candidate.previousIDs
	s.cachedIDs = candidate.cachedIDs
	s.cachedHashes = candidate.cachedHashes
	s.cachedOrigins = candidate.cachedOrigins
	s.manual = candidate.manual
	s.manualByModel = candidate.manualByModel
	s.comparisons = candidate.comparisons
	s.matchRelations = candidate.matchRelations
	s.matchRelationsStale = candidate.matchRelationsStale
	s.faceModelVersion = candidate.faceModelVersion
	s.embeddingDimension = candidate.embeddingDimension
	s.activeModel = candidate.activeModel
	s.mu.Unlock()
	if indexErr != nil {
		return indexErr
	}
	return manualErr
}

// rebuildLocked makes approximate centroid grouping independent of batch
// arrival order and remaps corrections through the largest face overlap.
func (s *PeopleService) rebuildLocked(faces map[string]PersonFace, previousIDs map[string]string) {
	keys := make([]string, 0, len(faces))
	for key := range faces {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return personFaceLess(faces[keys[i]], faces[keys[j]]) })
	s.faces = faces
	s.facesByResource = make(map[string][]string, len(faces))
	s.clusters = make(map[string]*peopleCluster)
	s.ann = newPeopleANNIndexForDimension(s.embeddingDimension)
	s.comparisons = 0
	for _, key := range keys {
		face := faces[key]
		face.originID = ""
		s.addFaceLocked(face)
	}
	s.consolidateClustersLocked(nil)
	s.remapCorrectionsLocked(previousIDs)
}

func personFaceLess(left, right PersonFace) bool {
	if left.ResourceID != right.ResourceID {
		return left.ResourceID < right.ResourceID
	}
	return left.FaceIndex < right.FaceIndex
}

func (s *PeopleService) remapCorrectionsLocked(previousIDs map[string]string) {
	newIDByKey := make(map[string]string, len(s.faces))
	for key, face := range s.faces {
		newIDByKey[key] = face.PersonID
	}
	type overlap struct {
		oldID string
		newID string
		count int
	}
	overlapsByOldID := make(map[string]map[string]int)
	for key, oldID := range previousIDs {
		newID := newIDByKey[key]
		if oldID == "" || newID == "" {
			continue
		}
		if overlapsByOldID[oldID] == nil {
			overlapsByOldID[oldID] = make(map[string]int)
		}
		overlapsByOldID[oldID][newID]++
	}
	var overlaps []overlap
	for oldID, destinations := range overlapsByOldID {
		for newID, count := range destinations {
			overlaps = append(overlaps, overlap{oldID: oldID, newID: newID, count: count})
		}
	}
	sort.Slice(overlaps, func(i, j int) bool {
		if overlaps[i].count != overlaps[j].count {
			return overlaps[i].count > overlaps[j].count
		}
		if (overlaps[i].oldID == overlaps[i].newID) != (overlaps[j].oldID == overlaps[j].newID) {
			return overlaps[i].oldID == overlaps[i].newID
		}
		if overlaps[i].oldID != overlaps[j].oldID {
			return overlaps[i].oldID < overlaps[j].oldID
		}
		return overlaps[i].newID < overlaps[j].newID
	})
	oldToNew := make(map[string]string, len(overlapsByOldID))
	overlapCount := make(map[string]int, len(overlapsByOldID))
	for _, candidate := range overlaps {
		if _, decided := oldToNew[candidate.oldID]; !decided {
			oldToNew[candidate.oldID] = candidate.newID
			overlapCount[candidate.oldID] = candidate.count
		}
	}
	// If automatic clustering now combines multiple previously corrected
	// people, keep each corrected group distinct until the user merges it.
	// Otherwise two labels would collapse to one ID and one would be lost.
	destinationByOldID := make(map[string]string, len(previousIDs))
	for oldID, newID := range oldToNew {
		destinationByOldID[oldID] = newID
	}
	for key, oldID := range previousIDs {
		if destinationByOldID[oldID] == "" && newIDByKey[key] == oldID {
			destinationByOldID[oldID] = oldID
		}
	}
	oldIDsByDestination := make(map[string][]string)
	for oldID, newID := range destinationByOldID {
		oldIDsByDestination[newID] = append(oldIDsByDestination[newID], oldID)
	}
	referencedIDs := peopleReferencedIDs(s.manual)
	pinnedOldIDs := make(map[string]bool)
	for oldID, destinations := range overlapsByOldID {
		if referencedIDs[oldID] && len(destinations) > 1 {
			// Keep the complete previously corrected group together when new
			// embeddings would otherwise split it across automatic clusters.
			pinnedOldIDs[oldID] = true
		}
	}
	correctedByDestination := make(map[string][]string)
	for newID, oldIDs := range oldIDsByDestination {
		if len(oldIDs) < 2 {
			continue
		}
		for _, oldID := range oldIDs {
			if referencedIDs[oldID] && !pinnedOldIDs[oldID] {
				correctedByDestination[newID] = append(correctedByDestination[newID], oldID)
			}
		}
	}
	for newID, oldIDs := range correctedByDestination {
		destinationWasAnOldID := destinationByOldID[newID] == newID
		if destinationWasAnOldID && !referencedIDs[newID] {
			for _, oldID := range oldIDs {
				pinnedOldIDs[oldID] = true
			}
			continue
		}
		sort.Slice(oldIDs, func(i, j int) bool {
			// Keep an existing cluster whose stable ID is still the destination.
			// Otherwise prefer the corrected group with the most surviving faces.
			if (oldIDs[i] == newID) != (oldIDs[j] == newID) {
				return oldIDs[i] == newID
			}
			if overlapCount[oldIDs[i]] != overlapCount[oldIDs[j]] {
				return overlapCount[oldIDs[i]] > overlapCount[oldIDs[j]]
			}
			return oldIDs[i] < oldIDs[j]
		})
		keeper := oldIDs[0]
		for _, oldID := range oldIDs {
			if oldID != keeper {
				pinnedOldIDs[oldID] = true
			}
		}
	}
	if len(oldToNew) == 0 && len(pinnedOldIDs) == 0 {
		return
	}
	for key, oldID := range previousIDs {
		if pinnedOldIDs[oldID] && s.manual.Assignments[key] == "" {
			s.manual.Assignments[key] = oldID
		}
	}

	names := make(map[string]string, len(s.manual.Names))
	hidden := make(map[string]bool, len(s.manual.Hidden))
	for id, name := range s.manual.Names {
		if _, remapped := oldToNew[id]; !remapped || pinnedOldIDs[id] {
			names[id] = name
		}
	}
	for id, value := range s.manual.Hidden {
		if _, remapped := oldToNew[id]; !remapped || pinnedOldIDs[id] {
			hidden[id] = value
		}
	}
	for _, candidate := range overlaps {
		if oldToNew[candidate.oldID] != candidate.newID || pinnedOldIDs[candidate.oldID] {
			continue
		}
		if name := s.manual.Names[candidate.oldID]; name != "" && names[candidate.newID] == "" {
			names[candidate.newID] = name
		}
		if s.manual.Hidden[candidate.oldID] {
			hidden[candidate.newID] = true
		}
	}
	for key, id := range s.manual.Assignments {
		if newID := oldToNew[id]; newID != "" && !pinnedOldIDs[id] {
			s.manual.Assignments[key] = newID
		}
	}
	for key, id := range s.manual.PinnedFaces {
		if newID := oldToNew[id]; newID != "" && !pinnedOldIDs[id] {
			s.manual.PinnedFaces[key] = newID
		}
	}
	retainedGroups := make(map[string]bool, len(s.manual.RetainedGroups))
	for id, retained := range s.manual.RetainedGroups {
		if !retained {
			continue
		}
		if newID := oldToNew[id]; newID != "" && !pinnedOldIDs[id] {
			retainedGroups[newID] = true
		} else {
			retainedGroups[id] = true
		}
	}
	s.manual.RetainedGroups = retainedGroups
	s.manual.Names = names
	s.manual.Hidden = hidden
}

func (s *PeopleService) rebuildPeopleANNLocked() {
	s.ann = newPeopleANNIndexForDimension(s.embeddingDimension)
	clusterIDs := make([]string, 0, len(s.clusters))
	for id := range s.clusters {
		clusterIDs = append(clusterIDs, id)
	}
	sort.Strings(clusterIDs)
	for _, id := range clusterIDs {
		s.ann.Add(id, s.clusters[id].centroid)
	}
}

func (s *PeopleService) facesForResourceLocked(resourceID string) []PersonFace {
	keys := s.facesByResource[resourceID]
	result := make([]PersonFace, 0, len(keys))
	for _, key := range keys {
		if face, exists := s.faces[key]; exists {
			result = append(result, face)
		}
	}
	return result
}

func (s *PeopleService) removeResourceFaceKeyLocked(resourceID, key string) {
	keys := s.facesByResource[resourceID]
	for index, current := range keys {
		if current == key {
			keys = append(keys[:index], keys[index+1:]...)
			break
		}
	}
	if len(keys) == 0 {
		delete(s.facesByResource, resourceID)
	} else {
		s.facesByResource[resourceID] = keys
	}
}

func peopleFacesFromRecord(record AIAnalysisRecord) []PersonFace {
	return peopleFacesFromRecordWithDimension(record, FaceEmbeddingDimensionForVersion(record.ModuleVersion))
}

func peopleFacesFromRecordWithDimension(record AIAnalysisRecord, dimension int) []PersonFace {
	if record.Type != AIJobTypeFace ||
		!SupportsFaceAnalyzerVersion(record.ModuleVersion) ||
		record.Status != "faces_found" || dimension == 0 ||
		FaceEmbeddingDimensionForVersion(record.ModuleVersion) != dimension {
		return nil
	}
	var result struct {
		Faces []struct {
			Box       []float32 `json:"box"`
			Score     float32   `json:"score"`
			Embedding []float32 `json:"embedding"`
		} `json:"faces"`
	}
	if json.Unmarshal(record.Data, &result) != nil || len(result.Faces) > PeopleMaxFacesPerPhoto {
		return nil
	}
	hash := sha256.Sum256(record.Data)
	faces := make([]PersonFace, 0, len(result.Faces))
	minimumScore := faceDetectionMinimumScore
	if record.ModuleVersion == FaceAnalyzerBuffaloMVersion {
		minimumScore = faceDetectionMinScoreM
	}
	for index, face := range result.Faces {
		if len(face.Embedding) != dimension || len(face.Box) != 4 ||
			math.IsNaN(float64(face.Score)) || math.IsInf(float64(face.Score), 0) ||
			face.Score < minimumScore {
			continue
		}
		validBox := true
		for _, value := range face.Box {
			if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
				validBox = false
				break
			}
		}
		if !validBox || face.Box[2] < faceDetectionMinimumBoxSide || face.Box[3] < faceDetectionMinimumBoxSide {
			continue
		}
		vector := normalizedVector(face.Embedding)
		if vector == nil {
			continue
		}
		key := PersonFaceKey(record.ResourceID, index)
		faces = append(faces, PersonFace{
			Key: key, ResourceID: record.ResourceID, FaceIndex: index, Box: append([]float32(nil), face.Box...),
			Score: face.Score, Size: record.Size, MTimeNs: record.MTimeNs, embedding: vector,
			recordHash: hex.EncodeToString(hash[:]),
		})
	}
	return faces
}

func (s *PeopleService) facesFromRecord(record AIAnalysisRecord) []PersonFace {
	if s.faceModelVersion != "" && record.ModuleVersion != s.faceModelVersion {
		return nil
	}
	dimension := s.embeddingDimension
	if s.faceModelVersion == "" {
		dimension = FaceEmbeddingDimensionForVersion(record.ModuleVersion)
	}
	faces := peopleFacesFromRecordWithDimension(record, dimension)
	if len(faces) == 0 || record.ModuleVersion == FaceAnalyzerVersion ||
		record.ModuleVersion == FaceAnalyzerBuffaloMVersion || s.sourceDimensions == nil {
		return faces
	}
	dimensions := s.sourceDimensions(record.ResourceID)
	if !dimensions.Known() {
		return faces
	}
	longSide := max(dimensions.Width, dimensions.Height)
	scale := math.Min(1, float64(faceAnalyzerInputMaxDimension)/float64(longSide))
	filtered := faces[:0]
	for _, face := range faces {
		if float64(min(face.Box[2], face.Box[3]))*scale >= float64(faceDetectionMinimumBoxSide) {
			filtered = append(filtered, face)
		}
	}
	return filtered
}

func PersonFaceKey(resourceID string, faceIndex int) string {
	return fmt.Sprintf("%s#%d", resourceID, faceIndex)
}

func samePeopleFaces(left, right []PersonFace) bool {
	if len(left) != len(right) {
		return false
	}
	byKey := make(map[string]PersonFace, len(left))
	for _, face := range left {
		byKey[face.Key] = face
	}
	for _, face := range right {
		previous, exists := byKey[face.Key]
		if !exists || previous.Size != face.Size || previous.MTimeNs != face.MTimeNs || previous.recordHash != face.recordHash {
			return false
		}
	}
	return true
}

func normalizedVector(values []float32) []float32 {
	if len(values) != peopleEmbeddingDimension && len(values) != peopleBuffaloMDimension {
		return nil
	}
	var norm float64
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

func normalizedCentroid(sum []float64) []float32 {
	vector := make([]float32, len(sum))
	for index, value := range sum {
		vector[index] = float32(value)
	}
	return normalizedVector(vector)
}

func peopleCosine(left, right []float32) float64 {
	if len(left) == 0 || len(left) != len(right) {
		return -1
	}
	var score float64
	for index, value := range left {
		score += float64(value) * float64(right[index])
	}
	return score
}

func stablePersonID(faceKey string) string {
	hash := sha256.Sum256([]byte(faceKey))
	return "p_" + hex.EncodeToString(hash[:8])
}

func (s *PeopleService) effectivePersonIDLocked(face PersonFace) string {
	if assigned := s.manual.Assignments[face.Key]; assigned != "" {
		return assigned
	}
	return face.PersonID
}
