package services

import (
	"encoding/json"
	"fmt"
	"math"
	"math/rand"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func peopleTestRecord(resourceID string, faceVectors ...[]float32) AIAnalysisRecord {
	type face struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}
	faces := make([]face, len(faceVectors))
	for index, vector := range faceVectors {
		faces[index] = face{Box: []float32{10, 12, 40, 42}, Score: .95, Embedding: vector}
	}
	data, _ := json.Marshal(struct {
		Faces []face `json:"faces"`
	}{Faces: faces})
	return AIAnalysisRecord{
		Type: AIJobTypeFace, ResourceID: resourceID, Size: 100, MTimeNs: 200,
		ModuleVersion: FaceAnalyzerVersion, Status: "faces_found", Data: data, UpdatedAt: time.Now(),
	}
}

func TestPeopleServiceKeepsSelectedFaceModelEmbeddingDimensionIsolated(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	qualityVector := peopleTestVector(0, 0)
	buffaloVector := make([]float32, peopleBuffaloMDimension)
	buffaloVector[0] = 1
	qualityRecord := peopleTestRecord("same_photo", qualityVector)
	buffaloRecord := peopleTestRecord("same_photo", buffaloVector)
	buffaloRecord.ModuleVersion = FaceAnalyzerBuffaloMVersion
	type face struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}
	var data struct {
		Faces []face `json:"faces"`
	}
	if err := json.Unmarshal(buffaloRecord.Data, &data); err != nil {
		t.Fatal(err)
	}
	data.Faces[0].Score = 0.65
	buffaloRecord.Data, err = json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}

	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerBuffaloMVersion); err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{qualityRecord, buffaloRecord}); err != nil {
		t.Fatal(err)
	}
	if len(people.AllFaces()) != 1 || len(people.faces[PersonFaceKey("same_photo", 0)].embedding) != peopleBuffaloMDimension {
		t.Fatalf("Buffalo_m index mixed or rejected vectors: faces=%d dimension=%d", len(people.AllFaces()), len(people.faces[PersonFaceKey("same_photo", 0)].embedding))
	}

	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{qualityRecord, buffaloRecord}); err != nil {
		t.Fatal(err)
	}
	if len(people.AllFaces()) != 1 || len(people.faces[PersonFaceKey("same_photo", 0)].embedding) != peopleEmbeddingDimension {
		t.Fatalf("quality-v2 index mixed or rejected vectors: faces=%d dimension=%d", len(people.AllFaces()), len(people.faces[PersonFaceKey("same_photo", 0)].embedding))
	}
}

func peopleTestVector(axis int, noise float32) []float32 {
	vector := make([]float32, peopleEmbeddingDimension)
	vector[axis] = 1
	if noise != 0 {
		vector[(axis+1)%peopleEmbeddingDimension] = noise
	}
	return vector
}

func peopleTestRandomVector(rng *rand.Rand) []float32 {
	vector := make([]float32, peopleEmbeddingDimension)
	var norm float64
	for index := range vector {
		vector[index] = float32(rng.NormFloat64())
		norm += float64(vector[index] * vector[index])
	}
	length := float32(math.Sqrt(norm))
	for index := range vector {
		vector[index] /= length
	}
	return vector
}

func TestPeopleServiceNamesUnnamedGroupsByOrder(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("f_a", peopleTestVector(0, 0)),
		peopleTestRecord("f_b", peopleTestVector(0, 0)),
		peopleTestRecord("f_c", peopleTestVector(1, 0)),
	}
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}

	groups := people.Groups(false)
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want two candidate groups: %+v", len(groups), groups)
	}
	// 名字是序数，不是内部标识：照片多的在前，编号跟着走。
	if groups[0].Name != "人物 1" || groups[1].Name != "人物 2" {
		t.Fatalf("group names = %q, %q; want 人物 1 and 人物 2", groups[0].Name, groups[1].Name)
	}
	if groups[0].PhotoCount != 2 || groups[1].PhotoCount != 1 {
		t.Fatalf("group order = %d photos then %d photos, want 2 then 1", groups[0].PhotoCount, groups[1].PhotoCount)
	}
	// 列表页与搜索页说的是同一个名字。
	listed, _ := people.SearchGroups("", 0, false, nil)
	if len(listed) != 2 || listed[0].Name != "人物 1" || listed[1].Name != "人物 2" {
		t.Fatalf("search listing = %+v, want the same ordinal names", listed)
	}
	// 按名字找得到人。
	found, total := people.SearchGroups("人物 2", 0, false, nil)
	if total != 1 || len(found) != 1 || found[0].Name != "人物 2" {
		t.Fatalf("search 人物 2 = %+v (total %d), want the second group", found, total)
	}
	// 改过名的分组保留自己的名字，也不占号：没改名的那些接着排。
	if err := people.Rename(groups[0].ID, "旅行同伴"); err != nil {
		t.Fatal(err)
	}
	renamed := people.Groups(false)
	if renamed[0].Name != "旅行同伴" || renamed[1].Name != "人物 1" {
		t.Fatalf("names after rename = %q, %q; want 旅行同伴 and 人物 1", renamed[0].Name, renamed[1].Name)
	}
}

