package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

// 人物标注是给人脸识别质量评估用的本机工作台。
//
// 它与人物修正（改名、合并、排除、保留）分开存放：标注只描述「这张照片里
// 有哪些人脸、属于哪个匿名身份」，既不会改写分组，也不会回写原始照片。
// 标注的唯一用途是导出评测集，让本机的检测与分组效果可以被真实照片衡量。

const (
	peopleAnnotationVersion = 1
	// PeopleAnnotationSampleLimit 是一次抽样给出的照片上限。
	PeopleAnnotationSampleLimit = 60
	// peopleAnnotationGroupPhotoLimit 是每个分组贡献的照片上限。
	peopleAnnotationGroupPhotoLimit = 2
	// peopleAnnotationMaxPhotosPerIdentity 限制单个身份在一次保存里的脸数。
	peopleAnnotationMaxFacesPerPhoto = 64
	// peopleAnnotationMaxTagsPerPhoto 限制单张照片的场景标签数量。
	peopleAnnotationMaxTagsPerPhoto = 8
	// peopleAnnotationGroupPhotoFaceThreshold 是判定「只在合照中出现」的检测脸数门槛。
	peopleAnnotationGroupPhotoFaceThreshold = 20
)

// 标注样本的来源。这些值会原样写进评测集的 tags 里。
const (
	PeopleAnnotationReasonPendingMatch = "pendingMatch"
	PeopleAnnotationReasonGroupPhoto   = "groupPhoto"
	PeopleAnnotationReasonLowQuality   = "lowQuality"
)

// PeopleAnnotationScenarioTags 是建议的场景标签。场景标签只描述拍摄情况，
// 不描述身份，因此可以自由扩展。
var PeopleAnnotationScenarioTags = []string{
	"crossAge",   // 跨年龄
	"profile",    // 侧脸
	"lowQuality", // 低清晰度
	"groupPhoto", // 大合照
	"backlit",    // 逆光
	"occluded",   // 遮挡
}

// PeopleAnnotationIdentity 是一条匿名身份。ID 由本机生成，用户不需要写真实姓名。
type PeopleAnnotationIdentity struct {
	ID    string `json:"id"`
	Label string `json:"label,omitempty"`
}

// PeopleAnnotationFace 是照片里的一张标注脸。
type PeopleAnnotationFace struct {
	Identity string    `json:"identity"`
	Box      []float32 `json:"box"`
	// SmallFace 允许标注者纠正「这张脸算不算小脸」的定义；为空时按框的短边判断。
	SmallFace *bool `json:"smallFace,omitempty"`
	// Source 说明这张脸是检测出来的还是人工补的。
	Source string `json:"source,omitempty"`
}

// PeopleAnnotationPhoto 是一张照片的标注结果。
type PeopleAnnotationPhoto struct {
	ResourceID string                 `json:"resourceId"`
	Tags       []string               `json:"tags"`
	Faces      []PeopleAnnotationFace `json:"faces"`
	Reviewed   bool                   `json:"reviewed"`
	UpdatedAt  time.Time              `json:"updatedAt"`
}

// PeopleAnnotationSample 是抽样清单里的一张待标注照片。
type PeopleAnnotationSample struct {
	ResourceID string   `json:"resourceId"`
	PersonID   string   `json:"personId,omitempty"`
	PersonName string   `json:"personName,omitempty"`
	Reason     string   `json:"reason"`
	FaceCount  int      `json:"faceCount"`
	Reviewed   bool     `json:"reviewed"`
	Identities []string `json:"identities,omitempty"`
}

// PeopleAnnotationProgress 描述标注进度。
type PeopleAnnotationProgress struct {
	// SampleCount 是当前抽样清单里的照片数。
	SampleCount int `json:"sampleCount"`
	// ReviewedCount 是清单里已确认完成的照片数。
	ReviewedCount int `json:"reviewedCount"`
	// AnnotatedPhotoCount 是全部已保存标注的照片数，包含清单之外的。
	AnnotatedPhotoCount int `json:"annotatedPhotoCount"`
	// FaceCount 是全部已标注的人脸数。
	FaceCount int `json:"faceCount"`
	// IdentityCount 是已建立的匿名身份数。
	IdentityCount int `json:"identityCount"`
}

