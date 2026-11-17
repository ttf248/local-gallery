package main

import (
	"encoding/json"
	"math"
	"testing"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

func TestEvaluateMeasuresDetectionAndIdentityGrouping(t *testing.T) {
	firstVector := make([]float32, 128)
	firstVector[0] = 1
	otherVector := make([]float32, 128)
	otherVector[1] = 1
	first := evaluationFace(firstVector, 40, 40)
	other := evaluationFace(otherVector, 140, 140)
	other.Box[2], other.Box[3] = 140, 140
	firstData, err := json.Marshal(struct {
		Faces []detectedFace `json:"faces"`
	}{Faces: []detectedFace{first}})
	if err != nil {
		t.Fatal(err)
	}
	secondData, err := json.Marshal(struct {
		Faces []detectedFace `json:"faces"`
	}{Faces: []detectedFace{first}})
	if err != nil {
		t.Fatal(err)
	}
	thirdData, err := json.Marshal(struct {
		Faces []detectedFace `json:"faces"`
	}{Faces: []detectedFace{other}})
	if err != nil {
		t.Fatal(err)
	}
	input := evaluationInput{
		Model: services.FaceModelQualityV2,
		Photos: []annotatedPhoto{
			{ResourceID: "sample-a", Faces: []annotatedFace{{Box: [4]float64{40, 40, 40, 40}, Identity: "person-a", SmallFace: boolPointer(true)}}},
			{ResourceID: "sample-b", Faces: []annotatedFace{{Box: [4]float64{40, 40, 40, 40}, Identity: "person-a", SmallFace: boolPointer(true)}}},
			{ResourceID: "sample-c", Faces: []annotatedFace{{Box: [4]float64{140, 140, 140, 140}, Identity: "person-b"}}},
		},
		Records: []services.AIAnalysisRecord{
			evaluationRecord("sample-a", firstData),
			evaluationRecord("sample-b", secondData),
			evaluationRecord("sample-c", thirdData),
		},
	}

	report, err := evaluate(input, 96)
	if err != nil {
		t.Fatal(err)
	}
	if report.Detection.TruePositive != 3 || report.Detection.FalsePositive != 0 || report.Detection.FalseNegative != 0 {
		t.Fatalf("detection metrics = %+v", report.Detection)
	}
	if report.SmallFaceDetection.TruePositive != 2 || report.SmallFaceDetection.FalseNegative != 0 {
		t.Fatalf("small-face metrics = %+v", report.SmallFaceDetection)
	}
	if report.IdentityPairwise.TruePositive != 1 || report.IdentityPairwise.FalsePositive != 0 || report.IdentityPairwise.FalseNegative != 0 {
		t.Fatalf("identity metrics = %+v", report.IdentityPairwise)
	}
	if report.SplitIdentityCount != 0 || report.MergedGroupCount != 0 || report.GroupCount != 2 ||
		report.SingletonGroupCount != 1 || math.Abs(report.SingletonGroupShare-.5) > 1e-9 {
		t.Fatalf("group metrics = %+v", report)
	}
	input.Records = append(input.Records, evaluationRecord("unannotated-photo", firstData))
	if _, err := evaluate(input, 96); err == nil {
		t.Fatal("evaluation accepted face records outside the annotated photo set")
	}
}

func evaluationFace(vector []float32, x, y float32) detectedFace {
	return detectedFace{
		Box: []float32{x, y, 40, 40}, Score: .99, Embedding: vector,
	}
}

func evaluationRecord(resourceID string, data []byte) services.AIAnalysisRecord {
	return services.AIAnalysisRecord{
		Type: services.AIJobTypeFace, ResourceID: resourceID,
		Size: 1, MTimeNs: 1, ModuleVersion: services.FaceAnalyzerVersion,
		Status: "faces_found", Data: data, UpdatedAt: time.Now(),
	}
}

func boolPointer(value bool) *bool {
	return &value
}
