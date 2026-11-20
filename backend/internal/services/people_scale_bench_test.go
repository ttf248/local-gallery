package services

import (
	"fmt"
	"math"
	"math/rand"
	"path/filepath"
	"testing"
)

// BenchmarkPeopleANNBuild 量的是人脸 ANN 索引的构建成本。
//
// 人物分组要在内存里建一张 HNSW：每个分组一个节点，节点向量是分组中心。
// 大库上分组有上万个，构建成本会直接决定「人物索引更新一次要多久」。
func BenchmarkPeopleANNBuild(b *testing.B) {
	for _, dimension := range []int{peopleEmbeddingDimension, peopleBuffaloMDimension} {
		name := "quality-v2"
		if dimension == peopleBuffaloMDimension {
			name = "buffalo_m"
		}
		b.Run(name, func(b *testing.B) {
			rng := rand.New(rand.NewSource(20261120))
			vectors := make([][]float32, 0, 12000)
			for index := 0; index < 12000; index++ {
				vectors = append(vectors, peopleBENCHRandomVector(rng, dimension))
			}
			b.ReportAllocs()
			b.ResetTimer()
			for iteration := 0; iteration < b.N; iteration++ {
				index := newPeopleANNIndexForDimension(dimension)
				for position, vector := range vectors {
					index.Add(fmt.Sprintf("p_%05d", position), vector)
				}
			}
		})
	}
}

// BenchmarkPeopleApplyRecordsAtScale 量的是「一批新脸进来」要付多少代价。
//
// 大库上每个分析批次都会提交一次记录，人物索引必须跟着更新：
// 增量快路径只追加新脸，但收尾仍要重建分组索引与 ANN 索引。
func BenchmarkPeopleApplyRecordsAtScale(b *testing.B) {
	root := b.TempDir()
	service, err := OpenPeopleService(
		filepath.Join(root, "state", "people.json"),
		filepath.Join(root, "derived", "people-index.json"),
	)
	if err != nil {
		b.Fatal(err)
	}
	if err := service.SetFaceAnalyzerVersion(FaceAnalyzerBuffaloMVersion); err != nil {
		b.Fatal(err)
	}
	rng := rand.New(rand.NewSource(20261120))
	const faceCount = 12000
	records := make([]AIAnalysisRecord, 0, faceCount)
	for index := 0; index < faceCount; index++ {
		vector := peopleBENCHRandomVector(rng, peopleBuffaloMDimension)
		records = append(records, peopleBENCHRecord(fmt.Sprintf("r-%05d", index), vector))
	}
	b.Run("Build", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			if err := service.Sync(records); err != nil {
				b.Fatal(err)
			}
		}
	})
	// 增量快路径：新脸排在已有脸之后，只追加，不重建全库。
	b.Run("AppendOne", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			vector := peopleBENCHRandomVector(rng, peopleBuffaloMDimension)
			record := peopleBENCHRecord(fmt.Sprintf("z-new-%05d", iteration), vector)
			if err := service.ApplyRecords([]AIAnalysisRecord{record}); err != nil {
				b.Fatal(err)
			}
		}
	})
	// 重建路径：新脸排在已有脸之前，整库重新聚类。
	b.Run("InsertOne", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			vector := peopleBENCHRandomVector(rng, peopleBuffaloMDimension)
			record := peopleBENCHRecord(fmt.Sprintf("a-new-%05d", iteration), vector)
			if err := service.ApplyRecords([]AIAnalysisRecord{record}); err != nil {
				b.Fatal(err)
			}
		}
	})
}

// peopleBENCHRandomVector 生成一个归一化的随机向量。
func peopleBENCHRandomVector(rng *rand.Rand, dimension int) []float32 {
	vector := make([]float32, dimension)
	norm := 0.0
	for index := range vector {
		value := float32(rng.NormFloat64())
		vector[index] = value
		norm += float64(value) * float64(value)
	}
	length := float32(math.Sqrt(norm))
	for index := range vector {
		vector[index] /= length
	}
	return vector
}

// peopleBENCHRecord 造一条带单张人脸的分析记录。
func peopleBENCHRecord(resourceID string, vector []float32) AIAnalysisRecord {
	record := peopleTestRecord(resourceID, vector)
	record.ModuleVersion = FaceAnalyzerBuffaloMVersion
	return record
}