func TestPeopleServicePersistsCorrectionsWithoutCopyingEmbeddings(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("f_a", peopleTestVector(0, 0)),
		peopleTestRecord("f_b", peopleTestVector(0, .05)),
		peopleTestRecord("f_c", peopleTestVector(1, 0)),
	}
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(false)
	if len(groups) != 2 {
		t.Fatalf("groups = %d, want two candidate groups: %+v", len(groups), groups)
	}
	var samePerson PersonGroup
	for _, group := range groups {
		if group.FaceCount == 2 {
			samePerson = group
		}
	}
	if samePerson.ID == "" {
		t.Fatalf("same-vector faces were not grouped: %+v", groups)
	}
	if err := people.Rename(samePerson.ID, "旅行同伴"); err != nil {
		t.Fatal(err)
	}
	faces := people.Faces(samePerson.ID)
	newPersonID, err := people.Split(samePerson.ID, []string{faces[1].Key})
	if err != nil {
		t.Fatal(err)
	}
	if err := people.SetHidden(newPersonID, true); err != nil {
		t.Fatal(err)
	}
	if got := len(people.Groups(false)); got != 2 {
		t.Fatalf("hidden groups visible by default = %d, want 2", got)
	}
	if got := len(people.Groups(true)); got != 3 {
		t.Fatalf("including hidden groups = %d, want 3", got)
	}
	derived, err := os.ReadFile(indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(derived) == "" || containsPeopleEmbedding(derived) {
		t.Fatal("derived people index is empty or contains embeddings")
	}

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync(records); err != nil {
		t.Fatal(err)
	}
	var named, hidden bool
	for _, group := range restarted.Groups(true) {
		named = named || group.Name == "旅行同伴"
		hidden = hidden || group.ID == newPersonID && group.Hidden
	}
	if !named || !hidden {
		t.Fatalf("manual corrections did not survive rebuild: %+v", restarted.Groups(true))
	}
	if err := restarted.Merge(newPersonID, samePerson.ID); err != nil {
		t.Fatal(err)
	}
	if groups := restarted.Groups(true); len(groups) != 2 {
		t.Fatalf("merge did not combine groups: %+v", groups)
	}
}

func TestPeopleServiceKeepsLegacyFaceRecordsUntilReanalysisCompletes(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	legacy := peopleTestRecord("legacy_face", peopleTestVector(0, 0))
	legacy.ModuleVersion = previousFaceAnalyzerVersion
	if err := people.Sync([]AIAnalysisRecord{legacy}); err != nil {
		t.Fatal(err)
	}
	faces := people.AllFaces()
	if len(faces) != 1 {
		t.Fatalf("legacy face count = %d, want 1", len(faces))
	}
	if err := people.Rename(faces[0].PersonID, "保留的分组"); err != nil {
		t.Fatal(err)
	}

	updated := peopleTestRecord("legacy_face", peopleTestVector(0, 0.01))
	if err := people.ApplyRecords([]AIAnalysisRecord{updated}); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(true)
	if len(groups) != 1 || groups[0].Name != "保留的分组" {
		t.Fatalf("groups after new-version result = %+v", groups)
	}
}

func TestPeopleFacesFromRecordFiltersWeakCachedDetections(t *testing.T) {
	makeRecord := func(score float32, box []float32) AIAnalysisRecord {
		type storedFace struct {
			Box       []float32 `json:"box"`
			Score     float32   `json:"score"`
			Embedding []float32 `json:"embedding"`
		}
		data, err := json.Marshal(struct {
			Faces []storedFace `json:"faces"`
		}{Faces: []storedFace{{Box: box, Score: score, Embedding: peopleTestVector(0, 0)}}})
		if err != nil {
			t.Fatal(err)
		}
		return AIAnalysisRecord{
			Type: AIJobTypeFace, ResourceID: "cached_face", ModuleVersion: legacyFaceAnalyzerVersion,
			Status: "faces_found", Data: data,
		}
	}

	if faces := peopleFacesFromRecord(makeRecord(0.74, []float32{10, 12, 40, 42})); len(faces) != 0 {
		t.Fatalf("weak cached detection retained: %+v", faces)
	}
	if faces := peopleFacesFromRecord(makeRecord(0.9, []float32{10, 12, 0, 42})); len(faces) != 0 {
		t.Fatalf("invalid cached box retained: %+v", faces)
	}
	if faces := peopleFacesFromRecord(makeRecord(0.9, []float32{10, 12, 31, 42})); len(faces) != 0 {
		t.Fatalf("small cached face retained: %+v", faces)
	}
	if faces := peopleFacesFromRecord(makeRecord(faceDetectionMinimumScore, []float32{10, 12, 40, 42})); len(faces) != 1 {
		t.Fatalf("valid legacy detection count = %d, want 1", len(faces))
	}
}

