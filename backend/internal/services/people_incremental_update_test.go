package services

import (
	"path/filepath"
	"testing"
)

// TestPeopleIncrementalUpdateKeepsGroupsUntilFinalRebuild 锁定增量更新的口径：
//
// 任务期间每批结果只做增量（把新脸并进现有分组），分组编号与用户改过的名字
// 都不动；索引标成「待重建」，任务收尾时整体重建一次，结果才与批次顺序无关。
func TestPeopleIncrementalUpdateKeepsGroupsUntilFinalRebuild(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	existing := peopleTestRecord("z_existing", peopleTestVector(0, 0))
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{existing}); err != nil {
		t.Fatal(err)
	}
	group := people.Groups(true)[0]
	if err := people.Rename(group.ID, "已命名的人物"); err != nil {
		t.Fatal(err)
	}
	if err := people.SetHidden(group.ID, true); err != nil {
		t.Fatal(err)
	}

	// 一张排在前面、但人脸几乎一样的照片：增量更新不该动已有分组。
	inserted := peopleTestRecord("a_inserted", peopleTestVector(0, 0.02))
	if err := people.ApplyRecords([]AIAnalysisRecord{inserted}); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(true)
	if len(groups) != 1 {
		t.Fatalf("groups = %+v, want one group", groups)
	}
	if groups[0].ID != group.ID {
		t.Fatalf("incremental update changed the group id: %q -> %q", group.ID, groups[0].ID)
	}
	if groups[0].Name != "已命名的人物" || !groups[0].Hidden {
		t.Fatalf("incremental update lost the corrections: %+v", groups[0])
	}
	if groups[0].FaceCount != 2 {
		t.Fatalf("face count = %d, want 2", groups[0].FaceCount)
	}
	if !people.rebuildPending {
		t.Fatal("incremental update must mark the index as pending rebuild")
	}

	// 任务收尾时的整体重建：分组按资源 ID 与脸序号重排，名字跟着走。
	if err := people.FinalizeRebuild(); err != nil {
		t.Fatal(err)
	}
	if people.rebuildPending {
		t.Fatal("final rebuild must clear the pending flag")
	}
	rebuilt := people.Groups(true)
	if len(rebuilt) != 1 || rebuilt[0].Name != "已命名的人物" || !rebuilt[0].Hidden {
		t.Fatalf("final rebuild lost the corrections: %+v", rebuilt)
	}

	// 重启：索引不再标着待重建，直接沿用分组结果。
	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync([]AIAnalysisRecord{existing, inserted}); err != nil {
		t.Fatal(err)
	}
	if got := restarted.Groups(true); len(got) != 1 || got[0].Name != "已命名的人物" || !got[0].Hidden || got[0].FaceCount != 2 {
		t.Fatalf("restart lost the person group: %+v", got)
	}
}

// TestPeopleIncrementalUpdateReplacesFacesOfReanalyzedPhoto 锁定「同一张照片
// 重新分析」的处理：旧的人脸要去掉，新的要并进来。
func TestPeopleIncrementalUpdateReplacesFacesOfReanalyzedPhoto(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(
		filepath.Join(root, "state", "people.json"),
		filepath.Join(root, "derived", "people-index.json"),
	)
	if err != nil {
		t.Fatal(err)
	}
	first := peopleTestRecord("photo", peopleTestVector(0, 0))
	if err := people.Sync([]AIAnalysisRecord{first}); err != nil {
		t.Fatal(err)
	}
	if got := len(people.AllFaces()); got != 1 {
		t.Fatalf("faces = %d, want 1", got)
	}

	// 同一张照片重新分析，人脸换了一张完全不同的。
	updated := peopleTestRecord("photo", peopleTestVector(5, 0))
	updated.MTimeNs++
	if err := people.ApplyRecords([]AIAnalysisRecord{updated}); err != nil {
		t.Fatal(err)
	}
	faces := people.AllFaces()
	if len(faces) != 1 {
		t.Fatalf("faces = %d, want 1", len(faces))
	}
	if faces[0].ResourceID != "photo" || faces[0].FaceIndex != 0 {
		t.Fatalf("face = %+v, want the replaced face of the same photo", faces[0])
	}
	groups := people.Groups(true)
	if len(groups) != 1 || groups[0].FaceCount != 1 {
		t.Fatalf("groups = %+v, want one group with one face", groups)
	}
}
