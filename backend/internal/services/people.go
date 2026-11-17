package services

import (
	"container/heap"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode"
)

const (
	peopleIndexVersion       = 1
	peopleGroupingVersion    = 14
	peopleEmbeddingDimension = 128
	peopleBuffaloMDimension  = 512
	faceDetectionMinScoreM   = float32(0.5)
	peopleMaxSplitFaces      = 200
)

// PeopleGroupingCentroidThreshold keeps approximate group lookup focused on nearby centers.
const PeopleGroupingCentroidThreshold = 0.52

// peopleGroupingANNScoreMargin keeps borderline float32 ANN scores on the
// exact float64 centroid path before applying the grouping threshold.
const peopleGroupingANNScoreMargin = 0.001

// PeopleGroupingAnchorThreshold keeps every cluster member close to its
// immutable seed, preventing slowly drifting centroids from chaining identities.
const PeopleGroupingAnchorThreshold = 0.72

var (
	ErrPersonNotFound = errors.New("person not found")
	ErrInvalidPerson  = errors.New("invalid person change")
)

type PersonFace struct {
	Key        string    `json:"key"`
	ResourceID string    `json:"resourceId"`
	FaceIndex  int       `json:"faceIndex"`
	PersonID   string    `json:"personId"`
	Box        []float32 `json:"box"`
	Score      float32   `json:"score"`
	Size       int64     `json:"-"`
	MTimeNs    int64     `json:"-"`
	embedding  []float32
	recordHash string
}

type PersonGroup struct {
	ID              string              `json:"id"`
	Name            string              `json:"name"`
	FaceCount       int                 `json:"faceCount"`
	PhotoCount      int                 `json:"photoCount"`
	FolderCount     int                 `json:"folderCount,omitempty"`
	CoverResourceID string              `json:"coverResourceId,omitempty"`
	Hidden          bool                `json:"hidden"`
	Quality         *PersonGroupQuality `json:"quality,omitempty"`
}

// PersonGroupQuality describes the lower tenth percentile of each group's
// stored similarity and detector confidence scores. It prioritizes manual
// review; it is not an identity probability.
type PersonGroupQuality struct {
	AnchorP10    float64 `json:"anchorP10"`
	CentroidP10  float64 `json:"centroidP10"`
	DetectionP10 float64 `json:"detectionP10"`
}

// PeopleAlbumGroup is a person's current photo membership inside one album.
// It contains no face embedding or file path.
type PeopleAlbumGroup struct {
	Group       PersonGroup
	ResourceIDs []string
	Fingerprint string
}

// PeopleCorrections contains user-owned labels and assignments, never embeddings.
type PeopleCorrections struct {
	Version     int                                `json:"version"`
	Names       map[string]string                  `json:"names"`
	Hidden      map[string]bool                    `json:"hidden"`
	Assignments map[string]string                  `json:"assignments"`
	Profiles    map[string]PeopleCorrectionProfile `json:"profiles,omitempty"`
}

// PeopleCorrectionProfile 保存单个人脸模型的名称与人工分配。
type PeopleCorrectionProfile struct {
	Version     int               `json:"version"`
	Names       map[string]string `json:"names"`
	Hidden      map[string]bool   `json:"hidden"`
	Assignments map[string]string `json:"assignments"`
}

type peopleFaceDisk struct {
	Key        string    `json:"key"`
	ResourceID string    `json:"resourceId"`
	FaceIndex  int       `json:"faceIndex"`
	ClusterID  string    `json:"clusterId"`
	Box        []float32 `json:"box"`
	Score      float32   `json:"score"`
	Size       int64     `json:"size"`
	MTimeNs    int64     `json:"mtimeNs"`
	RecordHash string    `json:"recordHash"`
}

type peopleIndexDisk struct {
	Version         int              `json:"version"`
	GroupingVersion int              `json:"groupingVersion"`
	Faces           []peopleFaceDisk `json:"faces"`
}

type peopleManualState = PeopleCorrections

type peopleCluster struct {
	sum       []float64
	centroid  []float32
	anchor    peopleClusterAnchor
	count     int
	members   map[string]struct{}
	resources map[string]struct{}
}

