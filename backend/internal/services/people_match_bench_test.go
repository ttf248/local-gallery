package services

import (
	"fmt"
	"math/rand"
	"testing"
)

// BenchmarkPeopleMatchSuggestions measures the cost of one full match review
// page over a synthetic library. It guards the query time of the review page
// when the pending band widens from singletons to repeated groups.
func BenchmarkPeopleMatchSuggestions(b *testing.B) {
	const (
		groupCount   = 2000
		facesPerFace = 5
	)
	rng := rand.New(rand.NewSource(20261118))
	people := newPeopleMatchTestService(b)
	for groupIndex := 0; groupIndex < groupCount; groupIndex++ {
		center := peopleTestRandomVector(rng)
		faces := make([]PersonFace, 0, facesPerFace)
		for faceIndex := 0; faceIndex < facesPerFace; faceIndex++ {
			vector := append([]float32(nil), center...)
			for component := range vector {
				vector[component] += float32(rng.NormFloat64() * 0.04)
			}
			vector = peopleANNTestNormalize(vector)
			resourceID := fmt.Sprintf("g-%04d-%02d", groupIndex, faceIndex)
			faces = append(faces, PersonFace{
				Key: PersonFaceKey(resourceID, 0), ResourceID: resourceID,
				Box: []float32{10, 12, 40, 42}, Score: 0.9, embedding: vector,
			})
		}
		peopleInstallMatchGroup(b, people, stablePersonID(faces[0].Key), faces)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		page := people.MatchSuggestions(0, 20, false, nil)
		b.ReportMetric(float64(page.TotalSources), "sources")
	}
}

// BenchmarkPeopleMatchSuggestionsWithDuplicates measures the review page when
// every group has a plausible duplicate. It is the worst case for candidate
// generation because each source rescores several targets.
func BenchmarkPeopleMatchSuggestionsWithDuplicates(b *testing.B) {
	const (
		pairCount    = 500
		facesPerFace = 5
	)
	rng := rand.New(rand.NewSource(20261119))
	people := newPeopleMatchTestService(b)
	for pairIndex := 0; pairIndex < pairCount; pairIndex++ {
		center := peopleTestRandomVector(rng)
		for side := 0; side < 2; side++ {
			faces := make([]PersonFace, 0, facesPerFace)
			for faceIndex := 0; faceIndex < facesPerFace; faceIndex++ {
				vector := append([]float32(nil), center...)
				for component := range vector {
					vector[component] += float32(rng.NormFloat64() * 0.04)
				}
				vector = peopleANNTestNormalize(vector)
				resourceID := fmt.Sprintf("p-%04d-%d-%02d", pairIndex, side, faceIndex)
				faces = append(faces, PersonFace{
					Key: PersonFaceKey(resourceID, 0), ResourceID: resourceID,
					Box: []float32{10, 12, 40, 42}, Score: 0.9, embedding: vector,
				})
			}
			peopleInstallMatchGroup(b, people, stablePersonID(faces[0].Key), faces)
		}
	}

	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		page := people.MatchSuggestions(0, 20, false, nil)
		b.ReportMetric(float64(page.TotalSources), "sources")
	}
}

// BenchmarkPeopleANNSearch measures one centroid lookup in a 2000 node index.
func BenchmarkPeopleANNSearch(b *testing.B) {
	rng := rand.New(rand.NewSource(20261118))
	index := newPeopleANNIndex()
	queries := make([][]float32, 0, 64)
	for groupIndex := 0; groupIndex < 2000; groupIndex++ {
		vector := peopleTestRandomVector(rng)
		index.Add(fmt.Sprintf("g-%04d", groupIndex), vector)
		if groupIndex < 64 {
			queries = append(queries, vector)
		}
	}
	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		for _, query := range queries {
			index.Search(query, peopleMatchANNTopK)
		}
	}
}
