package services

import (
	"fmt"
	"path/filepath"
	"strings"
	"testing"
)

func TestPeopleGroupingPoliciesAreModelScoped(t *testing.T) {
	quality := peopleGroupingThresholdsForModel(FaceModelQualityV2)
	buffalo := peopleGroupingThresholdsForModel(FaceModelBuffaloM)
	quality.centroidThreshold = 0.1
	if got := peopleGroupingThresholdsForModel(FaceModelBuffaloM).centroidThreshold; got != buffalo.centroidThreshold || got == quality.centroidThreshold {
		t.Fatalf("Buffalo_m threshold changed with quality-v2 policy: %v", got)
	}
	if qualityV2GroupingThresholds.centroidThreshold != buffaloMGroupingThresholds.centroidThreshold {
		t.Fatalf("starting thresholds diverged without model-specific labels: quality=%v buffalo_m=%v", qualityV2GroupingThresholds.centroidThreshold, buffaloMGroupingThresholds.centroidThreshold)
	}
}

func TestPeopleMatchSuggestionsUseIndependentPhotosAndRequireHumanConfirmation(t *testing.T) {
	people := newPeopleMatchTestService(t)
	targetID, targetFaces := peopleMatchTestFaces("target", []float64{0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55})
	sourceID, sourceFaces := peopleMatchTestFaces("source", []float64{0, 5})
	peopleInstallMatchGroup(t, people, targetID, targetFaces)
	peopleInstallMatchGroup(t, people, sourceID, sourceFaces)

	page := people.MatchSuggestions(0, 20, false, nil)
	if page.TotalSources != 1 || page.CheckedSources != 1 || page.HasMore {
		t.Fatalf("match page = %+v, want one fully checked source group", page)
	}
	if len(page.Items) != 1 || page.Items[0].Source.ID != sourceID || len(page.Items[0].Candidates) != 1 {
		t.Fatalf("suggestions = %+v, want the sparse group matched to its stable target", page.Items)
	}
	candidate := page.Items[0].Candidates[0]
	if candidate.Person.ID != targetID || candidate.IndependentPhotoPairs < 2 || candidate.SourceEvidencePhotos < 2 || candidate.TargetEvidencePhotos < 2 {
		t.Fatalf("candidate evidence = %+v, want reciprocal evidence across distinct photos", candidate)
	}
	if !candidate.HumanConfirmationRequired || candidate.Ambiguous || candidate.Similarity < 0.99 {
		t.Fatalf("candidate review markers = %+v, want a strong but manually confirmed suggestion", candidate)
	}
	if len(people.Faces(sourceID)) != 2 || len(people.Faces(targetID)) != 12 {
		t.Fatal("suggestion generation changed automatic group assignments")
	}
}

func TestPeopleMatchSuggestionsKeepSinglePhotoCandidatesAmbiguous(t *testing.T) {
	people := newPeopleMatchTestService(t)
	targetID, targetFaces := peopleMatchTestFaces("target", []float64{0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55})
	sourceID, sourceFaces := peopleMatchTestFaces("source", []float64{0})
	peopleInstallMatchGroup(t, people, targetID, targetFaces)
	peopleInstallMatchGroup(t, people, sourceID, sourceFaces)

	page := people.MatchSuggestions(0, 20, false, nil)
	if len(page.Items) != 1 || len(page.Items[0].Candidates) != 1 {
		t.Fatalf("single-photo candidate page = %+v", page)
	}
	candidate := page.Items[0].Candidates[0]
	if !candidate.HumanConfirmationRequired || !candidate.Ambiguous || candidate.SourceEvidencePhotos != 1 {
		t.Fatalf("single-photo match was not marked ambiguous: %+v", candidate)
	}
}

func TestPeopleMatchSuggestionsRejectSamePhotoAndRespectExclusions(t *testing.T) {
	people := newPeopleMatchTestService(t)
	targetID, targetFaces := peopleMatchTestFaces("shared", []float64{0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55})
	sourceID, sourceFaces := peopleMatchTestFaces("source", []float64{0, 5})
	sourceFaces[0].ResourceID = targetFaces[0].ResourceID
	sourceFaces[0].Key = PersonFaceKey(sourceFaces[0].ResourceID, 1)
	peopleInstallMatchGroup(t, people, targetID, targetFaces)
	peopleInstallMatchGroup(t, people, sourceID, sourceFaces)
	if page := people.MatchSuggestions(0, 20, false, nil); len(page.Items) != 1 || len(page.Items[0].Candidates) != 0 {
		t.Fatalf("same-photo groups received a match suggestion: %+v", page.Items)
	}

	people = newPeopleMatchTestService(t)
	targetID, targetFaces = peopleMatchTestFaces("target", []float64{0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55})
	sourceID, sourceFaces = peopleMatchTestFaces("source", []float64{0, 5})
	peopleInstallMatchGroup(t, people, targetID, targetFaces)
	peopleInstallMatchGroup(t, people, sourceID, sourceFaces)
	before := people.MatchSuggestions(0, 20, false, nil)
	if len(before.Items) != 1 || len(before.Items[0].Candidates) != 1 || before.Items[0].Candidates[0].Person.ID != targetID {
		t.Fatalf("candidate pair was not present before exclusion: %+v", before)
	}
	if err := people.ExcludeMatch(sourceID, targetID); err != nil {
		t.Fatal(err)
	}
	corrections := people.Corrections()
	if len(corrections.ExcludedMatches) != 1 || len(corrections.PinnedFaces) != 2 {
		t.Fatalf("saved exclusion = %+v, want a stable face pair and both source faces pinned", corrections)
	}
	changed := peopleMatchTestRecords(targetFaces, sourceFaces, true)
	if err := people.Sync(changed); err != nil {
		t.Fatal(err)
	}
	if len(people.Faces(sourceID)) != 2 || len(people.Faces(targetID)) < 9 {
		t.Fatalf("rebuild lost the keep-separate decision: source=%d target=%d", len(people.Faces(sourceID)), len(people.Faces(targetID)))
	}
	page := people.MatchSuggestions(0, 50, false, nil)
	for _, item := range page.Items {
		if item.Source.ID != sourceID {
			continue
		}
		for _, candidate := range item.Candidates {
			if candidate.Person.ID == targetID {
				t.Fatalf("rejected pair reappeared after rebuild: %+v", item)
			}
		}
	}

	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerBuffaloMVersion); err != nil {
		t.Fatal(err)
	}
	if got := people.Corrections().Profiles[FaceModelQualityV2]; len(got.ExcludedMatches) != 1 || len(got.PinnedFaces) != 2 {
		t.Fatalf("quality-v2 correction profile changed after model switch: %+v", got)
	}
	if got := people.Corrections().Profiles[FaceModelBuffaloM]; len(got.ExcludedMatches) != 0 || len(got.PinnedFaces) != 0 {
		t.Fatalf("quality-v2 corrections leaked into Buffalo_m: %+v", got)
	}
}