func TestPeopleServiceFiltersLegacyFacesAtAnalysisScale(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	people.SetSourceDimensions(func(resourceID string) MediaDimensions {
		if resourceID != "scaled_faces" {
			t.Fatalf("dimension lookup resource = %q, want scaled_faces", resourceID)
		}
		return MediaDimensions{Width: 4000, Height: 3000}
	})
	record := peopleTestRecord("scaled_faces", peopleTestVector(0, 0), peopleTestVector(1, 0))
	record.ModuleVersion = previousFaceAnalyzerVersion
	type storedFace struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}
	var data struct {
		Faces []storedFace `json:"faces"`
	}
	if err := json.Unmarshal(record.Data, &data); err != nil {
		t.Fatal(err)
	}
	data.Faces[0].Box = []float32{10, 12, 48, 48}
	data.Faces[1].Box = []float32{10, 12, 70, 70}
	record.Data, err = json.Marshal(data)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{record}); err != nil {
		t.Fatal(err)
	}
	faces := people.AllFaces()
	if len(faces) != 1 || faces[0].FaceIndex != 1 {
		t.Fatalf("legacy faces after 2048-pixel scale filter = %+v, want only face 1", faces)
	}
}

func TestPeopleServiceUsesOnlyPhotoResourcesForSyncAndUpdates(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	people.SetSourceIsPhoto(func(resourceID string) bool { return resourceID != "comic" })
	photo := peopleTestRecord("photo", peopleTestVector(0, 0))
	comic := peopleTestRecord("comic", peopleTestVector(1, 0))
	if err := people.Sync([]AIAnalysisRecord{photo, comic}); err != nil {
		t.Fatal(err)
	}
	if faces := people.AllFaces(); len(faces) != 1 || faces[0].ResourceID != "photo" {
		t.Fatalf("faces after Sync = %+v, want only the photo resource", faces)
	}

	comic.MTimeNs++
	photo.MTimeNs++
	if err := people.ApplyRecords([]AIAnalysisRecord{comic, photo}); err != nil {
		t.Fatal(err)
	}
	if faces := people.AllFaces(); len(faces) != 1 || faces[0].ResourceID != "photo" || faces[0].MTimeNs != photo.MTimeNs {
		t.Fatalf("faces after ApplyRecords = %+v, want only the updated photo resource", faces)
	}
}

func TestPeopleServiceIncrementalReplacesChangedResourceFaces(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "derived.json"))
	if err != nil {
		t.Fatal(err)
	}
	first := peopleTestRecord("f_a", peopleTestVector(0, 0), peopleTestVector(1, 0))
	if err := people.Sync([]AIAnalysisRecord{first}); err != nil {
		t.Fatal(err)
	}
	if len(people.AllFaces()) != 2 {
		t.Fatal("expected two face rows from one image")
	}
	updated := peopleTestRecord("f_a", peopleTestVector(0, .1))
	updated.MTimeNs++
	if err := people.ApplyRecords([]AIAnalysisRecord{updated}); err != nil {
		t.Fatal(err)
	}
	faces := people.AllFaces()
	if len(faces) != 1 || faces[0].FaceIndex != 0 || faces[0].MTimeNs != updated.MTimeNs {
		t.Fatalf("incremental face replacement = %+v", faces)
	}
}

func TestPeopleServiceSyncIsIndependentOfRecordOrder(t *testing.T) {
	records := []AIAnalysisRecord{
		peopleTestRecord("a_first", peopleTestAngle(0)),
		peopleTestRecord("b_middle", peopleTestAngle(60)),
		peopleTestRecord("c_last", peopleTestAngle(120)),
	}
	ordered, err := OpenPeopleService(filepath.Join(t.TempDir(), "ordered-state.json"), filepath.Join(t.TempDir(), "ordered-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := ordered.Sync(records); err != nil {
		t.Fatal(err)
	}
	shuffled, err := OpenPeopleService(filepath.Join(t.TempDir(), "shuffled-state.json"), filepath.Join(t.TempDir(), "shuffled-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := shuffled.Sync([]AIAnalysisRecord{records[2], records[0], records[1]}); err != nil {
		t.Fatal(err)
	}
	if got, want := peopleFaceGroups(shuffled.AllFaces()), peopleFaceGroups(ordered.AllFaces()); !reflect.DeepEqual(got, want) {
		t.Fatalf("record order changed person groups: got %v, want %v", got, want)
	}
}

func TestPeopleServiceRequiresCentroidAndAnchorThresholds(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}

	belowAnchor := make([]float32, peopleEmbeddingDimension)
	belowAnchor[0] = 1
	belowNeighbor := make([]float32, peopleEmbeddingDimension)
	belowNeighbor[0] = 0.50
	belowNeighbor[1] = float32(math.Sqrt(1 - 0.50*0.50))
	aboveAnchor := make([]float32, peopleEmbeddingDimension)
	aboveAnchor[2] = 1
	aboveNeighbor := make([]float32, peopleEmbeddingDimension)
	aboveNeighbor[2] = 0.74
	aboveNeighbor[3] = float32(math.Sqrt(1 - 0.74*0.74))

	records := []AIAnalysisRecord{
		peopleTestRecord("a_below_anchor", belowAnchor),
		peopleTestRecord("b_below_neighbor", belowNeighbor),
		peopleTestRecord("c_above_anchor", aboveAnchor),
		peopleTestRecord("d_above_neighbor", aboveNeighbor),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]string)
	for _, face := range people.AllFaces() {
		ids[face.ResourceID] = face.PersonID
	}
	if ids["a_below_anchor"] == ids["b_below_neighbor"] {
		t.Fatal("0.50 similarity unexpectedly merged below the centroid threshold")
	}
	if ids["c_above_anchor"] != ids["d_above_neighbor"] {
		t.Fatal("0.74 similarity did not merge above the centroid and anchor thresholds")
	}
}

