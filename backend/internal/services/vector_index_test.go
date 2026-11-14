package services

import (
	"context"
	"math"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestVectorIndexPersistsFloat16VectorsAndRanksCosine(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "derived", "ai", "vectors")
	index, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	vectorA := make([]float32, AIEmbeddingDimension)
	vectorB := make([]float32, AIEmbeddingDimension)
	vectorA[0], vectorB[1] = 1, 1
	if err := index.Commit(context.Background(), []VectorInput{
		{ResourceID: "file-a", Size: 10, MTimeNs: 100, Vector: vectorA},
		{ResourceID: "file-b", Size: 20, MTimeNs: 200, Vector: vectorB},
	}); err != nil {
		t.Fatal(err)
	}
	metadata := index.Metadata()
	if len(metadata) != 2 || metadata[0].ResourceID != "file-a" || metadata[0].Position != 0 || metadata[0].ShardID == "" {
		t.Fatalf("metadata = %+v", metadata)
	}
	query := append([]float32(nil), vectorA...)
	hits, total, err := index.Search(query, metadata, 0, 1)
	if err != nil || total != 2 || len(hits) != 1 || hits[0].ResourceID != "file-a" || hits[0].Score < 0.99 {
		t.Fatalf("Search() = (%+v, %d, %v)", hits, total, err)
	}
	loaded, ok := index.Vector("file-a", 10, 100)
	if !ok || len(loaded) != AIEmbeddingDimension || loaded[0] < 0.99 {
		t.Fatalf("Vector() = (%d dimensions, %v), want current vector", len(loaded), ok)
	}
	if _, ok := index.Vector("file-a", 11, 100); ok {
		t.Fatal("Vector() returned an embedding for a stale file fingerprint")
	}
	index.Close()

	reopened, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	if !reopened.Current("file-a", 10, 100) || reopened.Current("file-a", 11, 100) {
		t.Fatal("reopened index did not preserve current file fingerprints")
	}
	status := reopened.Status()
	if status.Vectors != 2 || status.Shards != 1 || status.Dimension != AIEmbeddingDimension {
		t.Fatalf("status = %+v", status)
	}
}

func TestVectorIndexPartialSearchKeepsStableTieOrderAcrossPages(t *testing.T) {
	resourceIDs := []string{"r-z", "r-a", "r-m", "r-b"}
	values := make([]uint16, len(resourceIDs)*AIEmbeddingDimension)
	metadata := make(map[string]VectorMetadata, len(resourceIDs))
	candidates := make([]VectorMetadata, 0, len(resourceIDs))
	for position, resourceID := range resourceIDs {
		values[position*AIEmbeddingDimension] = float32ToHalf(1)
		item := VectorMetadata{
			ResourceID: resourceID, Size: 1, MTimeNs: 1, ModelVersion: "clip-v1",
			ShardID: "all", Position: position,
		}
		metadata[resourceID] = item
		candidates = append(candidates, item)
	}
	index := &VectorIndexStore{
		modelVersion: "clip-v1",
		shards:       map[string]vectorShardData{"all": {values: values}},
		latest:       metadata,
	}
	query := make([]float32, AIEmbeddingDimension)
	query[0] = 1

	hits, total, err := index.Search(query, candidates, 1, 2)
	if err != nil || total != 4 || len(hits) != 2 {
		t.Fatalf("Search() = (%+v, %d, %v)", hits, total, err)
	}
	if hits[0].ResourceID != "r-b" || hits[1].ResourceID != "r-m" {
		t.Fatalf("paged tie order = [%s %s], want [r-b r-m]", hits[0].ResourceID, hits[1].ResourceID)
	}
	prioritized, total, err := index.SearchWithPriority(query, candidates, 1, 2, map[string]int{
		"r-b": 2, "r-m": 2, "r-a": 1, "r-z": 1,
	})
	if err != nil || total != 4 || len(prioritized) != 2 {
		t.Fatalf("SearchWithPriority() = (%+v, %d, %v)", prioritized, total, err)
	}
	if prioritized[0].ResourceID != "r-m" || prioritized[1].ResourceID != "r-a" {
		t.Fatalf("priority page = [%s %s], want [r-m r-a]", prioritized[0].ResourceID, prioritized[1].ResourceID)
	}
}

func TestVectorIndexPriorityTierSearchPreservesTotalAndPageOrder(t *testing.T) {
	entries := []struct {
		id         string
		similarity float32
		priority   int
	}{
		{id: "low-1", similarity: 1.0},
		{id: "low-2", similarity: 0.99},
		{id: "high-1", similarity: 0.8, priority: 2},
		{id: "low-3", similarity: 0.98},
		{id: "high-2", similarity: 0.7, priority: 2},
		{id: "low-4", similarity: 0.97},
	}
	values := make([]uint16, len(entries)*AIEmbeddingDimension)
	metadata := make(map[string]VectorMetadata, len(entries))
	candidates := make([]VectorMetadata, 0, len(entries))
	priorities := make(map[string]int, 2)
	for position, entry := range entries {
		start := position * AIEmbeddingDimension
		values[start] = float32ToHalf(entry.similarity)
		values[start+1] = float32ToHalf(float32(math.Sqrt(float64(1 - entry.similarity*entry.similarity))))
		item := VectorMetadata{
			ResourceID: entry.id, Size: 1, MTimeNs: 1, ModelVersion: "clip-v1",
			ShardID: "all", Position: position,
		}
		metadata[entry.id] = item
		candidates = append(candidates, item)
		if entry.priority > 0 {
			priorities[entry.id] = entry.priority
		}
	}
	index := &VectorIndexStore{
		modelVersion: "clip-v1",
		shards:       map[string]vectorShardData{"all": {values: values}},
		latest:       metadata,
	}
	query := make([]float32, AIEmbeddingDimension)
	query[0] = 1

	hits, total, err := index.SearchWithPriority(query, candidates, 0, 2, priorities)
	if err != nil || total != len(entries) || len(hits) != 2 {
		t.Fatalf("SearchWithPriority() = (%+v, %d, %v), want two hits from %d candidates", hits, total, err, len(entries))
	}
	if hits[0].ResourceID != "high-1" || hits[1].ResourceID != "high-2" {
		t.Fatalf("priority tier hits = [%s %s], want [high-1 high-2]", hits[0].ResourceID, hits[1].ResourceID)
	}

	page, pageTotal, err := index.SearchWithPriority(query, candidates, 1, 1, priorities)
	if err != nil || pageTotal != len(entries) || len(page) != 1 || page[0].ResourceID != "high-2" {
		t.Fatalf("second priority page = (%+v, %d, %v), want [high-2] of %d", page, pageTotal, err, len(entries))
	}
}

