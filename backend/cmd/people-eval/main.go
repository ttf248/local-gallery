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
	"strings"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

type evaluationInput struct {
	Model   string                      `json:"model"`
	Photos  []annotatedPhoto            `json:"photos"`
	Records []services.AIAnalysisRecord `json:"records"`
}

type annotatedPhoto struct {
	ResourceID string          `json:"resourceId"`
	Path       string          `json:"path,omitempty"`
	Tags       []string        `json:"tags,omitempty"`
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
	Model                 string                  `json:"model"`
	PhotoCount            int                     `json:"photoCount"`
	AnnotatedFaceCount    int                     `json:"annotatedFaceCount"`
	DetectedFaceCount     int                     `json:"detectedFaceCount"`
	IndexedFaceCount      int                     `json:"indexedFaceCount"`
	Detection             faceMetrics             `json:"detection"`
	SmallFaceDetection    faceMetrics             `json:"smallFaceDetection"`
	IdentityPairwise      faceMetrics             `json:"identityPairwise"`
	LabeledIdentityCount  int                     `json:"labeledIdentityCount"`
	SplitIdentityCount    int                     `json:"splitIdentityCount"`
	SplitIdentityRate     float64                 `json:"splitIdentityRate"`
	MergedGroupCount      int                     `json:"mergedGroupCount"`
	MergedGroupRate       float64                 `json:"mergedGroupRate"`
	GroupCount            int                     `json:"groupCount"`
	SingletonGroupCount   int                     `json:"singletonGroupCount"`
	SingletonGroupShare   float64                 `json:"singletonGroupShare"`
	EmbeddingIndexedShare float64                 `json:"embeddingIndexedShare"`
	FeatureSimilarity     featureSimilarityReport `json:"featureSimilarity"`
	Scenarios             []scenarioMetrics       `json:"scenarios"`
	Years                 []scenarioMetrics       `json:"years"`
	FaceSizeBands         []faceSizeBandMetrics   `json:"faceSizeBands"`
	MatchPolicy           string                  `json:"matchPolicy"`
	MatchSuggestions      matchSuggestionMetrics  `json:"matchSuggestions"`
}

// matchSuggestionMetrics 描述待确认匹配这一层的效果。
//
// 分组的 Precision/Recall 衡量「自动分组」；这里衡量的是另一件事：
// 同一个人的两个分组，有没有被摆到用户面前。
type matchSuggestionMetrics struct {
	SourceCount            int                `json:"sourceCount"`
	SuggestionCount        int                `json:"suggestionCount"`
	TrueDuplicatePairs     int                `json:"trueDuplicatePairs"`
	SurfacedDuplicatePairs int                `json:"surfacedDuplicatePairs"`
	MissedDuplicatePairs   int                `json:"missedDuplicatePairs"`
	FalseSuggestionCount   int                `json:"falseSuggestionCount"`
	DuplicateRecall        float64            `json:"duplicateRecall"`
	SuggestionPrecision    float64            `json:"suggestionPrecision"`
	MissedDuplicates       []duplicateFailure `json:"missedDuplicates,omitempty"`
	FalseSuggestions       []duplicateFailure `json:"falseSuggestions,omitempty"`
}

// duplicateFailure 是一条可追溯的失败案例。
type duplicateFailure struct {
	Identity       string   `json:"identity,omitempty"`
	SourceGroup    string   `json:"sourceGroup"`
	TargetGroup    string   `json:"targetGroup"`
	SourcePhotos   []string `json:"sourcePhotos,omitempty"`
	TargetPhotos   []string `json:"targetPhotos,omitempty"`
	SourceIdentity string   `json:"sourceIdentity,omitempty"`
	// BestSimilarity 是两组之间最高的一对脸相似度；它是「其实像但没被
	// 摆到用户面前」这类漏召回的直接证据。
	BestSimilarity float64 `json:"bestSimilarity,omitempty"`
	// TargetInternalSimilarity 是目标组内部各脸之间的相似度下界，
	// 用来判断「像到什么程度才算同一个人」。
	TargetInternalSimilarity float64 `json:"targetInternalSimilarity,omitempty"`
}

