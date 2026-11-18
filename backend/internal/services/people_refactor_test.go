package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// peopleRefactorService 造一个带三张照片的人物服务。
//
// 前两张方向相近，聚成同一个人的两个分组；第三张方向差得远，是另一个人。
// 测试要的就是两个能分别操作、且其中一个有两张脸的分组。
func peopleRefactorService(t *testing.T) *PeopleService {
	t.Helper()
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	derivedPath := filepath.Join(root, "derived", "people-index.json")
	people, err := OpenPeopleService(statePath, derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		t.Fatal(err)
	}
	records := []AIAnalysisRecord{
		peopleTestRecord("photo-a", peopleTestAngle(0)),
		peopleTestRecord("photo-b", peopleTestAngle(10)),
		peopleTestRecord("photo-c", peopleTestAngle(120)),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	if groups := people.Groups(false); len(groups) != 2 {
		t.Fatalf("groups = %+v, want two groups", groups)
	}
	return people
}

// peopleRefactorFaceKey 返回某张照片里那张脸的稳定键。
func peopleRefactorFaceKey(people *PeopleService, resourceID string) string {
	people.mu.Lock()
	defer people.mu.Unlock()
	faces := people.facesForResourceLocked(resourceID)
	if len(faces) != 1 {
		return ""
	}
	return faces[0].Key
}

// peopleRefactorGroupOf 返回一张脸当前所属的分组。
func peopleRefactorGroupOf(people *PeopleService, faceKey string) string {
	people.mu.Lock()
	defer people.mu.Unlock()
	face, exists := people.faces[faceKey]
	if !exists {
		return ""
	}
	return people.effectivePersonIDLocked(face)
}

// TestPeopleCorrectionsJSONShapeIsUnchanged 守住纠错的 JSON 形状不变。
//
// 纠错内容改为内嵌 PeopleCorrectionProfile 之后，字段在编码时仍然摊平：
// state/people-<model>.json 与状态备份的字段名与位置必须与改前一致，
// 否则旧备份就恢复不回来了。
func TestPeopleCorrectionsJSONShapeIsUnchanged(t *testing.T) {
	corrections := PeopleCorrections{
		PeopleCorrectionProfile: PeopleCorrectionProfile{
			Version:     peopleIndexVersion,
			Names:       map[string]string{"p_known1": "名字"},
			Hidden:      map[string]bool{"p_known2": true},
			Assignments: map[string]string{},
		},
		Profiles: map[string]PeopleCorrectionProfile{
			FaceModelQualityV2: {Version: peopleIndexVersion},
		},
	}
	encoded, err := json.Marshal(corrections)
	if err != nil {
		t.Fatal(err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"version", "names", "hidden", "assignments", "profiles"} {
		if _, exists := decoded[key]; !exists {
			t.Fatalf("people corrections JSON lost %q: %s", key, encoded)
		}
	}
	// 内嵌结构不能变成嵌套对象。
	if _, nested := decoded["PeopleCorrectionProfile"]; nested {
		t.Fatalf("people corrections JSON nested the embedded profile: %s", encoded)
	}
	var roundTrip PeopleCorrections
	if err := json.Unmarshal(encoded, &roundTrip); err != nil {
		t.Fatal(err)
	}
	if roundTrip.Names["p_known1"] != "名字" || !roundTrip.Hidden["p_known2"] {
		t.Fatalf("people corrections did not round-trip: %+v", roundTrip.PeopleCorrectionProfile)
	}
}

// TestPeopleMergeKeepsSourceNameAndPinnedFaces 守住合并不会弄丢用户改过的东西。
//
// 合并之前，源组的名字在合并后直接被删掉 —— 用户给「妈妈」起的名字凭空消失；
// 被钉住的脸也还钉在已经消失的源分组上，下一次重建时那个分组会自己长回来。
func TestPeopleMergeKeepsSourceNameAndPinnedFaces(t *testing.T) {
	people := peopleRefactorService(t)
	sourceFaceKey := peopleRefactorFaceKey(people, "photo-c")
	targetFaceKey := peopleRefactorFaceKey(people, "photo-a")
	if sourceFaceKey == "" || targetFaceKey == "" {
		t.Fatal("expected one face per photo")
	}
	sourceID := peopleRefactorGroupOf(people, sourceFaceKey)
	targetID := peopleRefactorGroupOf(people, targetFaceKey)
	if sourceID == "" || targetID == "" || sourceID == targetID {
		t.Fatalf("unexpected groups: source=%q target=%q", sourceID, targetID)
	}

	people.mu.Lock()
	people.manual.Names[sourceID] = "妈妈"
	people.manual.PinnedFaces[sourceFaceKey] = sourceID
	people.manual.RetainedGroups[sourceID] = true
	people.mu.Unlock()

	if err := people.Merge(sourceID, targetID); err != nil {
		t.Fatalf("Merge() error = %v", err)
	}
	if people.manual.Names[targetID] != "妈妈" {
		t.Fatalf("merged group name = %q, want 妈妈", people.manual.Names[targetID])
	}
	if _, exists := people.manual.Names[sourceID]; exists {
		t.Fatal("merged source group still carries a name")
	}
	if !people.manual.RetainedGroups[targetID] {
		t.Fatal("merged group lost the retained flag")
	}
	if people.manual.PinnedFaces[sourceFaceKey] != targetID {
		t.Fatalf("pinned face target = %q, want %q", people.manual.PinnedFaces[sourceFaceKey], targetID)
	}
}

// TestPeopleSplitMovesPinnedFaceToNewGroup 守住拆分不会被钉住关系拉回去。
//
// 钉住的脸优先于人工分配：拆出来却不改钉住关系，下一次重建时
// 它会回到原分组，用户刚拆出来的结果自己长回去。
func TestPeopleSplitMovesPinnedFaceToNewGroup(t *testing.T) {
	people := peopleRefactorService(t)
	faceKey := peopleRefactorFaceKey(people, "photo-a")
	personID := peopleRefactorGroupOf(people, faceKey)
	if faceKey == "" || personID == "" {
		t.Fatal("expected one face per photo")
	}

	people.mu.Lock()
	people.manual.PinnedFaces[faceKey] = personID
	people.mu.Unlock()

	newID, err := people.Split(personID, []string{faceKey})
	if err != nil {
		t.Fatalf("Split() error = %v", err)
	}
	if people.manual.PinnedFaces[faceKey] != newID {
		t.Fatalf("pinned face target = %q, want %q", people.manual.PinnedFaces[faceKey], newID)
	}
}

// TestPeopleStateParseFailureIsReported 守住人工纠错读不出来时不会被悄悄丢掉。
//
// 之前解析失败与版本不符都按空状态处理：用户改过的名字、隐藏与人工分配
// 一次都没了，界面上看不出任何异样。
func TestPeopleStateParseFailureIsReported(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	derivedPath := filepath.Join(root, "derived", "people-index.json")
	if err := os.MkdirAll(filepath.Dir(statePath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(statePath, []byte("{not json"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenPeopleService(statePath, derivedPath); err == nil {
		t.Fatal("OpenPeopleService() accepted a corrupted state file")
	}
	// 原始文件必须留在原地，用户才能从备份恢复。
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("corrupted state file was removed: %v", err)
	}
}

// TestPeopleStateVersionMismatchIsReported 守住版本不符不会被当成空状态。
func TestPeopleStateVersionMismatchIsReported(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	derivedPath := filepath.Join(root, "derived", "people-index.json")
	state := PeopleCorrections{
		PeopleCorrectionProfile: PeopleCorrectionProfile{
			Version: peopleIndexVersion + 7,
			Names:   map[string]string{"p_known1": "名字"},
			Hidden:  map[string]bool{}, Assignments: map[string]string{},
		},
	}
	if err := writeAIJSONAtomic(statePath, state); err != nil {
		t.Fatal(err)
	}
	if _, err := OpenPeopleService(statePath, derivedPath); err == nil {
		t.Fatal("OpenPeopleService() accepted a state file with an unknown version")
	}
}

// TestPeopleCorrectionsSurviveDerivedIndexWriteFailure 守住派生索引写失败时
// 用户纠错仍然落盘。
//
// 索引可以重算，纠错不能。让可重建文件的写入失败挡住不可重建文件的保存，
// 等于用一次磁盘错误换掉用户改过的东西。
func TestPeopleCorrectionsSurviveDerivedIndexWriteFailure(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	derivedPath := filepath.Join(root, "derived", "people-index.json")
	people, err := OpenPeopleService(statePath, derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		t.Fatal(err)
	}
	records := []AIAnalysisRecord{peopleTestRecord("photo-a", peopleTestAngle(0))}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	faceKey := peopleRefactorFaceKey(people, "photo-a")
	personID := peopleRefactorGroupOf(people, faceKey)
	if personID == "" {
		t.Fatal("no person group was produced")
	}
	if err := people.Rename(personID, "外婆"); err != nil {
		t.Fatal(err)
	}

	// 让派生索引写不进去：把它的目标换成一个目录。
	blocked := filepath.Join(root, "derived-blocked")
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatal(err)
	}
	people.derivedPath = blocked
	if err := people.persistLocked(); err == nil {
		t.Fatal("persistLocked() reported success while the derived index could not be written")
	}

	// 纠错必须已经落盘。
	reloaded, err := OpenPeopleService(statePath, derivedPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := reloaded.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		t.Fatal(err)
	}
	if reloaded.manual.Names[personID] != "外婆" {
		t.Fatalf("corrections were lost when the derived index write failed: %+v", reloaded.manual.Names)
	}
}