func TestPeopleRetainSingletonPersistsAsConfirmedWithoutCrossModelLeak(t *testing.T) {
	people := newPeopleMatchTestService(t)
	personID, faces := peopleMatchTestFaces("retained", []float64{0})
	peopleInstallMatchGroup(t, people, personID, faces)
	if err := people.RetainGroup(personID); err != nil {
		t.Fatal(err)
	}
	groups, total := people.TopGroups(10, false, nil)
	if total != 1 || len(groups) != 1 || !groups[0].Confirmed {
		t.Fatalf("retained singleton = %+v (total %d), want a confirmed visible group", groups, total)
	}
	if page := people.MatchSuggestions(0, 20, false, nil); page.TotalSources != 0 {
		t.Fatalf("retained group remains in pending review: %+v", page)
	}
	if got := people.Corrections().RetainedGroups[personID]; !got {
		t.Fatal("retained group decision was not saved")
	}

	if err := people.Sync([]AIAnalysisRecord{peopleTestRecord("retained_000", peopleTestAngle(40))}); err != nil {
		t.Fatal(err)
	}
	if group, _, exists := people.GroupAndFaces(personID); !exists || !group.Confirmed {
		t.Fatalf("retained group did not survive an index rebuild: %+v, exists=%t", group, exists)
	}
	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerBuffaloMVersion); err != nil {
		t.Fatal(err)
	}
	if len(people.Corrections().Profiles[FaceModelQualityV2].RetainedGroups) != 1 || len(people.Corrections().Profiles[FaceModelBuffaloM].RetainedGroups) != 0 {
		t.Fatal("retained group correction crossed model profiles")
	}
}

func newPeopleMatchTestService(t *testing.T) *PeopleService {
	t.Helper()
	root := t.TempDir()
	people, err := OpenPeopleService(filepath.Join(root, "state", "people.json"), filepath.Join(root, "derived", "people-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		t.Fatal(err)
	}
	return people
}

func peopleMatchTestFaces(prefix string, angles []float64) (string, []PersonFace) {
	faces := make([]PersonFace, len(angles))
	for index, angle := range angles {
		resourceID := fmt.Sprintf("%s_%03d", prefix, index)
		key := PersonFaceKey(resourceID, 0)
		faces[index] = PersonFace{
			Key: key, ResourceID: resourceID, FaceIndex: 0,
			Box: []float32{10, 12, 48, 48}, Score: 0.95,
			embedding: peopleTestAngle(angle), recordHash: fmt.Sprintf("hash_%03d", index),
		}
	}
	return stablePersonID(faces[0].Key), faces
}

func peopleInstallMatchGroup(t *testing.T, people *PeopleService, personID string, faces []PersonFace) {
	t.Helper()
	people.mu.Lock()
	defer people.mu.Unlock()
	cluster := &peopleCluster{
		sum: make([]float64, len(faces[0].embedding)), centroid: make([]float32, len(faces[0].embedding)),
		anchor:  peopleClusterAnchor{key: faces[0].Key, resourceID: faces[0].ResourceID, embedding: faces[0].embedding},
		members: make(map[string]struct{}), resources: make(map[string]struct{}),
	}
	for _, face := range faces {
		face.PersonID = personID
		face.originID = personID
		people.faces[face.Key] = face
		people.facesByResource[face.ResourceID] = append(people.facesByResource[face.ResourceID], face.Key)
		cluster.members[face.Key] = struct{}{}
		cluster.resources[face.ResourceID] = struct{}{}
		cluster.count++
		for index, value := range face.embedding {
			cluster.sum[index] += float64(value)
		}
	}
	updatePeopleCentroid(cluster)
	people.clusters[personID] = cluster
	if people.ann == nil {
		people.ann = newPeopleANNIndexForDimension(people.embeddingDimension)
	}
	people.ann.Add(personID, cluster.centroid)
}

func peopleMatchTestRecords(targetFaces, sourceFaces []PersonFace, sameVectors bool) []AIAnalysisRecord {
	records := make([]AIAnalysisRecord, 0, len(targetFaces)+len(sourceFaces))
	for _, face := range append(append([]PersonFace(nil), targetFaces...), sourceFaces...) {
		vector := face.embedding
		if sameVectors && strings.HasPrefix(face.ResourceID, "source_") {
			vector = peopleTestAngle(0)
		}
		records = append(records, peopleTestRecord(face.ResourceID, vector))
	}
	return records
}