// faceSizeBandMetrics 按脸部短边分档统计检测效果。
type faceSizeBandMetrics struct {
	Band           string      `json:"band"`
	MaxSide        float64     `json:"maxSide"`
	AnnotatedFaces int         `json:"annotatedFaces"`
	DetectedFaces  int         `json:"detectedFaces"`
	Detection      faceMetrics `json:"detection"`
}

type scenarioMetrics struct {
	Tag                   string                  `json:"tag"`
	PhotoCount            int                     `json:"photoCount"`
	AnnotatedFaceCount    int                     `json:"annotatedFaceCount"`
	DetectedFaceCount     int                     `json:"detectedFaceCount"`
	IndexedFaceCount      int                     `json:"indexedFaceCount"`
	Detection             faceMetrics             `json:"detection"`
	SmallFaceDetection    faceMetrics             `json:"smallFaceDetection"`
	IdentityPairwise      faceMetrics             `json:"identityPairwise"`
	LabeledIdentityCount  int                     `json:"labeledIdentityCount"`
	SplitIdentityCount    int                     `json:"splitIdentityCount"`
	SplitIdentityRate     float64                 `json:"splitIdentityRate"`
	MergedGroupCount      int                     `json:"mergedGroupCount"`
	MergedGroupRate       float64                 `json:"mergedGroupRate"`
	GroupCount            int                     `json:"groupCount"`
	SingletonGroupCount   int                     `json:"singletonGroupCount"`
	SingletonGroupShare   float64                 `json:"singletonGroupShare"`
	EmbeddingIndexedShare float64                 `json:"embeddingIndexedShare"`
	FeatureSimilarity     featureSimilarityReport `json:"featureSimilarity"`
}

type featureSimilarityReport struct {
	SampledFaceCount  int               `json:"sampledFaceCount"`
	SameIdentity      similaritySummary `json:"sameIdentity"`
	DifferentIdentity similaritySummary `json:"differentIdentity"`
}

type similaritySummary struct {
	PairCount int     `json:"pairCount"`
	Mean      float64 `json:"mean"`
	P10       float64 `json:"p10"`
	Median    float64 `json:"median"`
	P90       float64 `json:"p90"`
}

type featureSample struct {
	photoID   string
	identity  string
	embedding []float32
}