func TestPeopleServiceRechecksANNScoreNearCentroidThreshold(t *testing.T) {
	for _, test := range []struct {
		name        string
		score       float32
		wantCompare int
	}{
		{name: "above threshold inside safety margin", score: 0.5205, wantCompare: 1},
		{name: "below threshold inside safety margin", score: 0.5195, wantCompare: 1},
		{name: "below threshold outside safety margin", score: 0.5185, wantCompare: 0},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
			if err != nil {
				t.Fatal(err)
			}

			anchor := make([]float32, peopleEmbeddingDimension)
			anchor[0] = 1
			candidate := make([]float32, peopleEmbeddingDimension)
			candidate[0] = test.score
			candidate[1] = float32(math.Sqrt(float64(1 - test.score*test.score)))
			people.addFaceLocked(PersonFace{Key: "anchor#0", ResourceID: "anchor", embedding: anchor})
			people.addFaceLocked(PersonFace{Key: "candidate#0", ResourceID: "candidate", embedding: candidate})

			if people.comparisons != test.wantCompare {
				t.Fatalf("exact centroid comparisons = %d, want %d", people.comparisons, test.wantCompare)
			}
			if people.faces["candidate#0"].PersonID == people.faces["anchor#0"].PersonID {
				t.Fatal("candidate merged despite failing the immutable anchor threshold")
			}
		})
	}
}

func TestPeopleServicePreventsCentroidDriftFromChainingIdentities(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	records := []AIAnalysisRecord{
		peopleTestRecord("a_seed", peopleTestAngle(0)),
		peopleTestRecord("b_neighbor", peopleTestAngle(30)),
		peopleTestRecord("c_drift", peopleTestAngle(60)),
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]string)
	for _, face := range people.AllFaces() {
		ids[face.ResourceID] = face.PersonID
	}
	if ids["a_seed"] != ids["b_neighbor"] {
		t.Fatal("a face above the anchor threshold did not join its seed group")
	}
	if ids["a_seed"] == ids["c_drift"] {
		t.Fatal("a face that only matches the moving centroid/neighbor was chained into the seed group")
	}
}

func TestPeopleServiceRebuildRestoresTheSameImmutableAnchor(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	indexPath := filepath.Join(root, "index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("z_late", peopleTestVector(0, 0)),
		peopleTestRecord("a_seed", peopleTestVector(0, 0)),
		peopleTestRecord("m_middle", peopleTestVector(0, .02)),
	}
	first, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Sync(records); err != nil {
		t.Fatal(err)
	}
	firstAnchor := first.clusters[first.faces["a_seed#0"].PersonID].anchor.key

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync(records); err != nil {
		t.Fatal(err)
	}
	restoredAnchor := restarted.clusters[restarted.faces["a_seed#0"].PersonID].anchor.key
	if firstAnchor != "a_seed#0" || restoredAnchor != firstAnchor {
		t.Fatalf("anchor before/after cached restore = %q/%q, want a_seed#0", firstAnchor, restoredAnchor)
	}
}

