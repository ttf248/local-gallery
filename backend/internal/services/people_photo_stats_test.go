package services

import (
	"path/filepath"
	"testing"
)

// TestPeopleGroupPhotoStatsCountsPhotosNotFaces 锁定照片统计的口径：
// 照片数按「出现在多少张不同的照片里」算，同一张照片里同一个人的两张脸
// 只算一张；分组照片与普通照片也按资源分类，不按脸数分类。
func TestPeopleGroupPhotoStatsCountsPhotosNotFaces(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	people.SetSourceDimensions(func(string) MediaDimensions {
		return MediaDimensions{Width: 2000, Height: 2000}
	})
	records := []AIAnalysisRecord{
		// 同一张照片里的两张脸。
		peopleTestRecordWithBox("photo-a", []float32{10, 10, 100, 100},
			peopleTestVector(0, 0), peopleTestVector(1, 0)),
		// 同一个人的另一张照片。
		peopleTestRecordWithBox("photo-b", []float32{10, 10, 100, 100},
			peopleTestVector(0, 0)),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	// 把三张脸归到一个分组：两张在同一张照片里，一张在另一张照片里。
	faces := people.AllFaces()
	if len(faces) != 3 {
		t.Fatalf("faces = %d, want 3", len(faces))
	}
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

	stats := people.GroupPhotoStats(nil, 20)
	if len(stats) != 1 {
		t.Fatalf("groups = %d, want 1", len(stats))
	}
	for _, group := range stats {
		if group.PhotoCount != 2 {
			t.Fatalf("photo count = %d, want 2", group.PhotoCount)
		}
		if group.OrdinaryPhotoCount != 2 || group.LargeGroupPhotoCount != 0 {
			t.Fatalf("photo split = %+v, want two ordinary photos", group)
		}
		if group.RelativeFaceSizeP10 != 0.05 {
			t.Fatalf("relative face size p10 = %v, want 0.05", group.RelativeFaceSizeP10)
		}
	}

	// 资源过滤：被排除的照片不计入照片数。
	filtered := people.GroupPhotoStats(func(resourceID string) bool {
		return resourceID == "photo-a"
	}, 20)
	if len(filtered) != 1 {
		t.Fatalf("filtered groups = %d, want 1", len(filtered))
	}
	for _, group := range filtered {
		if group.PhotoCount != 1 || group.OrdinaryPhotoCount != 1 {
			t.Fatalf("filtered photo count = %+v, want one ordinary photo", group)
		}
	}
}

// TestPeopleGroupPhotoStatsClassifiesSmallFacePhotos 锁定合影判定：
// 脸数够多且人脸相对尺寸够小时，这张照片算合影。
func TestPeopleGroupPhotoStatsClassifiesSmallFacePhotos(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	people.SetSourceDimensions(func(string) MediaDimensions {
		return MediaDimensions{Width: 2000, Height: 2000}
	})
	records := []AIAnalysisRecord{
		peopleTestRecordWithBox("photo-small", []float32{10, 10, 40, 40}, peopleTestVectors(60, 8)...),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	stats := people.GroupPhotoStats(nil, 20)
	faces := people.AllFaces()
	if len(faces) != 8 {
		t.Fatalf("faces = %d, want 8", len(faces))
	}
	group, ok := stats[faces[0].PersonID]
	if !ok {
		t.Fatalf("no stats for group %s", faces[0].PersonID)
	}
	if group.LargeGroupPhotoCount != 1 || group.OrdinaryPhotoCount != 0 {
		t.Fatalf("photo split = %+v, want one group photo", group)
	}
	if group.RelativeFaceSizeP10 != 0.02 {
		t.Fatalf("relative face size p10 = %v, want 0.02", group.RelativeFaceSizeP10)
	}
}