type peopleClusterAnchor struct {
	key        string
	resourceID string
	embedding  []float32
}

// PeopleService keeps a rebuildable face grouping index separate from the small
// user-owned names, visibility flags, and corrections stored under state/.
type PeopleService struct {
	mu                 sync.RWMutex
	persistMu          sync.Mutex
	statePath          string
	derivedPath        string
	stateBasePath      string
	derivedBasePath    string
	legacyPending      bool
	activeModel        string
	sourceIsPhoto      func(string) bool
	sourceDimensions   func(string) MediaDimensions
	faces              map[string]PersonFace
	facesByResource    map[string][]string
	clusters           map[string]*peopleCluster
	ann                *peopleANNIndex
	previousIDs        map[string]string
	cachedIDs          map[string]string
	cachedHashes       map[string]string
	manual             peopleManualState
	manualByModel      map[string]peopleManualState
	comparisons        int
	faceModelVersion   string
	embeddingDimension int
}

func OpenPeopleService(statePath, derivedPath string) (*PeopleService, error) {
	if statePath == "" || derivedPath == "" {
		return nil, os.ErrInvalid
	}
	service := &PeopleService{
		statePath: statePath, derivedPath: derivedPath,
		stateBasePath: statePath, derivedBasePath: derivedPath,
		faces: make(map[string]PersonFace), facesByResource: make(map[string][]string),
		clusters: make(map[string]*peopleCluster), ann: newPeopleANNIndex(),
		embeddingDimension: peopleEmbeddingDimension,
		previousIDs:        make(map[string]string),
		cachedIDs:          make(map[string]string),
		cachedHashes:       make(map[string]string),
		manual:             emptyPeopleManualState(),
		manualByModel:      make(map[string]peopleManualState),
	}
	if err := service.loadProfileLocked(); err != nil {
		return nil, err
	}
	if err := service.loadProfileIndexLocked(); err != nil {
		return nil, err
	}
	service.legacyPending = pathExists(statePath) || pathExists(derivedPath)
	return service, nil
}

