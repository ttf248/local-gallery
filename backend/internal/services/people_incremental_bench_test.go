package services

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"
)

// BenchmarkPeopleApplyRecordsAppendOnly 记录人物增量快路径的成本。
//
// 增量快路径直接在现有分组上追加新脸，不重建。它是分析任务跑完一批后
// 最常走的一条路：每批 32 张照片，每张都可能是新的人。
//
// 这条路以前会白克隆四张全量映射表（人脸数 × 4）与一份人工纠错，
// 一个都用不上 —— 一万张脸就是几万条白扔的条目。
func BenchmarkPeopleApplyRecordsAppendOnly(b *testing.B) {
	root := b.TempDir()
	service, err := OpenPeopleService(
		filepath.Join(root, "state", "people.json"),
		filepath.Join(root, "derived", "people-index.json"),
	)
	if err != nil {
		b.Fatal(err)
	}
	if err := service.SetFaceAnalyzerVersion(FaceAnalyzerVersion); err != nil {
		b.Fatal(err)
	}

	const (
		clusterCount = 200
		facesPerID   = 5
	)
	rng := rand.New(rand.NewSource(20261118))
	records := make([]AIAnalysisRecord, 0, clusterCount)
	for clusterIndex := 0; clusterIndex < clusterCount; clusterIndex++ {
		center := peopleTestRandomVector(rng)
		vectors := make([][]float32, 0, facesPerID)
		for faceIndex := 0; faceIndex < facesPerID; faceIndex++ {
			vector := append([]float32(nil), center...)
			for component := range vector {
				vector[component] += float32(rng.NormFloat64() * 0.04)
			}
			vectors = append(vectors, peopleANNTestNormalize(vector))
		}
		records = append(records, peopleTestRecord(
			fmt.Sprintf("r-%04d", clusterIndex), vectors...,
		))
	}
	if err := service.Sync(records); err != nil {
		b.Fatal(err)
	}

	b.ReportAllocs()
	b.ResetTimer()
	for iteration := 0; iteration < b.N; iteration++ {
		vector := peopleANNTestNormalize(peopleTestRandomVector(rng))
		// 资源 ID 要排在已有资源之后：排在前面的新资源会触发确定性重建，
		// 那条路另有基准。
		record := peopleTestRecord(fmt.Sprintf("z-added-%06d", iteration), vector)
		if err := service.ApplyRecords([]AIAnalysisRecord{record}); err != nil {
			b.Fatal(err)
		}
	}
}
