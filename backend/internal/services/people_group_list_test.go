package services

import (
	"path/filepath"
	"testing"
)

// TestPeopleGroupListCountsPhotosNotFaces 锁定分组列表的照片数口径：
// 同一张照片里同一个人的两张脸只算一张照片，脸数另算。
func TestPeopleGroupListCountsPhotosNotFaces(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	records := []AIAnalysisRecord{
		peopleTestRecord("photo-a", peopleTestVector(0, 0.05), peopleTestVector(0, 0.08)),
		peopleTestRecord("photo-b", peopleTestVector(0, 0.06)),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	faces := people.AllFaces()
	if len(faces) != 3 {
		t.Fatalf("faces = %d, want 3", len(faces))
	}
	// 把两张照片上的脸归到一个分组：photo-a 上两张，photo-b 上一张。
	ids := map[string]bool{}
	for _, face := range faces {
		ids[face.PersonID] = true
	}
	if len(ids) != 2 {
		t.Fatalf("groups = %d, want 2 before merging", len(ids))
	}
	keeper := faces[0].PersonID
	for id := range ids {
		if id == keeper {
			continue
		}
		if err := people.Merge(id, keeper); err != nil {
			t.Fatal(err)
		}
	}

	groups := people.Groups(true)
	if len(groups) != 1 {
		t.Fatalf("groups = %+v, want one group", groups)
	}
	group := groups[0]
	if group.FaceCount != 3 {
		t.Fatalf("face count = %d, want 3", group.FaceCount)
	}
	if group.PhotoCount != 2 {
		t.Fatalf("photo count = %d, want 2", group.PhotoCount)
	}
}
