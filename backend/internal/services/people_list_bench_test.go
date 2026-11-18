package services

import (
	"fmt"
	"math/rand"
	"path/filepath"
	"testing"
)

// BenchmarkPeopleList 记录人物列表这条路径的成本。
//
// 列表一次要做两件事：算每个分组的照片统计，按照片数排出前五十个。
// 两者都要扫全量人脸，而且要在任务状态锁之外做 —— 锁内做的话，
// 一次列表请求会把正在跑的分析任务一起堵住。
func BenchmarkPeopleList(b *testing.B) {
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
		clusterCount = 400
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

	b.Run("GroupPhotoStats", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			stats := service.GroupPhotoStats(nil, 8)
			if len(stats) == 0 {
				b.Fatal("expected people stats")
			}
		}
	})
	b.Run("TopGroups", func(b *testing.B) {
		b.ReportAllocs()
		for iteration := 0; iteration < b.N; iteration++ {
			groups, _ := service.TopGroups(0, false, nil)
			if len(groups) == 0 {
				b.Fatal("expected people groups")
			}
		}
	})
}