// PeopleAnnotationPhotoDetail 是一张照片的标注视图：检出的脸与已有标注。
type PeopleAnnotationPhotoDetail struct {
	ResourceID string                 `json:"resourceId"`
	Width      int                    `json:"width"`
	Height     int                    `json:"height"`
	Detected   []PersonFace           `json:"detected"`
	Annotation *PeopleAnnotationPhoto `json:"annotation"`
}

// PeopleAnnotationSave 是一次保存请求。
type PeopleAnnotationSave struct {
	ResourceID string                 `json:"resourceId"`
	Tags       []string               `json:"tags"`
	Faces      []PeopleAnnotationFace `json:"faces"`
	Reviewed   bool                   `json:"reviewed"`
}

// PeopleAnnotationDataset 是导出的评测集，格式与 evaluate_people.py 一致。
type PeopleAnnotationDataset struct {
	SchemaVersion int                            `json:"schemaVersion"`
	Photos        []PeopleAnnotationDatasetPhoto `json:"photos"`
}

// PeopleAnnotationDatasetPhoto 是评测集里的一张照片。
type PeopleAnnotationDatasetPhoto struct {
	ResourceID string                        `json:"resourceId"`
	Path       string                        `json:"path"`
	Tags       []string                      `json:"tags"`
	Faces      []PeopleAnnotationDatasetFace `json:"faces"`
}

// PeopleAnnotationDatasetFace 是评测集里的一张标注脸。
type PeopleAnnotationDatasetFace struct {
	Box       []float32 `json:"box"`
	Identity  string    `json:"identity"`
	SmallFace *bool     `json:"smallFace,omitempty"`
}

type peopleAnnotationState struct {
	Version    int                                 `json:"version"`
	Identities map[string]PeopleAnnotationIdentity `json:"identities"`
	Photos     map[string]PeopleAnnotationPhoto    `json:"photos"`
	// Samples 是抽样清单，保存成有序列表，用户可以按顺序一张张标注。
	Samples []PeopleAnnotationSamplePlan `json:"samples"`
}

// PeopleAnnotationSamplePlan 是抽样清单里一项：照片、来源与出处人物。
type PeopleAnnotationSamplePlan struct {
	ResourceID string `json:"resourceId"`
	Reason     string `json:"reason"`
	PersonID   string `json:"personId,omitempty"`
	PersonName string `json:"personName,omitempty"`
}

// UnmarshalJSON 兼容早期只存资源 ID 的清单格式。
//
// 抽样清单的字段变过：早期每个条目只是一个资源 ID，后来才带上来源与
// 出处人物。若整份文件因为这一处不兼容而被丢弃，用户已经标好的照片与
// 身份会跟着一起消失 —— 那是不可接受的损失。这里让两种格式都能读，
// 旧格式只还原资源 ID，其余字段留空。
func (plan *PeopleAnnotationSamplePlan) UnmarshalJSON(data []byte) error {
	var legacy string
	if err := json.Unmarshal(data, &legacy); err == nil {
		plan.ResourceID = legacy
		return nil
	}
	type alias PeopleAnnotationSamplePlan
	var current alias
	if err := json.Unmarshal(data, &current); err != nil {
		return err
	}
	*plan = PeopleAnnotationSamplePlan(current)
	return nil
}

// PeopleAnnotationService 保存本机的标注进度。它与人格修正完全分开：
// 标注既不改变分组，也不改变用户的命名与合并决定。
type PeopleAnnotationService struct {
	mu        sync.RWMutex
	statePath string
	state     peopleAnnotationState
}

// ErrInvalidAnnotation 表示标注内容不合法。
var ErrInvalidAnnotation = errors.New("invalid people annotation")