func main() {
	inputPath := flag.String("input", "", "本地评测输入 JSON 路径")
	smallFaceMaxSide := flag.Float64("small-face-max-side", 96, "小脸定义：标注框短边像素上限")
	matchPolicy := flag.String("match-policy", "current", "待确认匹配口径：current 或 legacy（旧口径，用于前后对照）")
	flag.Parse()
	if *inputPath == "" || math.IsNaN(*smallFaceMaxSide) || math.IsInf(*smallFaceMaxSide, 0) || *smallFaceMaxSide <= 0 {
		fatal(errors.New("必须提供 --input，且 --small-face-max-side 必须大于 0"))
	}
	if *matchPolicy != "current" && *matchPolicy != "legacy" {
		fatal(errors.New("--match-policy 只能是 current 或 legacy"))
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
	report, err := evaluate(input, *smallFaceMaxSide, *matchPolicy)
	if err != nil {
		fatal(err)
	}
	encoder := json.NewEncoder(os.Stdout)
	encoder.SetIndent("", "  ")
	if err := encoder.Encode(report); err != nil {
		fatal(err)
	}
}

func evaluate(input evaluationInput, smallFaceMaxSide float64, matchPolicy string) (evaluationReport, error) {
	if math.IsNaN(smallFaceMaxSide) || math.IsInf(smallFaceMaxSide, 0) || smallFaceMaxSide <= 0 {
		return evaluationReport{}, errors.New("small-face-max-side must be a positive finite number")
	}
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
	switch matchPolicy {
	case "legacy":
		people.SetMatchPolicy(services.LegacyPeopleMatchPolicy())
	default:
		people.SetMatchPolicy(services.DefaultPeopleMatchPolicy())
	}
	if err := people.Sync(peopleRecords); err != nil {
		return evaluationReport{}, err
	}
	indexedByKey := make(map[string]string)
	for _, face := range people.AllFaces() {
		indexedByKey[face.Key] = face.PersonID
	}

	report := evaluationReport{Model: input.Model, PhotoCount: len(input.Photos), MatchPolicy: matchPolicy}
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
		tags := make(map[string]struct{}, len(photo.Tags))
		for _, tag := range photo.Tags {
			if tag == "" {
				return evaluationReport{}, fmt.Errorf("photo %q contains an empty scenario tag", photo.ResourceID)
			}
			if _, exists := tags[tag]; exists {
				return evaluationReport{}, fmt.Errorf("photo %q contains duplicate scenario tag %q", photo.ResourceID, tag)
			}
			tags[tag] = struct{}{}
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
	report.LabeledIdentityCount = len(identityCounts)
	if report.LabeledIdentityCount > 0 {
		report.SplitIdentityRate = float64(report.SplitIdentityCount) / float64(report.LabeledIdentityCount)
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
		report.MergedGroupRate = float64(report.MergedGroupCount) / float64(report.GroupCount)
	}
	if report.DetectedFaceCount > 0 {
		report.EmbeddingIndexedShare = float64(report.IndexedFaceCount) / float64(report.DetectedFaceCount)
	}
	report.FeatureSimilarity, err = featureSimilarities(input.Photos, recordsByResource)
	if err != nil {
		return evaluationReport{}, err
	}
	photosByTag := make(map[string][]annotatedPhoto)
	for _, photo := range input.Photos {
		for _, tag := range photo.Tags {
			photosByTag[tag] = append(photosByTag[tag], photo)
		}
	}
	tags := make([]string, 0, len(photosByTag))
	for tag := range photosByTag {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	report.Scenarios = make([]scenarioMetrics, 0, len(tags))
	for _, tag := range tags {
		scenario, err := evaluateScenario(
			tag, photosByTag[tag], recordsByResource, indexedByKey, smallFaceMaxSide,
		)
		if err != nil {
			return evaluationReport{}, err
		}
		report.Scenarios = append(report.Scenarios, scenario)
	}

	photosByYear := make(map[string][]annotatedPhoto)
	for _, photo := range input.Photos {
		year := photoYear(photo.Path)
		if year == "" {
			continue
		}
		photosByYear[year] = append(photosByYear[year], photo)
	}
	years := make([]string, 0, len(photosByYear))
	for year := range photosByYear {
		years = append(years, year)
	}
	sort.Strings(years)
	report.Years = make([]scenarioMetrics, 0, len(years))
	for _, year := range years {
		subset, err := evaluateScenario(
			year, photosByYear[year], recordsByResource, indexedByKey, smallFaceMaxSide,
		)
		if err != nil {
			return evaluationReport{}, err
		}
		report.Years = append(report.Years, subset)
	}

	report.FaceSizeBands = evaluateFaceSizeBands(input.Photos, recordsByResource, smallFaceMaxSide)
	report.MatchSuggestions = evaluateMatchSuggestions(people, identityGroupCounts, groupIdentityCounts)
	return report, nil
}

// photoYear 从照片路径里取拍摄年份。
//
// 标注集里的路径来自真实照片目录，年份通常在目录名里（2020年、2019-05…）。
// 取不到就当作没有年份证据，不影响其它指标。
func photoYear(path string) string {
	if path == "" {
		return ""
	}
	normalized := strings.ReplaceAll(path, "\\", "/")
	for _, part := range strings.Split(normalized, "/") {
		digits := make([]rune, 0, 4)
		for _, char := range part {
			if char >= '0' && char <= '9' {
				digits = append(digits, char)
				continue
			}
			if len(digits) == 4 && (digits[0] == '1' || digits[0] == '2') {
				return string(digits)
			}
			digits = digits[:0]
		}
		if len(digits) == 4 && (digits[0] == '1' || digits[0] == '2') {
			return string(digits)
		}
	}
	return ""
}

// evaluateFaceSizeBands 按标注脸的短边分档统计检测效果。
func evaluateFaceSizeBands(
	photos []annotatedPhoto,
	recordsByResource map[string]services.AIAnalysisRecord,
	smallFaceMaxSide float64,
) []faceSizeBandMetrics {
	bands := []struct {
		name    string
		maxSide float64
	}{
		{"tiny", 48},
		{"small", smallFaceMaxSide},
		{"medium", 192},
		{"large", 0},
	}
	metrics := make([]faceSizeBandMetrics, len(bands))
	for index, band := range bands {
		metrics[index] = faceSizeBandMetrics{Band: band.name, MaxSide: band.maxSide}
	}
	for _, photo := range photos {
		record, exists := recordsByResource[photo.ResourceID]
		if !exists {
			continue
		}
		predictions, err := recordFaces(record)
		if err != nil {
			continue
		}
		matched := matchFaces(photo.Faces, predictions)
		for annotationIndex := range matched {
			annotation := photo.Faces[annotationIndex]
			side := math.Min(annotation.Box[2], annotation.Box[3])
			for index, band := range bands {
				if band.maxSide == 0 || side < band.maxSide {
					metrics[index].AnnotatedFaces++
					break
				}
			}
		}
		for _, prediction := range predictions {
			if len(prediction.Box) != 4 {
				continue
			}
			side := math.Min(float64(prediction.Box[2]), float64(prediction.Box[3]))
			for index, band := range bands {
				if band.maxSide == 0 || side < band.maxSide {
					metrics[index].DetectedFaces++
					break
				}
			}
		}
	}
	for index := range metrics {
		metrics[index].Detection.TruePositive = metrics[index].AnnotatedFaces
		metrics[index].Detection.FalseNegative = 0
		metrics[index].Detection.FalsePositive = 0
		metrics[index].Detection.calculate()
	}
	return metrics
}

// evaluateMatchSuggestions 衡量待确认匹配这一层：同一个人的两个分组有没有
// 被摆到用户面前，以及有没有把不同的人摆到一起。
func evaluateMatchSuggestions(
	people *services.PeopleService,
	identityGroups map[string]map[string]struct{},
	groupIdentities map[string]map[string]struct{},
) matchSuggestionMetrics {
	metrics := matchSuggestionMetrics{}
	type groupPair struct{ left, right string }
	truePairs := map[groupPair]map[string]struct{}{}
	for identity, groups := range identityGroups {
		ids := make([]string, 0, len(groups))
		for id := range groups {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for left := 0; left < len(ids); left++ {
			for right := left + 1; right < len(ids); right++ {
				pair := groupPair{ids[left], ids[right]}
				if truePairs[pair] == nil {
					truePairs[pair] = map[string]struct{}{}
				}
				truePairs[pair][identity] = struct{}{}
			}
		}
	}
	metrics.TrueDuplicatePairs = len(truePairs)

	surfaced := map[groupPair]bool{}
	offset := 0
	for page := 0; page < 200; page++ {
		result := people.MatchSuggestions(offset, 50, false, nil)
		if len(result.Items) == 0 {
			break
		}
		for _, item := range result.Items {
			metrics.SourceCount++
			for _, candidate := range item.Candidates {
				metrics.SuggestionCount++
				pair := groupPair{item.Source.ID, candidate.Person.ID}
				if pair.left > pair.right {
					pair.left, pair.right = pair.right, pair.left
				}
				if _, exists := truePairs[pair]; exists {
					surfaced[pair] = true
					continue
				}
				metrics.FalseSuggestionCount++
				if len(metrics.FalseSuggestions) < 50 {
					metrics.FalseSuggestions = append(metrics.FalseSuggestions, duplicateFailure{
						SourceGroup:    item.Source.ID,
						TargetGroup:    candidate.Person.ID,
						SourcePhotos:   peopleGroupPhotos(people, item.Source.ID),
						TargetPhotos:   peopleGroupPhotos(people, candidate.Person.ID),
						SourceIdentity: peopleGroupIdentityLabel(groupIdentities, item.Source.ID),
					})
				}
			}
		}
		if !result.HasMore {
			break
		}
		offset = result.NextOffset
	}
	metrics.SurfacedDuplicatePairs = len(surfaced)
	metrics.MissedDuplicatePairs = len(truePairs) - len(surfaced)
	if len(truePairs) > 0 {
		metrics.DuplicateRecall = float64(len(surfaced)) / float64(len(truePairs))
	}
	if metrics.SuggestionCount > 0 {
		metrics.SuggestionPrecision = float64(len(surfaced)) / float64(metrics.SuggestionCount)
	}
	for pair, identities := range truePairs {
		if surfaced[pair] {
			continue
		}
		if len(metrics.MissedDuplicates) >= 50 {
			break
		}
		labels := make([]string, 0, len(identities))
		for identity := range identities {
			labels = append(labels, identity)
		}
		sort.Strings(labels)
		metrics.MissedDuplicates = append(metrics.MissedDuplicates, duplicateFailure{
			Identity:                 labels[0],
			SourceGroup:              pair.left,
			TargetGroup:              pair.right,
			SourcePhotos:             peopleGroupPhotos(people, pair.left),
			TargetPhotos:             peopleGroupPhotos(people, pair.right),
			BestSimilarity:           services.PeopleGroupBestSimilarity(people, pair.left, pair.right),
			TargetInternalSimilarity: services.PeopleGroupInternalSimilarity(people, pair.right),
		})
	}
	sort.Slice(metrics.MissedDuplicates, func(i, j int) bool {
		return metrics.MissedDuplicates[i].SourceGroup < metrics.MissedDuplicates[j].SourceGroup
	})
	sort.Slice(metrics.FalseSuggestions, func(i, j int) bool {
		return metrics.FalseSuggestions[i].SourceGroup < metrics.FalseSuggestions[j].SourceGroup
	})
	return metrics
}

func peopleGroupIdentityLabel(groupIdentities map[string]map[string]struct{}, groupID string) string {
	identities := make([]string, 0, len(groupIdentities[groupID]))
	for identity := range groupIdentities[groupID] {
		identities = append(identities, identity)
	}
	sort.Strings(identities)
	if len(identities) == 0 {
		return ""
	}
	return identities[0]
}

func peopleGroupPhotos(people *services.PeopleService, groupID string) []string {
	_, faces, exists := people.GroupAndFaces(groupID)
	if !exists {
		return nil
	}
	seen := make(map[string]struct{})
	result := make([]string, 0, len(faces))
	for _, face := range faces {
		if _, exists := seen[face.ResourceID]; exists {
			continue
		}
		seen[face.ResourceID] = struct{}{}
		result = append(result, face.ResourceID)
	}
	sort.Strings(result)
	if len(result) > 5 {
		result = result[:5]
	}
	return result
}

func evaluateScenario(
	tag string,
	photos []annotatedPhoto,
	recordsByResource map[string]services.AIAnalysisRecord,
	indexedByKey map[string]string,
	smallFaceMaxSide float64,
) (scenarioMetrics, error) {
	var report scenarioMetrics
	report.Tag = tag
	identityCounts := make(map[string]int)
	predictedGroupCounts := make(map[string]int)
	identityGroupCounts := make(map[string]map[string]struct{})
	groupIdentityCounts := make(map[string]map[string]struct{})
	intersectionCounts := make(map[string]map[string]int)
	groupFaceCounts := make(map[string]int)
	selectedPhotos := make([]annotatedPhoto, 0)
	smallFacePredictionCount := 0
	for _, photo := range photos {
		selectedPhotos = append(selectedPhotos, photo)
		report.PhotoCount++
		record, exists := recordsByResource[photo.ResourceID]
		if !exists {
			return scenarioMetrics{}, fmt.Errorf("missing face record for resource %q", photo.ResourceID)
		}
		predictions, err := recordFaces(record)
		if err != nil {
			return scenarioMetrics{}, err
		}
		report.AnnotatedFaceCount += len(photo.Faces)
		report.DetectedFaceCount += len(predictions)
		for index, prediction := range predictions {
			if len(prediction.Box) == 4 && math.Min(float64(prediction.Box[2]), float64(prediction.Box[3])) <= smallFaceMaxSide {
				smallFacePredictionCount++
			}
			groupID := indexedByKey[services.PersonFaceKey(photo.ResourceID, index)]
			if groupID != "" {
				report.IndexedFaceCount++
				groupFaceCounts[groupID]++
			}
		}
		matched := matchFaces(photo.Faces, predictions)
		report.Detection.TruePositive += len(matched)
		report.Detection.FalsePositive += len(predictions) - len(matched)
		report.Detection.FalseNegative += len(photo.Faces) - len(matched)
		for index, annotation := range photo.Faces {
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
	report.LabeledIdentityCount = len(identityCounts)
	if report.LabeledIdentityCount > 0 {
		report.SplitIdentityRate = float64(report.SplitIdentityCount) / float64(report.LabeledIdentityCount)
	}
	report.GroupCount = len(groupFaceCounts)
	for _, faceCount := range groupFaceCounts {
		if faceCount == 1 {
			report.SingletonGroupCount++
		}
	}
	if report.GroupCount > 0 {
		report.SingletonGroupShare = float64(report.SingletonGroupCount) / float64(report.GroupCount)
		report.MergedGroupRate = float64(report.MergedGroupCount) / float64(report.GroupCount)
	}
	if report.DetectedFaceCount > 0 {
		report.EmbeddingIndexedShare = float64(report.IndexedFaceCount) / float64(report.DetectedFaceCount)
	}
	featureMetrics, err := featureSimilarities(selectedPhotos, recordsByResource)
	if err != nil {
		return scenarioMetrics{}, err
	}
	report.FeatureSimilarity = featureMetrics
	return report, nil
}

func featureSimilarities(
	photos []annotatedPhoto,
	recordsByResource map[string]services.AIAnalysisRecord,
) (featureSimilarityReport, error) {
	const maxSamples = 256
	samples := make([]featureSample, 0)
	for _, photo := range photos {
		record, exists := recordsByResource[photo.ResourceID]
		if !exists {
			return featureSimilarityReport{}, fmt.Errorf("missing face record for resource %q", photo.ResourceID)
		}
		predictions, err := recordFaces(record)
		if err != nil {
			return featureSimilarityReport{}, err
		}
		for annotationIndex, predictionIndex := range matchFaces(photo.Faces, predictions) {
			embedding := predictions[predictionIndex].Embedding
			if len(embedding) == 0 || !validVector(embedding) {
				continue
			}
			samples = append(samples, featureSample{
				photoID: photo.ResourceID, identity: photo.Faces[annotationIndex].Identity,
				embedding: embedding,
			})
		}
	}
	if len(samples) > maxSamples {
		selected := make([]featureSample, 0, maxSamples)
		for index := 0; index < maxSamples; index++ {
			selected = append(selected, samples[index*(len(samples)-1)/(maxSamples-1)])
		}
		samples = selected
	}
	report := featureSimilarityReport{SampledFaceCount: len(samples)}
	sameIdentity := make([]float64, 0)
	differentIdentity := make([]float64, 0)
	for left := 0; left < len(samples); left++ {
		for right := left + 1; right < len(samples); right++ {
			if samples[left].photoID == samples[right].photoID {
				continue
			}
			similarity, ok := cosineSimilarity(samples[left].embedding, samples[right].embedding)
			if !ok {
				continue
			}
			if samples[left].identity == samples[right].identity {
				sameIdentity = append(sameIdentity, similarity)
			} else {
				differentIdentity = append(differentIdentity, similarity)
			}
		}
	}
	report.SameIdentity = summarizeSimilarities(sameIdentity)
	report.DifferentIdentity = summarizeSimilarities(differentIdentity)
	return report, nil
}

func validVector(vector []float32) bool {
	for _, value := range vector {
		if math.IsNaN(float64(value)) || math.IsInf(float64(value), 0) {
			return false
		}
	}
	return true
}

func cosineSimilarity(left, right []float32) (float64, bool) {
	if len(left) == 0 || len(left) != len(right) {
		return 0, false
	}
	dot, leftNorm, rightNorm := 0.0, 0.0, 0.0
	for index, value := range left {
		leftValue, rightValue := float64(value), float64(right[index])
		dot += leftValue * rightValue
		leftNorm += leftValue * leftValue
		rightNorm += rightValue * rightValue
	}
	if leftNorm == 0 || rightNorm == 0 {
		return 0, false
	}
	return math.Max(-1, math.Min(1, dot/math.Sqrt(leftNorm*rightNorm))), true
}

func summarizeSimilarities(values []float64) similaritySummary {
	if len(values) == 0 {
		return similaritySummary{}
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	total := 0.0
	for _, value := range sorted {
		total += value
	}
	return similaritySummary{
		PairCount: len(sorted), Mean: total / float64(len(sorted)),
		P10: quantile(sorted, 0.10), Median: quantile(sorted, 0.50),
		P90: quantile(sorted, 0.90),
	}
}

func quantile(sorted []float64, fraction float64) float64 {
	position := fraction * float64(len(sorted)-1)
	lower := int(math.Floor(position))
	upper := int(math.Ceil(position))
	if lower == upper {
		return sorted[lower]
	}
	weight := position - float64(lower)
	return sorted[lower]*(1-weight) + sorted[upper]*weight
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
