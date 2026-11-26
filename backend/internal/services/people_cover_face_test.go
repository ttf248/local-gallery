package services

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// peopleCoverFaceRecord 造一条带多张脸的分析记录，每张脸有自己的框。
func peopleCoverFaceRecord(resourceID string, boxes [][]float32, vectors [][]float32) AIAnalysisRecord {
	type face struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}
	faces := make([]face, len(boxes))
	for index, box := range boxes {
		faces[index] = face{Box: box, Score: 0.9, Embedding: vectors[index]}
	}
	data, _ := json.Marshal(struct {
		Faces []face `json:"faces"`
	}{Faces: faces})
	return AIAnalysisRecord{
		Type: AIJobTypeFace, ResourceID: resourceID, Size: 100, MTimeNs: 200,
		ModuleVersion: FaceAnalyzerVersion, Status: "faces_found", Data: data, UpdatedAt: time.Now(),
	}
}

func TestPeopleGroupsExposeRepresentativeFaceWithSourceSize(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	people.SetSourceDimensions(func(string) MediaDimensions {
		return MediaDimensions{Width: 2000, Height: 1500}
	})
	// 一张照片里有两个人：每组的代表脸必须是**它自己**那张，
	// 不能串到同一张合照里的另一个人身上。
	records := []AIAnalysisRecord{
		peopleCoverFaceRecord("photo-a", [][]float32{
			{10, 10, 40, 40},
			{100, 120, 300, 320},
		}, [][]float32{
			peopleTestVector(0, 0),
			peopleTestVector(1, 0),
		}),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}

	groups, _ := people.TopGroups(0, false, nil)
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want 2", len(groups))
	}
	boxes := map[string][]float32{}
	for _, group := range groups {
		face := group.CoverFace
		if face == nil {
			t.Fatalf("group %s has no cover face", group.ID)
		}
		if face.ResourceID != "photo-a" {
			t.Fatalf("cover face resource = %q, want photo-a", face.ResourceID)
		}
		if face.Width != 2000 || face.Height != 1500 {
			t.Fatalf("cover face size = %dx%d, want 2000x1500", face.Width, face.Height)
		}
		boxes[group.ID] = face.Box
	}
	seen := map[string]bool{}
	for _, box := range boxes {
		key := fmt.Sprintf("%v", box)
		if seen[key] {
			t.Fatalf("two groups share the same face box %v", box)
		}
		seen[key] = true
	}
}

func TestPeopleGroupsWithoutKnownSourceSizeKeepCoverFaceBox(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	records := []AIAnalysisRecord{
		peopleCoverFaceRecord("photo-a", [][]float32{{5, 6, 70, 80}}, [][]float32{peopleTestVector(0, 0)}),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}

	groups, _ := people.TopGroups(0, false, nil)
	if len(groups) != 1 || groups[0].CoverFace == nil {
		t.Fatalf("groups = %+v, want one group with a cover face", groups)
	}
	if groups[0].CoverFace.Width != 0 || groups[0].CoverFace.Height != 0 {
		t.Fatalf("cover face size = %dx%d, want unknown",
			groups[0].CoverFace.Width, groups[0].CoverFace.Height)
	}
}

func TestPeopleCoverRanksAcrossPhotosAndRespectsResourceFilter(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	var records []AIAnalysisRecord
	for _, sample := range []struct {
		id      string
		side    float32
		quality float32
	}{
		{"a-small", 40, -1}, {"b-profile", 600, 0.2},
		{"z-frontal", 360, 0.95}, {"y-frontal", 360, 0.95},
	} {
		record := peopleCoverFaceRecord(sample.id, [][]float32{{10, 20, sample.side, sample.side}}, [][]float32{peopleTestVector(0, 0)})
		if sample.quality >= 0 {
			var data struct {
				Faces []map[string]json.RawMessage `json:"faces"`
			}
			if err := json.Unmarshal(record.Data, &data); err != nil {
				t.Fatal(err)
			}
			data.Faces[0]["portraitQuality"], _ = json.Marshal(sample.quality)
			record.Data, _ = json.Marshal(data)
		}
		records = append(records, record)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	groups, _ := people.TopGroups(1, false, nil)
	if len(groups) != 1 {
		t.Fatalf("groups: %v", groups)
	}
	check := func(group PersonGroup, want string) {
		t.Helper()
		if group.CoverFace == nil || group.CoverResourceID != want || group.CoverFace.ResourceID != want {
			t.Fatalf("unexpected cover: %+v, want %s", group, want)
		}
	}
	check(groups[0], "y-frontal")
	detail, _, _ := people.GroupAndFaces(groups[0].ID)
	check(detail, "y-frontal")
	search, _ := people.SearchGroups(groups[0].ID, 1, false, func(id string) bool { return id != "y-frontal" })
	check(search[0], "z-frontal")
}

func TestPeopleCoverWithLegacyDetections(t *testing.T) {
	group := PersonGroup{}
	for _, face := range []PersonFace{
		{Key: "small", ResourceID: "small", Box: []float32{0, 0, 40, 40}, Score: 0.99},
		{Key: "large", ResourceID: "large", Box: []float32{0, 0, 400, 400}, Score: 0.8},
		{Key: "clear", ResourceID: "clear", Box: []float32{0, 0, 350, 350}, Score: 0.95},
	} {
		group.considerCover(face)
	}
	if group.CoverResourceID != "clear" {
		t.Fatalf("legacy cover = %s", group.CoverResourceID)
	}
}
