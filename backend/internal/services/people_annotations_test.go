package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestPeopleAnnotationStoresSeparatelyFromCorrections(t *testing.T) {
	root := t.TempDir()
	statePath := filepath.Join(root, "state", "people-annotations.json")
	annotations, err := OpenPeopleAnnotationService(statePath)
	if err != nil {
		t.Fatal(err)
	}
	identity, err := annotations.CreateIdentity("妈妈")
	if err != nil {
		t.Fatal(err)
	}
	if identity.ID == "" {
		t.Fatal("identity was created without an anonymous id")
	}
	small := true
	if err := annotations.SavePhoto(PeopleAnnotationSave{
		ResourceID: "f_001",
		Tags:       []string{"groupPhoto", "crossAge"},
		Faces: []PeopleAnnotationFace{
			{Identity: identity.ID, Box: []float32{10, 20, 30, 40}, SmallFace: &small, Source: "manual"},
		},
		Reviewed: true,
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(statePath); err != nil {
		t.Fatalf("annotation state was not written: %v", err)
	}
	reopened, err := OpenPeopleAnnotationService(statePath)
	if err != nil {
		t.Fatal(err)
	}
	identities := reopened.Identities()
	if len(identities) != 1 || identities[0].ID != identity.ID || identities[0].Label != "妈妈" {
		t.Fatalf("reopened identities = %+v, want the saved anonymous identity", identities)
	}
	progress := reopened.Progress()
	if progress.IdentityCount != 1 || progress.FaceCount != 1 ||
		progress.AnnotatedPhotoCount != 1 || progress.ReviewedCount != 0 {
		t.Fatalf("progress = %+v, want one identity and one face", progress)
	}
}

func TestPeopleAnnotationRejectsUnknownIdentity(t *testing.T) {
	annotations, err := OpenPeopleAnnotationService(filepath.Join(t.TempDir(), "annotations.json"))
	if err != nil {
		t.Fatal(err)
	}
	err = annotations.SavePhoto(PeopleAnnotationSave{
		ResourceID: "f_001",
		Faces:      []PeopleAnnotationFace{{Identity: "id-999", Box: []float32{1, 2, 3, 4}}},
	})
	if err == nil {
		t.Fatal("annotation with an unknown identity was accepted")
	}
}

func TestPeopleAnnotationDatasetMatchesEvaluationSchema(t *testing.T) {
	annotations, err := OpenPeopleAnnotationService(filepath.Join(t.TempDir(), "annotations.json"))
	if err != nil {
		t.Fatal(err)
	}
	identity, err := annotations.CreateIdentity("")
	if err != nil {
		t.Fatal(err)
	}
	if err := annotations.SavePhoto(PeopleAnnotationSave{
		ResourceID: "f_001",
		Tags:       []string{"profile"},
		Faces:      []PeopleAnnotationFace{{Identity: identity.ID, Box: []float32{1, 2, 3, 4}}},
	}); err != nil {
		t.Fatal(err)
	}
	dataset, err := annotations.Dataset(func(resourceID string) (string, bool) {
		if resourceID != "f_001" {
			return "", false
		}
		return filepath.Join(t.TempDir(), "photo.jpg"), true
	})
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(dataset)
	if err != nil {
		t.Fatal(err)
	}
	var decoded struct {
		SchemaVersion int `json:"schemaVersion"`
		Photos        []struct {
			ResourceID string   `json:"resourceId"`
			Path       string   `json:"path"`
			Tags       []string `json:"tags"`
			Faces      []struct {
				Box      []float32 `json:"box"`
				Identity string    `json:"identity"`
			} `json:"faces"`
		} `json:"photos"`
	}
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.SchemaVersion != 1 {
		t.Fatalf("dataset schemaVersion = %d, want 1", decoded.SchemaVersion)
	}
	if len(decoded.Photos) != 1 || decoded.Photos[0].ResourceID != "f_001" {
		t.Fatalf("dataset photos = %+v, want the annotated photo", decoded.Photos)
	}
	if len(decoded.Photos[0].Tags) != 1 || decoded.Photos[0].Tags[0] != "profile" {
		t.Fatalf("dataset tags = %+v, want the scenario tag", decoded.Photos[0].Tags)
	}
	if len(decoded.Photos[0].Faces) != 1 || decoded.Photos[0].Faces[0].Identity != identity.ID {
		t.Fatalf("dataset faces = %+v, want the labelled face", decoded.Photos[0].Faces)
	}
}

func TestPeopleAnnotationDatasetSkipsPhotosWithoutPath(t *testing.T) {
	annotations, err := OpenPeopleAnnotationService(filepath.Join(t.TempDir(), "annotations.json"))
	if err != nil {
		t.Fatal(err)
	}
	identity, err := annotations.CreateIdentity("")
	if err != nil {
		t.Fatal(err)
	}
	if err := annotations.SavePhoto(PeopleAnnotationSave{
		ResourceID: "f_missing",
		Faces:      []PeopleAnnotationFace{{Identity: identity.ID, Box: []float32{1, 2, 3, 4}}},
	}); err != nil {
		t.Fatal(err)
	}
	dataset, err := annotations.Dataset(func(string) (string, bool) { return "", false })
	if err != nil {
		t.Fatal(err)
	}
	if len(dataset.Photos) != 0 {
		t.Fatalf("dataset = %+v, want no photo without a resolvable path", dataset.Photos)
	}
}