func TestPeopleGroupingSyntheticQualitySet(t *testing.T) {
	const facesPerIdentity = 6
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}

	type expectedFace struct {
		identity string
	}
	expected := make(map[string]expectedFace)
	records := make([]AIAnalysisRecord, 0, 4*facesPerIdentity+3)
	for identity := 0; identity < 4; identity++ {
		for shot := 0; shot < facesPerIdentity; shot++ {
			resourceID := fmt.Sprintf("f_identity_%d_%02d", identity, shot)
			vector := make([]float32, peopleEmbeddingDimension)
			axis := identity*2 + 8
			vector[axis] = 1
			vector[axis+1] = float32(shot+1) * 0.025
			expected[resourceID] = expectedFace{identity: fmt.Sprintf("identity-%d", identity)}
			records = append(records, peopleTestRecord(resourceID, vector))
		}
	}

	chain := []struct {
		resourceID string
		identity   string
		angle      float64
	}{
		{resourceID: "z_chain_0_seed", identity: "chain-a", angle: 0},
		{resourceID: "z_chain_1_neighbor", identity: "chain-a", angle: 30},
		{resourceID: "z_chain_2_drift", identity: "chain-b", angle: 60},
	}
	for _, sample := range chain {
		vector := peopleTestAngle(sample.angle)
		expected[sample.resourceID] = expectedFace{identity: sample.identity}
		records = append(records, peopleTestRecord(sample.resourceID, vector))
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}

	faces := people.AllFaces()
	truePositive, falsePositive, falseNegative, trueNegative := 0, 0, 0, 0
	for leftIndex, left := range faces {
		leftExpected, ok := expected[left.ResourceID]
		if !ok {
			t.Fatalf("missing expected identity for %q", left.ResourceID)
		}
		for _, right := range faces[leftIndex+1:] {
			rightExpected, ok := expected[right.ResourceID]
			if !ok {
				t.Fatalf("missing expected identity for %q", right.ResourceID)
			}
			sameIdentity := leftExpected.identity == rightExpected.identity
			sameGroup := left.PersonID == right.PersonID
			switch {
			case sameIdentity && sameGroup:
				truePositive++
			case sameIdentity:
				falseNegative++
			case sameGroup:
				falsePositive++
			default:
				trueNegative++
			}
		}
	}

	precision := float64(truePositive) / float64(truePositive+falsePositive)
	recall := float64(truePositive) / float64(truePositive+falseNegative)
	f1 := 2 * precision * recall / (precision + recall)
	t.Logf("synthetic pairwise quality: precision=%.3f recall=%.3f f1=%.3f TP=%d FP=%d FN=%d TN=%d", precision, recall, f1, truePositive, falsePositive, falseNegative, trueNegative)
	if falsePositive != 0 || falseNegative != 0 {
		t.Fatalf("synthetic identity grouping metrics: precision=%.3f recall=%.3f FP=%d FN=%d", precision, recall, falsePositive, falseNegative)
	}
}

func TestPeopleServiceReviewOrderPrioritizesWeakAnchorTail(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	vectorAtSimilarity := func(axis int, similarity float32) []float32 {
		vector := make([]float32, peopleEmbeddingDimension)
		vector[axis] = similarity
		vector[axis+1] = float32(math.Sqrt(float64(1 - similarity*similarity)))
		return vector
	}
	if err := people.Sync([]AIAnalysisRecord{
		peopleTestRecord("a_strong_seed", peopleTestVector(2, 0)),
		peopleTestRecord("b_strong_member", vectorAtSimilarity(2, .90)),
		peopleTestRecord("z_border_seed", peopleTestVector(0, 0)),
		peopleTestRecord("zz_border_member", vectorAtSimilarity(0, .74)),
	}); err != nil {
		t.Fatal(err)
	}

	countOrdered, _ := people.SearchGroups("", 50, false, nil)
	if len(countOrdered) != 2 || countOrdered[0].CoverResourceID != "a_strong_seed" {
		t.Fatalf("photo-count order = %+v, want the stable cover-ID order", countOrdered)
	}
	reviewOrdered, total := people.SearchGroupsForReview("", 50, false, nil)
	if total != 2 || len(reviewOrdered) != 2 || reviewOrdered[0].CoverResourceID != "z_border_seed" {
		t.Fatalf("review order = %+v, total %d; want the weaker anchor group first", reviewOrdered, total)
	}
	quality := reviewOrdered[0].Quality
	if quality == nil || math.Abs(quality.AnchorP10-.74) > .001 || quality.CentroidP10 <= .52 || math.Abs(quality.DetectionP10-.95) > .001 {
		t.Fatalf("review quality = %+v, want anchor P10 .74, strong center, and detector P10 .95", quality)
	}
}

func TestPeopleServiceRestoresCachedAssignmentsWithoutReclustering(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	indexPath := filepath.Join(root, "index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("cache_a", peopleTestVector(0, 0)),
		peopleTestRecord("cache_b", peopleTestVector(0, .05)),
		peopleTestRecord("cache_c", peopleTestVector(1, 0)),
	}
	first, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Sync(records); err != nil {
		t.Fatal(err)
	}
	want := peopleFaceGroups(first.AllFaces())

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if len(restarted.cachedIDs) != len(records) {
		t.Fatalf("cached face assignments = %d, want %d", len(restarted.cachedIDs), len(records))
	}
	if err := restarted.Sync(records); err != nil {
		t.Fatal(err)
	}
	if restarted.ann != nil {
		t.Fatal("cached assignments eagerly rebuilt the ANN index during startup")
	}
	if restarted.comparisons != 0 {
		t.Fatalf("unchanged face records triggered %d clustering comparisons", restarted.comparisons)
	}
	if got := peopleFaceGroups(restarted.AllFaces()); !reflect.DeepEqual(got, want) {
		t.Fatalf("cached assignments = %v, want %v", got, want)
	}
}