func (s *PeopleService) loadProfileLocked() error {
	s.manual = emptyPeopleManualState()
	data, err := os.ReadFile(s.statePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil {
		var state peopleManualState
		if json.Unmarshal(data, &state) == nil && state.Version == peopleIndexVersion {
			s.manual = normalizePeopleManualState(state)
		}
	}
	return nil
}

func (s *PeopleService) loadProfileIndexLocked() error {
	s.previousIDs = make(map[string]string)
	s.cachedIDs = make(map[string]string)
	s.cachedHashes = make(map[string]string)
	data, err := os.ReadFile(s.derivedPath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err != nil {
		return nil
	}
	var index peopleIndexDisk
	if json.Unmarshal(data, &index) != nil || index.Version != peopleIndexVersion {
		return nil
	}
	referencedIDs := peopleReferencedIDs(s.manual)
	cacheValid := index.GroupingVersion == peopleGroupingVersion
	if cacheValid {
		s.cachedIDs = make(map[string]string, len(index.Faces))
		s.cachedHashes = make(map[string]string, len(index.Faces))
	}
	for _, face := range index.Faces {
		if face.Key != "" && referencedIDs[face.ClusterID] {
			s.previousIDs[face.Key] = face.ClusterID
		}
		if !cacheValid {
			continue
		}
		if face.Key == "" || !validPersonID(face.ClusterID) || len(face.RecordHash) != sha256.Size*2 {
			cacheValid = false
			break
		}
		s.cachedIDs[face.Key] = face.ClusterID
		s.cachedHashes[face.Key] = face.RecordHash
	}
	if !cacheValid {
		s.cachedIDs = nil
		s.cachedHashes = nil
	}
	return nil
}

func peopleProfilePath(basePath, model string) string {
	extension := filepath.Ext(basePath)
	return strings.TrimSuffix(basePath, extension) + "-" + model + extension
}

func peopleModelForVersion(version string) (string, bool) {
	if version == FaceAnalyzerBuffaloMVersion {
		return FaceModelBuffaloM, true
	}
	if SupportsFaceAnalyzerVersion(version) {
		return FaceModelQualityV2, true
	}
	return "", false
}

func pathExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// SetFaceAnalyzerVersion 为当前人脸模型选择独立的人物状态与索引。
// 首次选择的模型会接管旧版共享文件，保留隔离前正在使用的数据。
func (s *PeopleService) SetFaceAnalyzerVersion(version string) error {
	dimension := FaceEmbeddingDimensionForVersion(version)
	model, knownModel := peopleModelForVersion(version)
	if dimension == 0 || !knownModel {
		return errors.New("unsupported face analyzer version")
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.faceModelVersion == version && s.embeddingDimension == dimension {
		return nil
	}
	if s.faceModelVersion != "" && s.activeModel == model {
		for key, face := range s.faces {
			s.previousIDs[key] = face.PersonID
		}
		s.faceModelVersion = version
		s.embeddingDimension = dimension
		s.cachedIDs = nil
		s.cachedHashes = nil
		return nil
	}
	if s.faceModelVersion != "" {
		if err := s.persistLocked(); err != nil {
			return err
		}
		s.manualByModel[s.activeModel] = clonePeopleManualState(s.manual)
	}

	statePath := peopleProfilePath(s.stateBasePath, model)
	derivedPath := peopleProfilePath(s.derivedBasePath, model)
	if s.faceModelVersion == "" && s.legacyPending {
		if !pathExists(statePath) && !pathExists(derivedPath) {
			if err := writeAIJSONAtomic(statePath, s.manual); err != nil {
				return err
			}
			if data, err := os.ReadFile(s.derivedBasePath); err == nil {
				var index peopleIndexDisk
				if json.Unmarshal(data, &index) == nil && index.Version == peopleIndexVersion {
					if err := writeAIJSONAtomic(derivedPath, index); err != nil {
						return err
					}
				}
			} else if !os.IsNotExist(err) {
				return err
			}
			if err := os.Remove(s.stateBasePath); err != nil && !os.IsNotExist(err) {
				return err
			}
			if err := os.Remove(s.derivedBasePath); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
		s.legacyPending = false
	}
	s.statePath = statePath
	s.derivedPath = derivedPath
	s.activeModel = model
	s.faceModelVersion = version
	s.embeddingDimension = dimension
	s.faces = make(map[string]PersonFace)
	s.facesByResource = make(map[string][]string)
	s.clusters = make(map[string]*peopleCluster)
	s.ann = newPeopleANNIndexForDimension(dimension)
	s.comparisons = 0
	if manual, exists := s.manualByModel[model]; exists {
		s.manual = clonePeopleManualState(manual)
	} else if err := s.loadProfileLocked(); err != nil {
		return err
	}
	if err := s.loadProfileIndexLocked(); err != nil {
		return err
	}
	s.manualByModel[model] = clonePeopleManualState(s.manual)
	return nil
}

// SetSourceDimensions enables analysis-scale face-size filtering for older
// records whose boxes are in source-image coordinates. Set it before Sync or
// ApplyRecords so cache rebuilds and incremental updates use the same rule.
func (s *PeopleService) SetSourceDimensions(lookup func(resourceID string) MediaDimensions) {
	s.mu.Lock()
	s.sourceDimensions = lookup
	s.mu.Unlock()
}

// SetSourceIsPhoto restricts face records to resources that belong to photo albums.
// Set it before Sync or ApplyRecords so startup rebuilds and live updates share
// the same media scope.
func (s *PeopleService) SetSourceIsPhoto(lookup func(resourceID string) bool) {
	s.mu.Lock()
	s.sourceIsPhoto = lookup
	s.mu.Unlock()
}

func emptyPeopleManualState() peopleManualState {
	return peopleManualState{Version: peopleIndexVersion, Names: map[string]string{}, Hidden: map[string]bool{}, Assignments: map[string]string{}}
}

func normalizePeopleManualState(state peopleManualState) peopleManualState {
	if state.Names == nil {
		state.Names = map[string]string{}
	}
	if state.Hidden == nil {
		state.Hidden = map[string]bool{}
	}
	if state.Assignments == nil {
		state.Assignments = map[string]string{}
	}
	state.Version = peopleIndexVersion
	return state
}

func peopleReferencedIDs(state peopleManualState) map[string]bool {
	result := make(map[string]bool, len(state.Names)+len(state.Hidden)+len(state.Assignments))
	for id := range state.Names {
		result[id] = true
	}
	for id := range state.Hidden {
		result[id] = true
	}
	for _, id := range state.Assignments {
		result[id] = true
	}
	return result
}

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
	previousIDs := cloneStringMap(s.previousIDs)
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
	if len(faces) == 0 || len(faces) != len(s.cachedIDs) || len(faces) != len(s.cachedHashes) {
		return false
	}
	for key, face := range faces {
		if s.cachedIDs[key] == "" || s.cachedHashes[key] != face.recordHash {
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
	previousIDs := cloneStringMap(s.previousIDs)
	cachedIDs := cloneStringMap(s.cachedIDs)
	cachedHashes := cloneStringMap(s.cachedHashes)
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
		for _, face := range appendedFaces {
			s.addFaceLocked(face)
		}
		s.cleanAssignmentsLocked()
		disk := s.indexSnapshotLocked()
		s.mu.Unlock()
		if err := s.persistIndexSnapshot(disk); err != nil {
			return err
		}
		s.mu.Lock()
		defer s.mu.Unlock()
		s.updatePreviousIDsLocked()
		s.updateCachedAssignmentsLocked()
		return s.persistManualLocked()
	}

	candidate := &PeopleService{
		statePath: s.statePath, derivedPath: s.derivedPath,
		stateBasePath: s.stateBasePath, derivedBasePath: s.derivedBasePath,
		activeModel: s.activeModel, manualByModel: clonePeopleManualProfiles(s.manualByModel),
		faceModelVersion: s.faceModelVersion, embeddingDimension: s.embeddingDimension,
		previousIDs: previousIDs, cachedIDs: cachedIDs, cachedHashes: cachedHashes, manual: manual,
	}
	if appendOnly {
		candidate.faces = existingFaces
		candidate.facesByResource = existingFaceKeys
		candidate.clusters = clusters
		candidate.ann = nil
		candidate.comparisons = comparisons
		sort.Slice(appendedFaces, func(i, j int) bool { return personFaceLess(appendedFaces[i], appendedFaces[j]) })
		for _, face := range appendedFaces {
			candidate.addFaceLocked(face)
		}
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

func clonePeopleManualState(state peopleManualState) peopleManualState {
	return normalizePeopleManualState(peopleManualState{
		Version: state.Version, Names: cloneStringMap(state.Names),
		Hidden: cloneBoolMap(state.Hidden), Assignments: cloneStringMap(state.Assignments),
	})
}

func clonePeopleManualProfiles(source map[string]peopleManualState) map[string]peopleManualState {
	result := make(map[string]peopleManualState, len(source))
	for model, state := range source {
		result[model] = clonePeopleManualState(state)
	}
	return result
}

func (s *PeopleService) publishRebuiltIndex(candidate *PeopleService) error {
	indexErr := candidate.persistIndexSnapshot(candidate.indexSnapshotLocked())
	var manualErr error
	if indexErr == nil {
		candidate.updatePreviousIDsLocked()
		candidate.updateCachedAssignmentsLocked()
		manualErr = candidate.persistManualLocked()
	}

	s.mu.Lock()
	s.faces = candidate.faces
	s.facesByResource = candidate.facesByResource
	s.clusters = candidate.clusters
	s.ann = candidate.ann
	s.previousIDs = candidate.previousIDs
	s.cachedIDs = candidate.cachedIDs
	s.cachedHashes = candidate.cachedHashes
	s.manual = candidate.manual
	s.manualByModel = candidate.manualByModel
	s.comparisons = candidate.comparisons
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
		s.addFaceLocked(faces[key])
	}
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
	s.manual.Names = names
	s.manual.Hidden = hidden
}

func (s *PeopleService) addFaceLocked(face PersonFace) {
	if s.ann == nil {
		s.rebuildPeopleANNLocked()
	}
	bestID := ""
	bestScore := PeopleGroupingCentroidThreshold
	for _, candidate := range s.ann.Search(face.embedding, peopleANNCandidateLimit) {
		id := candidate.id
		cluster := s.clusters[id]
		if cluster == nil {
			continue
		}
		if candidate.score <= float32(PeopleGroupingCentroidThreshold-peopleGroupingANNScoreMargin) {
			continue
		}
		s.comparisons++
		score := peopleCosine(face.embedding, cluster.centroid)
		if score <= PeopleGroupingCentroidThreshold || !peopleClusterHasMatchingAnchor(face, cluster) {
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
	if newCluster {
		s.ann.Add(bestID, cluster.centroid)
	}
	face.PersonID = bestID
	s.faces[face.Key] = face
	if s.facesByResource == nil {
		s.facesByResource = make(map[string][]string)
	}
	s.facesByResource[face.ResourceID] = append(s.facesByResource[face.ResourceID], face.Key)
}

func peopleClusterHasMatchingAnchor(face PersonFace, cluster *peopleCluster) bool {
	if cluster.anchor.embedding == nil || face.ResourceID == cluster.anchor.resourceID {
		return false
	}
	if _, alreadyPresent := cluster.resources[face.ResourceID]; alreadyPresent {
		return false
	}
	return peopleCosine(face.embedding, cluster.anchor.embedding) > PeopleGroupingAnchorThreshold
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
		delete(s.clusters, face.PersonID)
		s.rebuildPeopleANNLocked()
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
	if json.Unmarshal(record.Data, &result) != nil || len(result.Faces) > 100 {
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

func (s *PeopleService) Groups(includeHidden bool) []PersonGroup {
	s.mu.RLock()
	defer s.mu.RUnlock()
	ordinals := s.personOrdinalNamesLocked()
	groups := make(map[string]*PersonGroup)
	photos := make(map[string]map[string]struct{})
	for _, face := range s.faces {
		id := s.effectivePersonIDLocked(face)
		group := groups[id]
		if group == nil {
			group = &PersonGroup{ID: id, Name: s.personNameLocked(id, ordinals), Hidden: s.manual.Hidden[id]}
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
					group:  PersonGroup{ID: personID, Name: s.personNameLocked(personID, ordinals), Hidden: s.manual.Hidden[personID]},
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
			group = &PersonGroup{ID: id, Name: s.personNameLocked(id, ordinals), Hidden: s.manual.Hidden[id]}
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
			group = &PersonGroup{ID: id, Name: name, Hidden: s.manual.Hidden[id]}
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

type peopleGroupQualitySamples struct {
	anchor   []float32
	fallback PersonFace
	sum      []float64
	members  []PersonFace
}

func (samples *peopleGroupQualitySamples) summarize() *PersonGroupQuality {
	if len(samples.members) == 0 {
		return nil
	}
	anchor := samples.anchor
	if len(anchor) != len(samples.fallback.embedding) {
		anchor = samples.fallback.embedding
	}
	centroid := normalizedCentroid(samples.sum)
	anchorScores := make([]float64, 0, len(samples.members))
	centroidScores := make([]float64, 0, len(samples.members))
	detectionScores := make([]float64, 0, len(samples.members))
	for _, face := range samples.members {
		anchorScores = append(anchorScores, peopleCosine(face.embedding, anchor))
		centroidScores = append(centroidScores, peopleCosine(face.embedding, centroid))
		detectionScores = append(detectionScores, float64(face.Score))
	}
	return &PersonGroupQuality{
		AnchorP10:    peopleP10(anchorScores),
		CentroidP10:  peopleP10(centroidScores),
		DetectionP10: peopleP10(detectionScores),
	}
}

func peopleP10(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sort.Float64s(values)
	index := int(math.Floor(float64(len(values)-1) * 0.1))
	return math.Round(values[index]*1000) / 1000
}

func peopleGroupReviewRanksBefore(left, right PersonGroup) bool {
	leftQuality, rightQuality := left.Quality, right.Quality
	if leftQuality != nil && rightQuality != nil {
		if leftQuality.AnchorP10 != rightQuality.AnchorP10 {
			return leftQuality.AnchorP10 < rightQuality.AnchorP10
		}
		if leftQuality.CentroidP10 != rightQuality.CentroidP10 {
			return leftQuality.CentroidP10 < rightQuality.CentroidP10
		}
		if leftQuality.DetectionP10 != rightQuality.DetectionP10 {
			return leftQuality.DetectionP10 < rightQuality.DetectionP10
		}
	}
	if left.PhotoCount != right.PhotoCount {
		return left.PhotoCount > right.PhotoCount
	}
	return left.ID < right.ID
}

// GroupAndFaces returns one group's current summary and its faces in one pass.
func (s *PeopleService) GroupAndFaces(personID string) (PersonGroup, []PersonFace, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	group := PersonGroup{ID: personID, Name: s.personNameLocked(personID, s.personOrdinalNamesLocked()), Hidden: s.manual.Hidden[personID]}
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
	if left.PhotoCount != right.PhotoCount {
		return left.PhotoCount > right.PhotoCount
	}
	if left.CoverResourceID != right.CoverResourceID {
		return left.CoverResourceID < right.CoverResourceID
	}
	return left.ID < right.ID
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

// GroupFolderPhotoCounts returns distinct-photo counts per opaque source-folder
// key for each current person group. The callback returns an empty key for
// resources outside the current photo library.
func (s *PeopleService) GroupFolderPhotoCounts(folderForResource func(string) string) map[string]map[string]int {
	counts := make(map[string]map[string]int)
	if folderForResource == nil {
		return counts
	}

	s.mu.RLock()
	defer s.mu.RUnlock()

	resourceFolders := make(map[string]string)
	seenGroupResources := make(map[string]struct{})
	for _, face := range s.faces {
		folder, resolved := resourceFolders[face.ResourceID]
		if !resolved {
			folder = folderForResource(face.ResourceID)
			resourceFolders[face.ResourceID] = folder
		}
		if folder == "" {
			continue
		}
		groupID := s.effectivePersonIDLocked(face)
		groupResourceKey := groupID + "\x00" + face.ResourceID
		if _, counted := seenGroupResources[groupResourceKey]; counted {
			continue
		}
		seenGroupResources[groupResourceKey] = struct{}{}
		if counts[groupID] == nil {
			counts[groupID] = make(map[string]int)
		}
		counts[groupID][folder]++
	}
	return counts
}

func (s *PeopleService) Rename(personID, name string) error {
	name = strings.TrimSpace(name)
	if len([]rune(name)) > 60 || strings.IndexFunc(name, unicode.IsControl) >= 0 {
		return ErrInvalidPerson
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPersonLocked(personID) {
		return ErrPersonNotFound
	}
	if name == "" {
		delete(s.manual.Names, personID)
	} else {
		s.manual.Names[personID] = name
	}
	return s.persistManualLocked()
}

func (s *PeopleService) SetHidden(personID string, hidden bool) error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPersonLocked(personID) {
		return ErrPersonNotFound
	}
	if hidden {
		s.manual.Hidden[personID] = true
	} else {
		delete(s.manual.Hidden, personID)
	}
	return s.persistManualLocked()
}

func (s *PeopleService) Merge(sourceID, targetID string) error {
	if sourceID == targetID || !validPersonID(sourceID) || !validPersonID(targetID) {
		return ErrInvalidPerson
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPersonLocked(sourceID) || !s.hasPersonLocked(targetID) {
		return ErrPersonNotFound
	}
	for key, face := range s.faces {
		if s.effectivePersonIDLocked(face) == sourceID {
			s.manual.Assignments[key] = targetID
		}
	}
	delete(s.manual.Names, sourceID)
	delete(s.manual.Hidden, sourceID)
	return s.persistManualLocked()
}

func (s *PeopleService) Split(personID string, faceKeys []string) (string, error) {
	if !validPersonID(personID) || len(faceKeys) == 0 || len(faceKeys) > peopleMaxSplitFaces {
		return "", ErrInvalidPerson
	}
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.hasPersonLocked(personID) {
		return "", ErrPersonNotFound
	}
	selected := make(map[string]struct{}, len(faceKeys))
	for _, key := range faceKeys {
		face, exists := s.faces[key]
		if !exists || s.effectivePersonIDLocked(face) != personID {
			return "", ErrInvalidPerson
		}
		selected[key] = struct{}{}
	}
	if len(selected) >= s.FacesLocked(personID) {
		return "", ErrInvalidPerson
	}
	newID, err := newManualPersonID()
	if err != nil {
		return "", err
	}
	for key := range selected {
		s.manual.Assignments[key] = newID
	}
	s.manual.Names[newID] = "新人物"
	if err := s.persistManualLocked(); err != nil {
		return "", err
	}
	return newID, nil
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

func newManualPersonID() (string, error) {
	bytes := make([]byte, 12)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return "p_m" + hex.EncodeToString(bytes), nil
}

func validPersonID(id string) bool {
	if !strings.HasPrefix(id, "p_") || len(id) < 6 || len(id) > 40 {
		return false
	}
	for _, char := range id[2:] {
		if !((char >= 'a' && char <= 'z') || (char >= '0' && char <= '9')) {
			return false
		}
	}
	return true
}

func (s *PeopleService) hasPersonLocked(personID string) bool {
	for _, face := range s.faces {
		if s.effectivePersonIDLocked(face) == personID {
			return true
		}
	}
	return false
}

func (s *PeopleService) cleanAssignmentsLocked() {
	for key := range s.manual.Assignments {
		if _, exists := s.faces[key]; !exists {
			delete(s.manual.Assignments, key)
		}
	}
}

func (s *PeopleService) Corrections() PeopleCorrections {
	s.mu.RLock()
	defer s.mu.RUnlock()
	profiles := clonePeopleManualProfiles(s.manualByModel)
	if s.activeModel != "" {
		profiles[s.activeModel] = clonePeopleManualState(s.manual)
	}
	for _, model := range []string{FaceModelQualityV2, FaceModelBuffaloM} {
		if _, loaded := profiles[model]; loaded {
			continue
		}
		data, err := os.ReadFile(peopleProfilePath(s.stateBasePath, model))
		if err != nil {
			continue
		}
		var state peopleManualState
		if json.Unmarshal(data, &state) == nil && state.Version == peopleIndexVersion {
			profiles[model] = normalizePeopleManualState(state)
		}
	}
	profileCorrections := make(map[string]PeopleCorrectionProfile, len(profiles))
	for model, state := range profiles {
		profileCorrections[model] = PeopleCorrectionProfile{
			Version: state.Version, Names: cloneStringMap(state.Names), Hidden: cloneBoolMap(state.Hidden),
			Assignments: cloneStringMap(state.Assignments),
		}
	}
	corrections := PeopleCorrections{
		Version: peopleIndexVersion,
		Names:   cloneStringMap(s.manual.Names), Hidden: cloneBoolMap(s.manual.Hidden),
		Assignments: cloneStringMap(s.manual.Assignments),
	}
	if len(profileCorrections) > 0 {
		corrections.Profiles = profileCorrections
	}
	return corrections
}

func (s *PeopleService) ReplaceCorrections(corrections PeopleCorrections) error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	if corrections.Profiles != nil {
		profiles := make(map[string]peopleManualState, len(corrections.Profiles))
		for model, profile := range corrections.Profiles {
			if model != FaceModelQualityV2 && model != FaceModelBuffaloM {
				return errors.New("unsupported people correction profile")
			}
			profiles[model] = normalizePeopleManualState(PeopleCorrections{
				Version: profile.Version, Names: profile.Names, Hidden: profile.Hidden, Assignments: profile.Assignments,
			})
		}
		for _, model := range []string{FaceModelQualityV2, FaceModelBuffaloM} {
			state := profiles[model]
			if state.Version == 0 {
				state = emptyPeopleManualState()
			}
			profiles[model] = state
			if err := writeAIJSONAtomic(peopleProfilePath(s.stateBasePath, model), state); err != nil {
				return err
			}
		}
		s.manualByModel = profiles
		if s.activeModel != "" {
			s.manual = clonePeopleManualState(profiles[s.activeModel])
			s.statePath = peopleProfilePath(s.stateBasePath, s.activeModel)
			return s.persistManualLocked()
		}
	}
	s.manual = normalizePeopleManualState(corrections)
	return s.persistManualLocked()
}

func cloneStringMap(source map[string]string) map[string]string {
	result := make(map[string]string, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func cloneBoolMap(source map[string]bool) map[string]bool {
	result := make(map[string]bool, len(source))
	for key, value := range source {
		result[key] = value
	}
	return result
}

func (s *PeopleService) Clear() error {
	s.persistMu.Lock()
	defer s.persistMu.Unlock()
	s.mu.Lock()
	defer s.mu.Unlock()
	s.faces = make(map[string]PersonFace)
	s.facesByResource = make(map[string][]string)
	s.clusters = make(map[string]*peopleCluster)
	s.ann = newPeopleANNIndexForDimension(s.embeddingDimension)
	s.previousIDs = make(map[string]string)
	s.cachedIDs = nil
	s.cachedHashes = nil
	s.comparisons = 0
	s.manual = emptyPeopleManualState()
	s.manualByModel = make(map[string]peopleManualState)
	for _, model := range []string{FaceModelQualityV2, FaceModelBuffaloM} {
		for _, path := range []string{peopleProfilePath(s.stateBasePath, model), peopleProfilePath(s.derivedBasePath, model)} {
			if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
				return err
			}
		}
	}
	for _, path := range []string{s.stateBasePath, s.derivedBasePath} {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	if err := s.persistManualLocked(); err != nil {
		return err
	}
	if err := os.Remove(s.derivedPath); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s *PeopleService) persistManualLocked() error {
	if s.activeModel != "" {
		s.manualByModel[s.activeModel] = clonePeopleManualState(s.manual)
	}
	return writeAIJSONAtomic(s.statePath, s.manual)
}

func (s *PeopleService) persistLocked() error {
	if err := s.persistIndexSnapshot(s.indexSnapshotLocked()); err != nil {
		return err
	}
	s.updatePreviousIDsLocked()
	s.updateCachedAssignmentsLocked()
	return s.persistManualLocked()
}

func (s *PeopleService) indexSnapshotLocked() peopleIndexDisk {
	disk := peopleIndexDisk{
		Version: peopleIndexVersion, GroupingVersion: peopleGroupingVersion,
		Faces: make([]peopleFaceDisk, 0, len(s.faces)),
	}
	for _, face := range s.faces {
		disk.Faces = append(disk.Faces, peopleFaceDisk{
			Key: face.Key, ResourceID: face.ResourceID, FaceIndex: face.FaceIndex,
			ClusterID: face.PersonID, Box: face.Box, Score: face.Score, Size: face.Size, MTimeNs: face.MTimeNs,
			RecordHash: face.recordHash,
		})
	}
	return disk
}

func (s *PeopleService) persistIndexSnapshot(disk peopleIndexDisk) error {
	sort.Slice(disk.Faces, func(i, j int) bool { return disk.Faces[i].Key < disk.Faces[j].Key })
	return writeAIJSONAtomic(s.derivedPath, disk)
}

func (s *PeopleService) updatePreviousIDsLocked() {
	referencedIDs := peopleReferencedIDs(s.manual)
	s.previousIDs = make(map[string]string)
	for key, face := range s.faces {
		if referencedIDs[face.PersonID] {
			s.previousIDs[key] = face.PersonID
		}
	}
}

func (s *PeopleService) updateCachedAssignmentsLocked() {
	s.cachedIDs = make(map[string]string, len(s.faces))
	s.cachedHashes = make(map[string]string, len(s.faces))
	for key, face := range s.faces {
		s.cachedIDs[key] = face.PersonID
		s.cachedHashes[key] = face.recordHash
	}
}
