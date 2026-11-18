package services

import (
	"math"
	"sort"
)

// 人物组质量评估：用组内相似度与检测分数的下界描述一组有多稳。
// 这些数值只用于排序复核线索，不代表身份概率。

type peopleGroupQualitySamples struct {
	anchor   []float32
	fallback PersonFace
	sum      []float64
	members  []PersonFace
}

func (samples *peopleGroupQualitySamples) summarize() *PersonGroupQuality {
	if len(samples.members) == 0 {
		return nil
	}
	anchor := samples.anchor
	if len(anchor) != len(samples.fallback.embedding) {
		anchor = samples.fallback.embedding
	}
	centroid := normalizedCentroid(samples.sum)
	anchorScores := make([]float64, 0, len(samples.members))
	centroidScores := make([]float64, 0, len(samples.members))
	detectionScores := make([]float64, 0, len(samples.members))
	for _, face := range samples.members {
		anchorScores = append(anchorScores, peopleCosine(face.embedding, anchor))
		centroidScores = append(centroidScores, peopleCosine(face.embedding, centroid))
		detectionScores = append(detectionScores, float64(face.Score))
	}
	return &PersonGroupQuality{
		AnchorP10:    peopleP10(anchorScores),
		CentroidP10:  peopleP10(centroidScores),
		DetectionP10: peopleP10(detectionScores),
	}
}

func peopleP10(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sort.Float64s(values)
	index := int(math.Floor(float64(len(values)-1) * 0.1))
	return math.Round(values[index]*1000) / 1000
}

func peopleGroupReviewRanksBefore(left, right PersonGroup) bool {
	leftQuality, rightQuality := left.Quality, right.Quality
	if leftQuality != nil && rightQuality != nil {
		if leftQuality.AnchorP10 != rightQuality.AnchorP10 {
			return leftQuality.AnchorP10 < rightQuality.AnchorP10
		}
		if leftQuality.CentroidP10 != rightQuality.CentroidP10 {
			return leftQuality.CentroidP10 < rightQuality.CentroidP10
		}
		if leftQuality.DetectionP10 != rightQuality.DetectionP10 {
			return leftQuality.DetectionP10 < rightQuality.DetectionP10
		}
	}
	if left.PhotoCount != right.PhotoCount {
		return left.PhotoCount > right.PhotoCount
	}
	return left.ID < right.ID
}