func TestPeopleServiceBuildsANNWhenIncrementalFaceArrivesAfterCachedRestore(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	indexPath := filepath.Join(root, "index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("cache_a", peopleTestVector(0, 0)),
		peopleTestRecord("cache_b", peopleTestVector(1, 0)),
	}
	first, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Sync(records); err != nil {
		t.Fatal(err)
	}
	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync(records); err != nil {
		t.Fatal(err)
	}
	if restarted.ann != nil {
		t.Fatal("cached restore unexpectedly created an ANN index")
	}

	newRecord := peopleTestRecord("zz_cache_new", peopleTestVector(1, 0.05))
	if err := restarted.ApplyRecords([]AIAnalysisRecord{newRecord}); err != nil {
		t.Fatal(err)
	}
	if restarted.ann == nil || restarted.ann.Len() != len(restarted.clusters) {
		t.Fatalf("incremental ANN length = %v; want %d cluster entries", restarted.ann, len(restarted.clusters))
	}
	groups := peopleFaceGroups(restarted.AllFaces())
	if groups["cache_b"] != groups["zz_cache_new"] {
		t.Fatalf("incremental face group = %q, want existing group %q", groups["zz_cache_new"], groups["cache_b"])
	}
}

func TestPeopleServiceReclustersWhenCachedFaceRecordChanges(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state.json")
	indexPath := filepath.Join(root, "index.json")
	records := []AIAnalysisRecord{
		peopleTestRecord("cache_a", peopleTestVector(0, 0)),
		peopleTestRecord("cache_b", peopleTestVector(0, .05)),
		peopleTestRecord("cache_c", peopleTestVector(1, 0)),
	}
	first, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Sync(records); err != nil {
		t.Fatal(err)
	}

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	changed := peopleTestRecord("cache_b", peopleTestVector(2, 0))
	changed.MTimeNs++
	if err := restarted.Sync([]AIAnalysisRecord{records[0], changed, records[2]}); err != nil {
		t.Fatal(err)
	}
	if restarted.faces["cache_b#0"].PersonID == restarted.faces["cache_a#0"].PersonID {
		t.Fatal("changed face record reused its cached grouping instead of reclustering")
	}
}

func TestPeopleServiceEarlierIncrementalFacePreservesNameAcrossRebuild(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	initial := peopleTestRecord("z_existing", peopleTestVector(0, 0))
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{initial}); err != nil {
		t.Fatal(err)
	}
	oldID := people.AllFaces()[0].PersonID
	if err := people.Rename(oldID, "已命名的人物"); err != nil {
		t.Fatal(err)
	}
	if err := people.SetHidden(oldID, true); err != nil {
		t.Fatal(err)
	}
	inserted := peopleTestRecord("a_inserted", peopleTestVector(0, .02))
	if err := people.ApplyRecords([]AIAnalysisRecord{inserted}); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(true)
	if len(groups) != 1 || groups[0].Name != "已命名的人物" || !groups[0].Hidden {
		t.Fatalf("corrections were lost when an earlier face changed the cluster anchor: %+v", groups)
	}
	if groups[0].ID == oldID {
		t.Fatalf("test did not exercise an automatic ID change: old=%q new=%q", oldID, groups[0].ID)
	}

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync([]AIAnalysisRecord{initial, inserted}); err != nil {
		t.Fatal(err)
	}
	if got := restarted.Groups(true); !reflect.DeepEqual(got, groups) {
		t.Fatalf("restart changed person group or its corrections: got %+v, want %+v", got, groups)
	}
}

func TestPeopleServiceKeepsRebuiltIndexWhenPersistenceFails(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	initial := peopleTestRecord("z_existing", peopleTestVector(0, 0))
	if err := people.Sync([]AIAnalysisRecord{initial}); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(indexPath); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(indexPath, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(indexPath, "keep"), []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}

	inserted := peopleTestRecord("a_inserted", peopleTestVector(0, .02))
	if err := people.ApplyRecords([]AIAnalysisRecord{inserted}); err == nil {
		t.Fatal("ApplyRecords() succeeded despite an unreplaceable index path")
	}
	faces := people.AllFaces()
	if len(faces) != 2 {
		t.Fatalf("in-memory faces after index persistence failure = %d, want 2", len(faces))
	}
	if faces[0].ResourceID != "a_inserted" || faces[1].ResourceID != "z_existing" {
		t.Fatalf("in-memory index lost the rebuilt faces: %+v", faces)
	}
}

