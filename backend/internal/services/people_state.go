package services

// 本文件管人工纠错与它们的持久化：命名、隐藏、合并、拆分与排除关系，
// 以及 state/people-<model>.json 的读写。
//
// 这一层的数据不可重建：解析失败必须报出来，不能当作空状态悄悄丢掉。

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"sort"
	"strings"
	"unicode"
)

func (s *PeopleService) loadProfileLocked() error {
	s.manual = emptyPeopleManualState()
	data, err := os.ReadFile(s.statePath)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	if err == nil {
		var state peopleManualState
		// 人工纠错不可重建：读不出来必须报出来。
		// 把它当成空状态，等于把用户改过的名字、隐藏与人工分配悄悄丢掉，
		// 而界面上看不出任何异样。文件留在原地，可以从备份恢复。
		if unmarshalErr := json.Unmarshal(data, &state); unmarshalErr != nil {
			return fmt.Errorf("decode people manual state: %w", unmarshalErr)
		}
		if state.Version != peopleIndexVersion {
			return fmt.Errorf("unsupported people state version %d", state.Version)
		}
		s.manual = normalizePeopleManualState(state)
	}
	return nil
}

func (s *PeopleService) loadProfileIndexLocked() error {
	s.previousIDs = make(map[string]string)
	s.cachedIDs = make(map[string]string)
	s.cachedHashes = make(map[string]string)
	s.cachedOrigins = make(map[string]string)
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
	s.rebuildPending = index.PendingRebuild
	referencedIDs := peopleReferencedIDs(s.manual)
	cacheValid := index.GroupingVersion == peopleGroupingVersion
	if cacheValid {
		s.cachedIDs = make(map[string]string, len(index.Faces))
		s.cachedHashes = make(map[string]string, len(index.Faces))
		s.cachedOrigins = make(map[string]string, len(index.Faces))
	}
	for _, face := range index.Faces {
		if face.Key != "" && referencedIDs[face.ClusterID] {
			s.previousIDs[face.Key] = face.ClusterID
		}
		if !cacheValid {
			continue
		}
		if face.Key == "" || !validPersonID(face.ClusterID) || !validPersonID(face.OriginID) || len(face.RecordHash) != sha256.Size*2 {
			cacheValid = false
			break
		}
		s.cachedIDs[face.Key] = face.ClusterID
		s.cachedHashes[face.Key] = face.RecordHash
		s.cachedOrigins[face.Key] = face.OriginID
	}
	if !cacheValid {
		s.cachedIDs = nil
		s.cachedHashes = nil
		s.cachedOrigins = nil
	}
	return nil
}

func emptyPeopleManualState() peopleManualState {
	return peopleManualState{PeopleCorrectionProfile: emptyPeopleCorrectionProfile()}
}

// emptyPeopleCorrectionProfile 造一套空的纠错。
func emptyPeopleCorrectionProfile() PeopleCorrectionProfile {
	return PeopleCorrectionProfile{
		Version: peopleIndexVersion, Names: map[string]string{}, Hidden: map[string]bool{},
		Assignments: map[string]string{}, PinnedFaces: map[string]string{},
		RetainedGroups:  map[string]bool{},
		ExcludedMatches: []PeopleMatchExclusion{},
	}
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
	if state.PinnedFaces == nil {
		state.PinnedFaces = map[string]string{}
	}
	if state.RetainedGroups == nil {
		state.RetainedGroups = map[string]bool{}
	}
	state.ExcludedMatches = normalizePeopleMatchExclusions(state.ExcludedMatches)
	state.Version = peopleIndexVersion
	return state
}

func peopleReferencedIDs(state peopleManualState) map[string]bool {
	result := make(map[string]bool, len(state.Names)+len(state.Hidden)+len(state.Assignments)+len(state.PinnedFaces)+len(state.RetainedGroups))
	for id := range state.Names {
		result[id] = true
	}
	for id := range state.Hidden {
		result[id] = true
	}
	for _, id := range state.Assignments {
		result[id] = true
	}
	for _, id := range state.PinnedFaces {
		result[id] = true
	}
	for id, retained := range state.RetainedGroups {
		if retained {
			result[id] = true
		}
	}
	return result
}

func clonePeopleManualState(state peopleManualState) peopleManualState {
	return peopleManualState{
		PeopleCorrectionProfile: clonePeopleCorrectionProfile(state.PeopleCorrectionProfile),
		Profiles:                clonePeopleCorrectionProfiles(state.Profiles),
	}
}

