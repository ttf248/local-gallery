package main

import (
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

type evaluationInput struct {
	Model   string                      `json:"model"`
	Photos  []annotatedPhoto            `json:"photos"`
	Records []services.AIAnalysisRecord `json:"records"`
}

type annotatedPhoto struct {
	ResourceID string          `json:"resourceId"`
	Faces      []annotatedFace `json:"faces"`
}

type annotatedFace struct {
	Box       [4]float64 `json:"box"`
	Identity  string     `json:"identity"`
	SmallFace *bool      `json:"smallFace,omitempty"`
}

type detectedFace struct {
	Box       []float32 `json:"box"`
	Score     float32   `json:"score"`
	Embedding []float32 `json:"embedding"`
}

type faceMetrics struct {
	TruePositive  int     `json:"truePositive"`
	FalsePositive int     `json:"falsePositive"`
	FalseNegative int     `json:"falseNegative"`
	Precision     float64 `json:"precision"`
	Recall        float64 `json:"recall"`
	F1            float64 `json:"f1"`
}

type evaluationReport struct {
	Model               string      `json:"model"`
	PhotoCount          int         `json:"photoCount"`
	AnnotatedFaceCount  int         `json:"annotatedFaceCount"`
	DetectedFaceCount   int         `json:"detectedFaceCount"`
	IndexedFaceCount    int         `json:"indexedFaceCount"`
	Detection           faceMetrics `json:"detection"`
	SmallFaceDetection  faceMetrics `json:"smallFaceDetection"`
	IdentityPairwise    faceMetrics `json:"identityPairwise"`
	SplitIdentityCount  int         `json:"splitIdentityCount"`
	MergedGroupCount    int         `json:"mergedGroupCount"`
	GroupCount          int         `json:"groupCount"`
	SingletonGroupCount int         `json:"singletonGroupCount"`
	SingletonGroupShare float64     `json:"singletonGroupShare"`
}

func main() {
	inputPath := flag.String("input", "", "本地评测输入 JSON 路径")
	smallFaceMaxSide := flag.Float64("small-face-max-side", 96, "小脸定义：标注框短边像素上限")
	flag.Parse()
	if *inputPath == "" || *smallFaceMaxSide <= 0 {
		fatal(errors.New("必须提供 --input，且 --small-face-max-side 必须大于 0"))
	}
	file, err := os.Open(*inputPath)
	if err != nil {
		fatal(err)
	}
	defer file.Close()
	var input evaluationInput
	decoder := json.NewDecoder(file)
	if err := decoder.Decode(&input); err != nil {
		fatal(fmt.Errorf("读取评测输入失败: %w", err))
	}
	if err := ensureEOF(decoder); err != nil {
		fatal(err)
	}
	report, err := evaluate(input, *smallFaceMaxSide)
	if err != nil {
		fatal(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fatal(err)
	}
}

func evaluate(input evaluationInput, smallFaceMaxSide float64) (evaluationReport, error) {
	version := services.FaceAnalyzerVersion
	switch input.Model {
	case services.FaceModelQualityV2:
	case services.FaceModelBuffaloM:
		version = services.FaceAnalyzerBuffaloMVersion
	default:
		return evaluationReport{}, fmt.Errorf("unsupported face model %q", input.Model)
	}
	if len(input.Photos) == 0 {
		return evaluationReport{}, errors.New("annotations contain no photos")
	}
	recordsByResource := make(map[string]services.AIAnalysisRecord, len(input.Records))
	for _, record := range input.Records {
		if record.Type != services.AIJobTypeFace || record.ResourceID == "" || record.ModuleVersion != version || record.Status != "faces_found" {
			return evaluationReport{}, fmt.Errorf("invalid face record for resource %q", record.ResourceID)
		}
		if _, exists := recordsByResource[record.ResourceID]; exists {
			return evaluationReport{}, fmt.Errorf("duplicate face record for resource %q", record.ResourceID)
		}
		recordsByResource[record.ResourceID] = record
	}
	if len(recordsByResource) != len(input.Photos) {
		return evaluationReport{}, errors.New("face record count must match the annotated photo count")
	}
	peopleRecords := make([]services.AIAnalysisRecord, 0, len(input.Photos))
	annotatedResources := make(map[string]struct{}, len(input.Photos))
	for _, photo := range input.Photos {
		if photo.ResourceID == "" {
			return evaluationReport{}, errors.New("photo resourceId must not be empty")
		}
		if _, exists := annotatedResources[photo.ResourceID]; exists {
			return evaluationReport{}, fmt.Errorf("duplicate annotation photo %q", photo.ResourceID)
		}
		annotatedResources[photo.ResourceID] = struct{}{}
		record, exists := recordsByResource[photo.ResourceID]
		if !exists {
			return evaluationReport{}, fmt.Errorf("missing face record for resource %q", photo.ResourceID)
		}
		peopleRecords = append(peopleRecords, record)
	}

	root, err := os.MkdirTemp("", "local-gallery-people-eval-")
	if err != nil {
		return evaluationReport{}, err
	}
	defer os.RemoveAll(root)
	people, err := services.OpenPeopleService(filepath.Join(root, "state.json"), filepath.Join(root, "index.json"))
	if err != nil {
		return evaluationReport{}, err
	}
	if err := people.SetFaceAnalyzerVersion(version); err != nil {
		return evaluationReport{}, err
	}
	if err := people.Sync(peopleRecords); err != nil {
		return evaluationReport{}, err
	}
	indexedByKey := make(map[string]string)
	for _, face := range people.AllFaces() {
		indexedByKey[face.Key] = face.PersonID
	}

	report := evaluationReport{Model: input.Model, PhotoCount: len(input.Photos)}
	smallFacePredictionCount := 0
	photoIDs := make(map[string]struct{}, len(input.Photos))
	identityCounts := make(map[string]int)
	predictedGroupCounts := make(map[string]int)
	identityGroupCounts := make(map[string]map[string]struct{})
	groupIdentityCounts := make(map[string]map[string]struct{})
	intersectionCounts := make(map[string]map[string]int)
	for _, photo := range input.Photos {
		if photo.ResourceID == "" {
			return evaluationReport{}, errors.New("photo resourceId must not be empty")
		}
		if _, exists := photoIDs[photo.ResourceID]; exists {
			return evaluationReport{}, fmt.Errorf("duplicate annotation photo %q", photo.ResourceID)
		}
		photoIDs[photo.ResourceID] = struct{}{}
		record, exists := recordsByResource[photo.ResourceID]
		if !exists {
			return evaluationReport{}, fmt.Errorf("missing face record for resource %q", photo.ResourceID)
		}
		predictions, err := recordFaces(record)
		if err != nil {
			return evaluationReport{}, err
		}
		report.AnnotatedFaceCount += len(photo.Faces)
		report.DetectedFaceCount += len(predictions)
		for _, prediction := range predictions {
			if len(prediction.Box) == 4 && math.Min(float64(prediction.Box[2]), float64(prediction.Box[3])) <= smallFaceMaxSide {
				smallFacePredictionCount++
			}
		}
		matched := matchFaces(photo.Faces, predictions)
		report.Detection.TruePositive += len(matched)
		report.Detection.FalsePositive += len(predictions) - len(matched)
		report.Detection.FalseNegative += len(photo.Faces) - len(matched)

		for index, annotation := range photo.Faces {
			if annotation.Identity == "" || !validAnnotationBox(annotation.Box) {
				return evaluationReport{}, fmt.Errorf("photo %q has an invalid face label or box", photo.ResourceID)
			}
			identityCounts[annotation.Identity]++
			small := annotation.Box[2] < smallFaceMaxSide || annotation.Box[3] < smallFaceMaxSide
			if annotation.SmallFace != nil {
				small = *annotation.SmallFace
			}
			if small {
				report.SmallFaceDetection.FalseNegative++
			}
			predictionIndex, found := matched[index]
			if !found {
				continue
			}
			prediction := predictions[predictionIndex]
			if small && math.Min(float64(prediction.Box[2]), float64(prediction.Box[3])) <= smallFaceMaxSide {
				report.SmallFaceDetection.TruePositive++
				report.SmallFaceDetection.FalseNegative--
			}
			groupID := indexedByKey[services.PersonFaceKey(photo.ResourceID, predictionIndex)]
			if groupID == "" {
				continue
			}
			predictedGroupCounts[groupID]++
			if identityGroupCounts[annotation.Identity] == nil {
				identityGroupCounts[annotation.Identity] = make(map[string]struct{})
			}
			identityGroupCounts[annotation.Identity][groupID] = struct{}{}
			if groupIdentityCounts[groupID] == nil {
				groupIdentityCounts[groupID] = make(map[string]struct{})
			}
			groupIdentityCounts[groupID][annotation.Identity] = struct{}{}
			if intersectionCounts[annotation.Identity] == nil {
				intersectionCounts[annotation.Identity] = make(map[string]int)
			}
			intersectionCounts[annotation.Identity][groupID]++
		}
	}
	report.IndexedFaceCount = len(indexedByKey)
	report.Detection.calculate()
	report.SmallFaceDetection.FalsePositive = max(0, smallFacePredictionCount-report.SmallFaceDetection.TruePositive)
	report.SmallFaceDetection.calculate()

	groundTruthPairs := 0
	for _, count := range identityCounts {
		groundTruthPairs += chooseTwo(count)
	}
	truePositivePairs := 0
	for _, groups := range intersectionCounts {
		for _, count := range groups {
			truePositivePairs += chooseTwo(count)
		}
	}
	predictedPairs := 0
	for _, count := range predictedGroupCounts {
		predictedPairs += chooseTwo(count)
	}
	report.IdentityPairwise.TruePositive = truePositivePairs
	report.IdentityPairwise.FalsePositive = predictedPairs - truePositivePairs
	report.IdentityPairwise.FalseNegative = groundTruthPairs - truePositivePairs
	report.IdentityPairwise.calculate()
	for _, groups := range identityGroupCounts {
		if len(groups) > 1 {
			report.SplitIdentityCount++
		}
	}
	for _, identities := range groupIdentityCounts {
		if len(identities) > 1 {
			report.MergedGroupCount++
		}
	}
	groups, _ := people.TopGroups(0, true, nil)
	report.GroupCount = len(groups)
	for _, group := range groups {
		if group.FaceCount == 1 {
			report.SingletonGroupCount++
		}
	}
	if report.GroupCount > 0 {
		report.SingletonGroupShare = float64(report.SingletonGroupCount) / float64(report.GroupCount)
	}
	return report, nil
}

func recordFaces(record services.AIAnalysisRecord) ([]detectedFace, error) {
	var data struct {
		Faces []detectedFace `json:"faces"`
	}
	if err := json.Unmarshal(record.Data, &data); err != nil {
		return nil, fmt.Errorf("invalid face data for resource %q: %w", record.ResourceID, err)
	}
	if len(data.Faces) > services.PeopleMaxFacesPerPhoto {
		return nil, fmt.Errorf("face data for resource %q exceeds the per-photo limit", record.ResourceID)
	}
	return data.Faces, nil
}

type faceMatch struct {
	annotation int
	prediction int
	iou        float64
}

func matchFaces(annotations []annotatedFace, predictions []detectedFace) map[int]int {
	pairs := make([]faceMatch, 0, len(annotations)*len(predictions))
	for annotationIndex, annotation := range annotations {
		for predictionIndex, prediction := range predictions {
			if len(prediction.Box) != 4 {
				continue
			}
			iou := boxIoU(annotation.Box, prediction.Box)
			if iou >= 0.5 {
				pairs = append(pairs, faceMatch{annotationIndex, predictionIndex, iou})
			}
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		if pairs[i].iou != pairs[j].iou {
			return pairs[i].iou > pairs[j].iou
		}
		if pairs[i].annotation != pairs[j].annotation {
			return pairs[i].annotation < pairs[j].annotation
		}
		return pairs[i].prediction < pairs[j].prediction
	})
	matchedAnnotations := make(map[int]int)
	matchedPredictions := make(map[int]struct{})
	for _, pair := range pairs {
		if _, exists := matchedAnnotations[pair.annotation]; exists {
			continue
		}
		if _, exists := matchedPredictions[pair.prediction]; exists {
			continue
		}
		matchedAnnotations[pair.annotation] = pair.prediction
		matchedPredictions[pair.prediction] = struct{}{}
	}
	return matchedAnnotations
}

func boxIoU(left [4]float64, right []float32) float64 {
	leftX1, leftY1 := left[0], left[1]
	leftX2, leftY2 := left[0]+left[2], left[1]+left[3]
	rightX1, rightY1 := float64(right[0]), float64(right[1])
	rightX2, rightY2 := rightX1+float64(right[2]), rightY1+float64(right[3])
	intersectionWidth := math.Max(0, math.Min(leftX2, rightX2)-math.Max(leftX1, rightX1))
	intersectionHeight := math.Max(0, math.Min(leftY2, rightY2)-math.Max(leftY1, rightY1))
	intersection := intersectionWidth * intersectionHeight
	union := left[2]*left[3] + float64(right[2])*float64(right[3]) - intersection
	if union <= 0 {
		return 0
	}
	return intersection / union
}

func validAnnotationBox(box [4]float64) bool {
	for _, value := range box {
		if math.IsNaN(value) || math.IsInf(value, 0) {
			return false
		}
	}
	return box[2] > 0 && box[3] > 0
}

func (metrics *faceMetrics) calculate() {
	if metrics.TruePositive+metrics.FalsePositive > 0 {
		metrics.Precision = float64(metrics.TruePositive) / float64(metrics.TruePositive+metrics.FalsePositive)
	}
	if metrics.TruePositive+metrics.FalseNegative > 0 {
		metrics.Recall = float64(metrics.TruePositive) / float64(metrics.TruePositive+metrics.FalseNegative)
	}
	if metrics.Precision+metrics.Recall > 0 {
		metrics.F1 = 2 * metrics.Precision * metrics.Recall / (metrics.Precision + metrics.Recall)
	}
}

func chooseTwo(value int) int {
	return value * (value - 1) / 2
}

func ensureEOF(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		return errors.New("评测输入包含多个 JSON 值或尾随内容")
	}
	return nil
}

func fatal(err error) {
	fmt.Fprintln(os.Stderr, err)
	os.Exit(1)
}