func TestPeopleServiceKeepsCorrectedGroupsSeparateWhenAutomaticClustersMerge(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	first := peopleTestRecord("a_first", peopleTestVector(0, 0))
	second := peopleTestRecord("z_second", peopleTestVector(1, 0))
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{first, second}); err != nil {
		t.Fatal(err)
	}
	ids := make(map[string]string)
	for _, face := range people.AllFaces() {
		ids[face.ResourceID] = face.PersonID
	}
	if ids[first.ResourceID] == ids[second.ResourceID] {
		t.Fatal("test setup did not create separate automatic groups")
	}
	if err := people.Rename(ids[first.ResourceID], "第一人"); err != nil {
		t.Fatal(err)
	}
	if err := people.Rename(ids[second.ResourceID], "第二人"); err != nil {
		t.Fatal(err)
	}
	if err := people.SetHidden(ids[second.ResourceID], true); err != nil {
		t.Fatal(err)
	}

	updatedSecond := peopleTestRecord(second.ResourceID, peopleTestVector(0, 0))
	updatedSecond.MTimeNs++
	if err := people.ApplyRecords([]AIAnalysisRecord{updatedSecond}); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(true)
	if len(groups) != 2 {
		t.Fatalf("automatic rebuild merged corrected groups: %+v", groups)
	}
	byName := make(map[string]PersonGroup, len(groups))
	for _, group := range groups {
		byName[group.Name] = group
	}
	if byName["第一人"].FaceCount != 1 || byName["第二人"].FaceCount != 1 || !byName["第二人"].Hidden {
		t.Fatalf("person corrections were lost after automatic merge: %+v", groups)
	}

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync([]AIAnalysisRecord{first, updatedSecond}); err != nil {
		t.Fatal(err)
	}
	if got := restarted.Groups(true); !reflect.DeepEqual(got, groups) {
		t.Fatalf("restart changed corrected groups: got %+v, want %+v", got, groups)
	}
}

func TestPeopleServiceKeepsCorrectedGroupTogetherWhenAutomaticClustersSplit(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people.json")
	indexPath := filepath.Join(root, "derived", "people-index.json")
	first := peopleTestRecord("a_first", peopleTestVector(0, 0))
	second := peopleTestRecord("z_second", peopleTestVector(0, 0))
	people, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{first, second}); err != nil {
		t.Fatal(err)
	}
	group := people.Groups(true)[0]
	if err := people.Rename(group.ID, "确认的人物"); err != nil {
		t.Fatal(err)
	}
	if err := people.SetHidden(group.ID, true); err != nil {
		t.Fatal(err)
	}

	updatedSecond := peopleTestRecord(second.ResourceID, peopleTestVector(1, 0))
	updatedSecond.MTimeNs++
	if err := people.ApplyRecords([]AIAnalysisRecord{updatedSecond}); err != nil {
		t.Fatal(err)
	}
	groups := people.Groups(true)
	if len(groups) != 1 || groups[0].Name != "确认的人物" || groups[0].FaceCount != 2 || !groups[0].Hidden {
		t.Fatalf("automatic rebuild split a corrected group: %+v", groups)
	}

	restarted, err := OpenPeopleService(statePath, indexPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := restarted.Sync([]AIAnalysisRecord{first, updatedSecond}); err != nil {
		t.Fatal(err)
	}
	if got := restarted.Groups(true); !reflect.DeepEqual(got, groups) {
		t.Fatalf("restart changed corrected group: got %+v, want %+v", got, groups)
	}
}

func TestPeopleServiceRetainsFacesAboveFormerLimit(t *testing.T) {
	const faceCount = 30025
	records := make([]AIAnalysisRecord, faceCount)
	vector := peopleTestVector(0, 0)
	for index := range records {
		records[index] = peopleTestRecord(fmt.Sprintf("f_%05d", index), vector)
	}
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	if got := len(people.AllFaces()); got != faceCount {
		t.Fatalf("indexed face count = %d, want %d", got, faceCount)
	}
	if people.comparisons != faceCount-1 {
		t.Fatalf("single-cluster comparison count = %d, want %d", people.comparisons, faceCount-1)
	}
}

func TestPeopleServiceGroupsEveryFaceWithoutFullClusterScans(t *testing.T) {
	const faceCount = 2200
	rng := rand.New(rand.NewSource(42))
	records := make([]AIAnalysisRecord, 0, faceCount/100+1)
	for start := 0; start < faceCount; start += 100 {
		count := min(100, faceCount-start)
		vectors := make([][]float32, count)
		for index := range vectors {
			vectors[index] = peopleTestRandomVector(rng)
		}
		records = append(records, peopleTestRecord(fmt.Sprintf("random_%05d", start), vectors...))
	}

	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	if got := len(people.AllFaces()); got != faceCount {
		t.Fatalf("indexed face count = %d, want %d", got, faceCount)
	}
	if people.comparisons >= 2_000_000 {
		t.Fatalf("exact cluster comparisons = %d, want a bounded candidate set", people.comparisons)
	}
	if people.ann.Len() != len(people.clusters) {
		t.Fatalf("candidate index contains %d clusters, want %d", people.ann.Len(), len(people.clusters))
	}
}

