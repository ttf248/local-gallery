package services

import (
	"math"
	"math/rand"
	"runtime"
	"strconv"
	"testing"
)

func TestPeopleANNIndexFindsExactNearestAmongLargeCandidateSet(t *testing.T) {
	const (
		vectorCount = 2500
		queryCount  = 100
	)
	rng := rand.New(rand.NewSource(20261114))
	vectors := make([][]float32, vectorCount)
	index := newPeopleANNIndex()
	for i := range vectors {
		vectors[i] = peopleTestRandomVector(rng)
		index.Add(peopleANNTestID(i), vectors[i])
	}

	var hits int
	for queryIndex := 0; queryIndex < queryCount; queryIndex++ {
		seedIndex := rng.Intn(len(vectors))
		query := append([]float32(nil), vectors[seedIndex]...)
		for i := range query {
			query[i] += float32(rng.NormFloat64() * 0.04)
		}
		query = peopleANNTestNormalize(query)

		bestIndex := 0
		bestScore := float32(-2)
		for i, vector := range vectors {
			score := peopleANNDot(query, vector)
			if score > bestScore {
				bestIndex, bestScore = i, score
			}
		}
		for _, hit := range index.Search(query, peopleANNCandidateLimit) {
			if hit.id == peopleANNTestID(bestIndex) {
				hits++
				break
			}
		}
	}
	if hits != queryCount {
		t.Fatalf("nearest-centroid candidate recall = %d/%d, want all exact nearest centroids", hits, queryCount)
	}
}

func TestPeopleANNIndexIsDeterministicAndReadsUpdatedCentroids(t *testing.T) {
	rng := rand.New(rand.NewSource(42))
	vectors := make([][]float32, 500)
	left := newPeopleANNIndex()
	right := newPeopleANNIndex()
	for i := range vectors {
		vectors[i] = peopleTestRandomVector(rng)
		id := peopleANNTestID(i)
		left.Add(id, vectors[i])
		right.Add(id, vectors[i])
	}
	query := peopleTestRandomVector(rng)
	leftHits := left.Search(query, peopleANNCandidateLimit)
	rightHits := right.Search(query, peopleANNCandidateLimit)
	if len(leftHits) != len(rightHits) {
		t.Fatalf("deterministic search result counts differ: %d and %d", len(leftHits), len(rightHits))
	}
	for i := range leftHits {
		if leftHits[i] != rightHits[i] {
			t.Fatalf("deterministic search differs at %d: %+v != %+v", i, leftHits[i], rightHits[i])
		}
	}

	centroid := make([]float32, peopleEmbeddingDimension)
	centroid[0] = 1
	index := newPeopleANNIndex()
	index.Add("mutable", centroid)
	centroid[0] = 0
	centroid[1] = 1
	updatedHits := index.Search(peopleTestVector(1, 0), 1)
	if len(updatedHits) != 1 || updatedHits[0].id != "mutable" || updatedHits[0].score < 0.99 {
		t.Fatalf("updated centroid search = %+v, want the mutated vector", updatedHits)
	}
}

func BenchmarkPeopleGroupingAppend5000(b *testing.B) {
	const (
		clusterCount = 1000
		facesPerID   = 5
	)
	rng := rand.New(rand.NewSource(20261115))
	faces := make([]PersonFace, clusterCount*facesPerID)
	for clusterIndex := 0; clusterIndex < clusterCount; clusterIndex++ {
		center := peopleTestRandomVector(rng)
		for faceIndex := 0; faceIndex < facesPerID; faceIndex++ {
			vector := append([]float32(nil), center...)
			for component := range vector {
				vector[component] += float32(rng.NormFloat64() * 0.04)
			}
			vector = peopleANNTestNormalize(vector)
			position := clusterIndex*facesPerID + faceIndex
			resourceID := "r-" + strconv.Itoa(position)
			faces[position] = PersonFace{
				Key: PersonFaceKey(resourceID, 0), ResourceID: resourceID, embedding: vector,
			}
		}
	}

	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		service := &PeopleService{
			faces:    make(map[string]PersonFace, len(faces)),
			clusters: make(map[string]*peopleCluster),
			ann:      newPeopleANNIndex(),
		}
		for _, face := range faces {
			service.addFaceLocked(face)
		}
		b.ReportMetric(float64(len(service.clusters)), "groups/op")
		runtime.KeepAlive(service)
	}
}

func peopleANNTestID(index int) string {
	return strconv.Itoa(index)
}

func peopleANNTestNormalize(vector []float32) []float32 {
	var norm float64
	for _, value := range vector {
		norm += float64(value * value)
	}
	length := float32(math.Sqrt(norm))
	for i := range vector {
		vector[i] /= length
	}
	return vector
}