func TestVectorIndexInvalidatesWhenModelVersionChanges(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "vectors")
	index, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	vector := make([]float32, AIEmbeddingDimension)
	vector[3] = 1
	if err := index.Commit(context.Background(), []VectorInput{{ResourceID: "file-a", Vector: vector}}); err != nil {
		t.Fatal(err)
	}
	index.Close()

	upgraded, err := OpenVectorIndex(dir, "clip-v2")
	if err != nil {
		t.Fatal(err)
	}
	defer upgraded.Close()
	if status := upgraded.Status(); status.Vectors != 0 || status.ModelVersion != "clip-v2" {
		t.Fatalf("upgraded status = %+v", status)
	}
}

func TestVectorIndexChecksumFailureIsReported(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "vectors")
	index, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	vector := make([]float32, AIEmbeddingDimension)
	vector[0] = 1
	if err := index.Commit(context.Background(), []VectorInput{{ResourceID: "file-a", Vector: vector}}); err != nil {
		t.Fatal(err)
	}
	metadata := index.Metadata()[0]
	index.Close()
	path := filepath.Join(dir, "shards", metadata.ShardID, "vectors.f16")
	if err := os.WriteFile(path, []byte("broken"), 0o600); err != nil {
		t.Fatal(err)
	}
	if reopened, err := OpenVectorIndex(dir, "clip-v1"); err == nil {
		reopened.Close()
		t.Fatal("corrupt vector data was accepted")
	}
}

func TestVectorFloat16RoundTrip(t *testing.T) {
	for _, value := range []float32{0, 1, -1, 0.5, 0.00006103515625, 0.000000059604645} {
		actual := halfToFloat32(float32ToHalf(value))
		if delta := actual - value; delta > 0.00001 || delta < -0.00001 {
			t.Errorf("half roundtrip %g = %g", value, actual)
		}
	}
}

func TestVectorFloat16LookupMatchesDecoder(t *testing.T) {
	for value := range halfToFloat32Lookup {
		want := math.Float32bits(halfToFloat32(uint16(value)))
		got := math.Float32bits(halfToFloat32Lookup[value])
		if got != want {
			t.Fatalf("half decoder mismatch for %#x: got %#x, want %#x", value, got, want)
		}
	}
}

func TestVectorIndexCompactsPublishedShards(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "vectors")
	index, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	for item := 0; item < vectorCompactAtShards; item++ {
		vector := make([]float32, AIEmbeddingDimension)
		vector[item%AIEmbeddingDimension] = 1
		if err := index.Commit(context.Background(), []VectorInput{{ResourceID: "file-" + time.Unix(int64(item), 0).Format("150405"), Vector: vector}}); err != nil {
			t.Fatal(err)
		}
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) && index.Status().Shards >= vectorCompactAtShards {
		time.Sleep(10 * time.Millisecond)
	}
	if status := index.Status(); status.Shards == 0 || status.Shards >= vectorCompactAtShards || status.Vectors != vectorCompactAtShards {
		t.Fatalf("compaction status = %+v", status)
	}
	index.Close()
}

func TestVectorIndexCompactionThresholdCountsOnlyNewShards(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "vectors")
	index, err := OpenVectorIndex(dir, "clip-v1")
	if err != nil {
		t.Fatal(err)
	}
	defer index.Close()
	vector := make([]float32, AIEmbeddingDimension)
	vector[0] = 1
	commit := func(indexNumber int) {
		t.Helper()
		input := VectorInput{
			ResourceID: "file-" + time.Unix(int64(indexNumber), 0).Format("150405"),
			Vector:     vector,
		}
		if err := index.Commit(context.Background(), []VectorInput{input}); err != nil {
			t.Fatal(err)
		}
	}
	waitForShardCount := func(want int) {
		t.Helper()
		deadline := time.Now().Add(5 * time.Second)
		for time.Now().Before(deadline) {
			if index.Status().Shards == want {
				return
			}
			time.Sleep(10 * time.Millisecond)
		}
		t.Fatalf("shard count = %d, want %d", index.Status().Shards, want)
	}

	for item := 0; item < vectorCompactAtShards; item++ {
		commit(item)
	}
	waitForShardCount(1)
	for item := vectorCompactAtShards; item < vectorCompactAtShards*2-1; item++ {
		commit(item)
	}
	time.Sleep(100 * time.Millisecond)
	if status := index.Status(); status.Shards != vectorCompactAtShards {
		t.Fatalf("shards after 127 new appends = %d, want %d", status.Shards, vectorCompactAtShards)
	}
	commit(vectorCompactAtShards*2 - 1)
	waitForShardCount(1)
	if status := index.Status(); status.Vectors != vectorCompactAtShards*2 {
		t.Fatalf("compacted status = %+v", status)
	}
}