func TestPeopleServiceTopGroupsRanksPhotoCountsAndLimitsResults(t *testing.T) {
	const groupCount = 55
	records := make([]AIAnalysisRecord, 0)
	for groupIndex := 0; groupIndex < groupCount; groupIndex++ {
		for photoIndex := 0; photoIndex <= groupIndex; photoIndex++ {
			vector := make([]float32, peopleEmbeddingDimension)
			vector[groupIndex] = 1
			records = append(records, peopleTestRecord(fmt.Sprintf("photo_%02d_%03d", groupIndex, photoIndex), vector))
		}
	}

	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	for _, group := range people.Groups(true) {
		if group.PhotoCount == groupCount {
			if err := people.SetHidden(group.ID, true); err != nil {
				t.Fatal(err)
			}
			break
		}
	}

	visible, totalVisible := people.TopGroups(50, false, nil)
	if len(visible) != 50 || totalVisible != groupCount-1 {
		t.Fatalf("visible top groups = %d, total = %d; want 50 of %d", len(visible), totalVisible, groupCount-1)
	}
	if visible[0].PhotoCount != groupCount-1 || visible[len(visible)-1].PhotoCount != 5 {
		t.Fatalf("visible photo-count range = %d..%d, want 54..5", visible[0].PhotoCount, visible[len(visible)-1].PhotoCount)
	}
	for index := 1; index < len(visible); index++ {
		if peopleGroupRanksBefore(visible[index], visible[index-1]) {
			t.Fatalf("groups are not ordered by descending photo count at %d: %+v before %+v", index, visible[index-1], visible[index])
		}
	}

	all, totalAll := people.TopGroups(0, true, nil)
	if len(all) != groupCount || totalAll != groupCount || all[0].PhotoCount != groupCount {
		t.Fatalf("all top groups = %d, total = %d, highest count = %d", len(all), totalAll, all[0].PhotoCount)
	}
}

func TestPeopleServiceSearchGroupsIsBoundedAndFindsIDsOutsideTopFifty(t *testing.T) {
	root := t.TempDir()
	records := []AIAnalysisRecord{
		peopleTestRecord("photo_first", peopleTestVector(0, 0)),
		peopleTestRecord("photo_second", peopleTestVector(1, 0)),
		peopleTestRecord("photo_third", peopleTestVector(2, 0)),
	}
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	all := people.Groups(true)
	if len(all) != 3 {
		t.Fatalf("people groups = %d, want 3", len(all))
	}
	target := all[0]
	if err := people.Rename(target.ID, "家人同伴"); err != nil {
		t.Fatal(err)
	}
	byName, total := people.SearchGroups("家人", 2, false, nil)
	if total != 1 || len(byName) != 1 || byName[0].ID != target.ID {
		t.Fatalf("name search = %+v, total %d", byName, total)
	}
	byID, total := people.SearchGroups(target.ID[len(target.ID)-6:], 2, false, nil)
	if total != 1 || len(byID) != 1 || byID[0].ID != target.ID {
		t.Fatalf("ID search = %+v, total %d", byID, total)
	}
	initial, total := people.SearchGroups("", 2, false, nil)
	if len(initial) != 2 || total != 3 {
		t.Fatalf("empty search = %d groups, total %d; want top 2 of 3", len(initial), total)
	}
	missing, total := people.SearchGroups("不存在", 20, false, nil)
	if missing == nil || len(missing) != 0 || total != 0 {
		t.Fatalf("missing search = %#v, total %d; want an empty non-nil result", missing, total)
	}
}

func TestPeopleServiceGroupAndFacesReturnsOneGroupWithoutEmbeddings(t *testing.T) {
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync([]AIAnalysisRecord{
		peopleTestRecord("photo_a", peopleTestVector(0, 0)),
		peopleTestRecord("photo_b", peopleTestVector(0, .05)),
		peopleTestRecord("photo_other", peopleTestVector(1, 0)),
	}); err != nil {
		t.Fatal(err)
	}
	var groupID string
	for _, group := range people.Groups(true) {
		if group.FaceCount == 2 {
			groupID = group.ID
		}
	}
	group, faces, exists := people.GroupAndFaces(groupID)
	if !exists || group.FaceCount != 2 || group.PhotoCount != 2 || len(faces) != 2 {
		t.Fatalf("group summary = %+v, faces %d, exists %v", group, len(faces), exists)
	}
	for _, face := range faces {
		if face.embedding != nil || face.recordHash != "" {
			t.Fatal("group face response retained private embedding data")
		}
	}
}

func peopleTestAngle(degrees float64) []float32 {
	vector := make([]float32, peopleEmbeddingDimension)
	vector[0] = float32(math.Cos(degrees * math.Pi / 180))
	vector[1] = float32(math.Sin(degrees * math.Pi / 180))
	return vector
}

func peopleFaceGroups(faces []PersonFace) map[string]string {
	groups := make(map[string]string, len(faces))
	for _, face := range faces {
		groups[face.Key] = face.PersonID
	}
	return groups
}

func containsPeopleEmbedding(data []byte) bool {
	var value map[string]any
	if json.Unmarshal(data, &value) != nil {
		return true
	}
	for _, face := range value["faces"].([]any) {
		if _, ok := face.(map[string]any)["embedding"]; ok {
			return true
		}
	}
	return false
}