// OpenPeopleAnnotationService 打开或创建本机标注存储。
func OpenPeopleAnnotationService(statePath string) (*PeopleAnnotationService, error) {
	if statePath == "" {
		return nil, os.ErrInvalid
	}
	service := &PeopleAnnotationService{
		statePath: statePath,
		state:     emptyPeopleAnnotationState(),
	}
	data, err := os.ReadFile(statePath)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	if err == nil {
		service.state = decodePeopleAnnotationState(data)
	}
	return service, nil
}

// decodePeopleAnnotationState 逐段读取标注状态。
//
// 整份文件一次性解析时，任何一段格式不兼容都会把用户已经标好的照片与
// 身份一起丢掉 —— 那是不可接受的损失。这里分段解析：一段读不出来只影响
// 那一段，其余内容照常保留。版本号对不上时只重建抽样清单，标注本身仍然
// 读得出来。
func decodePeopleAnnotationState(data []byte) peopleAnnotationState {
	state := emptyPeopleAnnotationState()
	var sections map[string]json.RawMessage
	if err := json.Unmarshal(data, &sections); err != nil {
		return state
	}
	var version int
	if raw, exists := sections["version"]; exists {
		_ = json.Unmarshal(raw, &version)
	}
	if raw, exists := sections["identities"]; exists {
		_ = json.Unmarshal(raw, &state.Identities)
	}
	if raw, exists := sections["photos"]; exists {
		_ = json.Unmarshal(raw, &state.Photos)
	}
	if version == peopleAnnotationVersion {
		if raw, exists := sections["samples"]; exists {
			_ = json.Unmarshal(raw, &state.Samples)
		}
	}
	return normalizePeopleAnnotationState(state)
}

func emptyPeopleAnnotationState() peopleAnnotationState {
	return peopleAnnotationState{
		Version:    peopleAnnotationVersion,
		Identities: map[string]PeopleAnnotationIdentity{},
		Photos:     map[string]PeopleAnnotationPhoto{},
		Samples:    []PeopleAnnotationSamplePlan{},
	}
}

func normalizePeopleAnnotationState(state peopleAnnotationState) peopleAnnotationState {
	if state.Identities == nil {
		state.Identities = map[string]PeopleAnnotationIdentity{}
	}
	if state.Photos == nil {
		state.Photos = map[string]PeopleAnnotationPhoto{}
	}
	if state.Samples == nil {
		state.Samples = []PeopleAnnotationSamplePlan{}
	}
	state.Version = peopleAnnotationVersion
	return state
}

// Identities 返回全部匿名身份，按 ID 升序。
func (s *PeopleAnnotationService) Identities() []PeopleAnnotationIdentity {
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]PeopleAnnotationIdentity, 0, len(s.state.Identities))
	for _, identity := range s.state.Identities {
		result = append(result, identity)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	return result
}