// clonePeopleCorrectionProfile 复制一套纠错。
//
// 纠错的字段清单只有这一份：复制、归一化、备份恢复都从这里取。
func clonePeopleCorrectionProfile(profile PeopleCorrectionProfile) PeopleCorrectionProfile {
	return PeopleCorrectionProfile{
		PortraitFaces: cloneMap(profile.PortraitFaces), Version: profile.Version, Names: cloneMap(profile.Names),
		Hidden: cloneMap(profile.Hidden), Assignments: cloneMap(profile.Assignments),
		PinnedFaces:     cloneMap(profile.PinnedFaces),
		RetainedGroups:  cloneMap(profile.RetainedGroups),
		ExcludedMatches: append([]PeopleMatchExclusion(nil), profile.ExcludedMatches...),
	}
}

// clonePeopleCorrectionProfiles 复制各模型的纠错。
func clonePeopleCorrectionProfiles(source map[string]PeopleCorrectionProfile) map[string]PeopleCorrectionProfile {
	if source == nil {
		return nil
	}
	result := make(map[string]PeopleCorrectionProfile, len(source))
	for model, profile := range source {
		result[model] = clonePeopleCorrectionProfile(profile)
	}
	return result
}

func clonePeopleManualProfiles(source map[string]peopleManualState) map[string]peopleManualState {
	result := make(map[string]peopleManualState, len(source))
	for model, state := range source {
		result[model] = clonePeopleManualState(state)
	}
	return result
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
			// 钉住的脸优先于分配：源分组被合并后，钉住关系要跟着改，
			// 否则下一次重建时这些脸会按钉住关系回到已经消失的源分组。
			if s.manual.PinnedFaces[key] == sourceID {
				s.manual.PinnedFaces[key] = targetID
			}
		}
	}
	// 名字跟着人一起过去：用户给「妈妈」起的名字不该在合并后凭空消失。
	// 目标组已经有名字时保留目标组的。
	if name := s.manual.Names[sourceID]; name != "" && s.manual.Names[targetID] == "" {
		s.manual.Names[targetID] = name
	}
	delete(s.manual.Names, sourceID)
	delete(s.manual.Hidden, sourceID)
	// 「保留」是用户对这一组人的肯定：合并之后它属于目标组。
	if s.manual.RetainedGroups[sourceID] {
		s.manual.RetainedGroups[targetID] = true
	}
	delete(s.manual.RetainedGroups, sourceID)
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
		// 拆出来的脸由用户明确指给了新分组：钉住关系也要跟着改，
		// 否则重建时它会被钉回原分组，拆出来的结果自己长回去。
		if s.manual.PinnedFaces[key] == personID {
			s.manual.PinnedFaces[key] = newID
		}
	}
	s.manual.Names[newID] = "新人物"
	if err := s.persistManualLocked(); err != nil {
		return "", err
	}
	return newID, nil
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
		profileCorrections[model] = clonePeopleCorrectionProfile(state.PeopleCorrectionProfile)
	}
	corrections := PeopleCorrections{
		PeopleCorrectionProfile: clonePeopleCorrectionProfile(s.manual.PeopleCorrectionProfile),
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
				PeopleCorrectionProfile: clonePeopleCorrectionProfile(profile),
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

// cloneMap 复制一张 map，让调用方改不到原表的条目。
func cloneMap[K comparable, V any](source map[K]V) map[K]V {
	result := make(map[K]V, len(source))
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
	s.cachedOrigins = nil
	s.comparisons = 0
	s.matchRelations = nil
	s.matchRelationsStale = true
	s.portraits = nil
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

// persistLocked 落盘人物索引与人工纠错。
//
// 顺序是有讲究的：先写人工纠错（state/），再写派生索引（derived/）。
// 索引可以重算，纠错不能；让可重建文件的写入失败挡住不可重建文件的保存，
// 等于用一次磁盘错误换掉用户改过的东西。
func (s *PeopleService) persistLocked() error {
	if err := s.persistManualLocked(); err != nil {
		return err
	}
	s.updatePreviousIDsLocked()
	s.updateCachedAssignmentsLocked()
	return s.persistIndexSnapshot(s.indexSnapshotLocked())
}

func (s *PeopleService) indexSnapshotLocked() peopleIndexDisk {
	disk := peopleIndexDisk{
		Version: peopleIndexVersion, GroupingVersion: peopleGroupingVersion,
		PendingRebuild: s.rebuildPending,
		Faces:          make([]peopleFaceDisk, 0, len(s.faces)),
	}
	for _, face := range s.faces {
		disk.Faces = append(disk.Faces, peopleFaceDisk{
			Key: face.Key, ResourceID: face.ResourceID, FaceIndex: face.FaceIndex,
			ClusterID: face.PersonID, Box: face.Box, Score: face.Score, Size: face.Size, MTimeNs: face.MTimeNs,
			RecordHash: face.recordHash, OriginID: face.originID,
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
	s.cachedOrigins = make(map[string]string, len(s.faces))
	for key, face := range s.faces {
		s.cachedIDs[key] = face.PersonID
		s.cachedHashes[key] = face.recordHash
		s.cachedOrigins[key] = face.originID
	}
}