// CreateIdentity 新建一个匿名身份。用户只写编号或备注，真实姓名没有必要。
func (s *PeopleAnnotationService) CreateIdentity(label string) (PeopleAnnotationIdentity, error) {
	label = strings.TrimSpace(label)
	if len([]rune(label)) > 40 {
		return PeopleAnnotationIdentity{}, ErrInvalidAnnotation
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	identity := PeopleAnnotationIdentity{ID: s.nextIdentityIDLocked(), Label: label}
	s.state.Identities[identity.ID] = identity
	if err := s.persistLocked(); err != nil {
		delete(s.state.Identities, identity.ID)
		return PeopleAnnotationIdentity{}, err
	}
	return identity, nil
}

func (s *PeopleAnnotationService) nextIdentityIDLocked() string {
	for index := 1; ; index++ {
		candidate := fmt.Sprintf("id-%03d", index)
		if _, exists := s.state.Identities[candidate]; !exists {
			return candidate
		}
	}
}

// SavePhoto 保存一张照片的标注。它不会改动人物分组或人物修正。
func (s *PeopleAnnotationService) SavePhoto(input PeopleAnnotationSave) error {
	if strings.TrimSpace(input.ResourceID) == "" {
		return ErrInvalidAnnotation
	}
	tags, err := normalizePeopleAnnotationTags(input.Tags)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	faces, err := normalizePeopleAnnotationFaces(input.Faces, s.knownIdentitiesLocked())
	if err != nil {
		return err
	}
	photo := PeopleAnnotationPhoto{
		ResourceID: input.ResourceID, Tags: tags, Faces: faces,
		Reviewed: input.Reviewed, UpdatedAt: time.Now().UTC(),
	}
	s.state.Photos[input.ResourceID] = photo
	if err := s.persistLocked(); err != nil {
		delete(s.state.Photos, input.ResourceID)
		return err
	}
	return nil
}

func (s *PeopleAnnotationService) knownIdentitiesLocked() map[string]bool {
	known := make(map[string]bool, len(s.state.Identities))
	for id := range s.state.Identities {
		known[id] = true
	}
	return known
}

// Progress 描述当前标注进度。
func (s *PeopleAnnotationService) Progress() PeopleAnnotationProgress {
	s.mu.RLock()
	defer s.mu.RUnlock()
	progress := PeopleAnnotationProgress{
		SampleCount: len(s.state.Samples), IdentityCount: len(s.state.Identities),
		AnnotatedPhotoCount: len(s.state.Photos),
	}
	for _, item := range s.state.Samples {
		if photo, exists := s.state.Photos[item.ResourceID]; exists {
			if photo.Reviewed {
				progress.ReviewedCount++
			}
		}
	}
	for _, photo := range s.state.Photos {
		progress.FaceCount += len(photo.Faces)
	}
	return progress
}

// Photo 返回一张照片的标注视图：检出的脸与已有标注。
func (s *PeopleAnnotationService) Photo(people *PeopleService, resourceID string, dimensions func(string) MediaDimensions) (PeopleAnnotationPhotoDetail, bool) {
	detail := PeopleAnnotationPhotoDetail{ResourceID: resourceID}
	if dimensions != nil {
		size := dimensions(resourceID)
		detail.Width = size.Width
		detail.Height = size.Height
	}
	if people != nil {
		for _, face := range people.ResourceFaces(resourceID) {
			detail.Detected = append(detail.Detected, face)
		}
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	if photo, exists := s.state.Photos[resourceID]; exists {
		copy := photo
		detail.Annotation = &copy
	}
	return detail, true
}

// Samples 返回待标注的样本清单。
//
// 清单是确定性的：抽样结果按顺序保存在本机，用户可以一张张标注下去，
// 进度不会因为重新抽样而丢失。
func (s *PeopleAnnotationService) Samples(people *PeopleService, isPhotoImage func(string) bool, limit int, refresh bool) ([]PeopleAnnotationSample, error) {
	if limit < 1 || limit > PeopleAnnotationSampleLimit {
		limit = PeopleAnnotationSampleLimit
	}
	s.mu.Lock()
	plan := append([]PeopleAnnotationSamplePlan(nil), s.state.Samples...)
	s.mu.Unlock()
	if refresh || len(plan) == 0 {
		plan = peopleBuildAnnotationPlan(people, isPhotoImage)
		s.mu.Lock()
		s.state.Samples = plan
		if err := s.persistLocked(); err != nil {
			s.mu.Unlock()
			return nil, err
		}
		s.mu.Unlock()
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	result := make([]PeopleAnnotationSample, 0, min(limit, len(plan)))
	for _, item := range plan {
		if len(result) >= limit {
			break
		}
		sample := PeopleAnnotationSample{
			ResourceID: item.ResourceID, Reason: item.Reason,
			PersonID: item.PersonID, PersonName: item.PersonName,
		}
		if people != nil {
			sample.FaceCount = len(people.ResourceFaces(item.ResourceID))
		}
		if photo, exists := s.state.Photos[item.ResourceID]; exists {
			sample.Reviewed = photo.Reviewed
			identities := make([]string, 0, len(photo.Faces))
			for _, face := range photo.Faces {
				identities = append(identities, face.Identity)
			}
			sort.Strings(identities)
			sample.Identities = identities
		}
		result = append(result, sample)
	}
	return result, nil
}

// peopleBuildAnnotationPlan 从人物索引里抽取值得标注的代表性照片。
//
// 三类来源各回答一个问题：待确认匹配回答「同一个人的两组是不是该合并」，
// 合照候选回答「大合照里的小脸检测得准不准」，低质量分组回答「最不稳的
// 那些组到底错在哪」。
func peopleBuildAnnotationPlan(people *PeopleService, isPhotoImage func(string) bool) []PeopleAnnotationSamplePlan {
	if people == nil {
		return []PeopleAnnotationSamplePlan{}
	}
	plan := make([]PeopleAnnotationSamplePlan, 0, PeopleAnnotationSampleLimit)
	seen := make(map[string]struct{})
	add := func(resourceID, reason, personID, personName string) {
		if resourceID == "" {
			return
		}
		if isPhotoImage != nil && !isPhotoImage(resourceID) {
			return
		}
		if _, exists := seen[resourceID]; exists {
			return
		}
		seen[resourceID] = struct{}{}
		plan = append(plan, PeopleAnnotationSamplePlan{
			ResourceID: resourceID, Reason: reason,
			PersonID: personID, PersonName: personName,
		})
	}
	addGroup := func(personID, personName, reason string) {
		for _, resourceID := range peopleGroupSamplePhotos(people, personID) {
			add(resourceID, reason, personID, personName)
		}
	}
	// 待确认匹配：来源组与目标组各取两张照片。
	page := people.MatchSuggestions(0, 30, false, isPhotoImage)
	for _, item := range page.Items {
		addGroup(item.Source.ID, item.Source.Name, PeopleAnnotationReasonPendingMatch)
		for _, candidate := range item.Candidates {
			addGroup(candidate.Person.ID, candidate.Person.Name, PeopleAnnotationReasonPendingMatch)
		}
	}
	// 低质量分组：锚点与中心相似度最低的那批组最容易出错。
	reviewGroups, _ := people.SearchGroupsForReview("", 20, false, isPhotoImage)
	for _, group := range reviewGroups {
		addGroup(group.ID, group.Name, PeopleAnnotationReasonLowQuality)
	}
	// 合照候选：只在合照里出现的组。这里只要分类，不要人脸相对尺寸的分位数。
	classes := people.GroupPhotoClassifications(isPhotoImage, peopleAnnotationGroupPhotoFaceThreshold)
	topGroups, _ := people.RankedGroupSummaries(0, false, isPhotoImage)
	for _, group := range topGroups {
		groupClasses := classes[group.ID]
		if groupClasses.PhotoCount == 0 || groupClasses.LargeGroupPhotoCount != groupClasses.PhotoCount {
			continue
		}
		addGroup(group.ID, group.Name, PeopleAnnotationReasonGroupPhoto)
	}
	if len(plan) > PeopleAnnotationSampleLimit {
		plan = plan[:PeopleAnnotationSampleLimit]
	}
	return plan
}

// peopleGroupSamplePhotos 取一个分组里最值得看的几张照片。
func peopleGroupSamplePhotos(people *PeopleService, personID string) []string {
	_, faces, exists := people.GroupAndFaces(personID)
	if !exists {
		return nil
	}
	byResource := make(map[string]PersonFace)
	for _, face := range faces {
		previous, exists := byResource[face.ResourceID]
		if !exists || peopleRepresentativeRanksBefore(face, previous) {
			byResource[face.ResourceID] = face
		}
	}
	resources := make([]string, 0, len(byResource))
	for resourceID := range byResource {
		resources = append(resources, resourceID)
	}
	sort.Slice(resources, func(i, j int) bool {
		left, right := byResource[resources[i]], byResource[resources[j]]
		if left.Score != right.Score {
			return left.Score > right.Score
		}
		return resources[i] < resources[j]
	})
	if len(resources) > peopleAnnotationGroupPhotoLimit {
		resources = resources[:peopleAnnotationGroupPhotoLimit]
	}
	return resources
}

// Dataset 导出评测集。格式与 evaluate_people.py 的 schemaVersion=1 一致。
func (s *PeopleAnnotationService) Dataset(resolvePath func(string) (string, bool)) (PeopleAnnotationDataset, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dataset := PeopleAnnotationDataset{SchemaVersion: 1, Photos: []PeopleAnnotationDatasetPhoto{}}
	resourceIDs := make([]string, 0, len(s.state.Photos))
	for resourceID := range s.state.Photos {
		resourceIDs = append(resourceIDs, resourceID)
	}
	sort.Strings(resourceIDs)
	for _, resourceID := range resourceIDs {
		photo := s.state.Photos[resourceID]
		path, ok := "", false
		if resolvePath != nil {
			path, ok = resolvePath(resourceID)
		}
		if !ok || path == "" {
			// 路径解析不出来的照片不进评测集：评测脚本要求每张照片
			// 都能在磁盘上找到。
			continue
		}
		faces := make([]PeopleAnnotationDatasetFace, 0, len(photo.Faces))
		for _, face := range photo.Faces {
			faces = append(faces, PeopleAnnotationDatasetFace{
				Box: face.Box, Identity: face.Identity, SmallFace: face.SmallFace,
			})
		}
		tags := photo.Tags
		if len(tags) == 0 {
			tags = []string{"unreviewed"}
		}
		dataset.Photos = append(dataset.Photos, PeopleAnnotationDatasetPhoto{
			ResourceID: resourceID, Path: path, Tags: tags, Faces: faces,
		})
	}
	return dataset, nil
}

// DatasetPath 返回标注集的默认落盘位置：state 目录旁的导出文件。
func DatasetPath(statePath string) string {
	return filepath.Join(filepath.Dir(statePath), "people-annotations-dataset.json")
}

func normalizePeopleAnnotationTags(tags []string) ([]string, error) {
	if len(tags) > peopleAnnotationMaxTagsPerPhoto {
		return nil, ErrInvalidAnnotation
	}
	unique := make(map[string]struct{}, len(tags))
	result := make([]string, 0, len(tags))
	for _, tag := range tags {
		tag = strings.TrimSpace(tag)
		if tag == "" {
			continue
		}
		if _, exists := unique[tag]; exists {
			continue
		}
		unique[tag] = struct{}{}
		result = append(result, tag)
	}
	sort.Strings(result)
	return result, nil
}

func normalizePeopleAnnotationFaces(faces []PeopleAnnotationFace, known map[string]bool) ([]PeopleAnnotationFace, error) {
	if len(faces) > peopleAnnotationMaxFacesPerPhoto {
		return nil, ErrInvalidAnnotation
	}
	result := make([]PeopleAnnotationFace, 0, len(faces))
	for _, face := range faces {
		identity := strings.TrimSpace(face.Identity)
		if identity == "" || !known[identity] {
			return nil, ErrInvalidAnnotation
		}
		if len(face.Box) != 4 {
			return nil, ErrInvalidAnnotation
		}
		box := make([]float32, 4)
		for index, value := range face.Box {
			if value <= 0 && index >= 2 {
				return nil, ErrInvalidAnnotation
			}
			box[index] = value
		}
		if box[2] <= 0 || box[3] <= 0 {
			return nil, ErrInvalidAnnotation
		}
		source := face.Source
		if source != "manual" {
			source = "detected"
		}
		result = append(result, PeopleAnnotationFace{
			Identity: identity, Box: box, SmallFace: face.SmallFace, Source: source,
		})
	}
	return result, nil
}

func (s *PeopleAnnotationService) persistLocked() error {
	if s.statePath == "" {
		return nil
	}
	if err := os.MkdirAll(filepath.Dir(s.statePath), 0o755); err != nil {
		return err
	}
	return writeAIJSONAtomic(s.statePath, s.state)
}
