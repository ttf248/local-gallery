package services

// 本文件管可重建的派生缓存：分析指纹、缓存键、缓存文件的读写与分组投影，
// 以及各分析模块的覆盖率统计。
//
// 缓存文件落在 derived/ai/smart-albums/，删了可以按当前分析结果重算。

import (
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
)

type smartAlbumCache struct {
	Version      int                                  `json:"version"`
	AlbumID      string                               `json:"albumId"`
	Dimension    string                               `json:"dimension"`
	FaceModel    string                               `json:"faceModel,omitempty"`
	Key          string                               `json:"key"`
	Fingerprints map[string]smartAlbumFileFingerprint `json:"fingerprints"`
	Groups       []smartAlbumCachedGroup              `json:"groups"`
}

type smartAlbumCachedGroup struct {
	ID                    string   `json:"id"`
	Dimension             string   `json:"dimension"`
	Name                  string   `json:"name"`
	SuggestedName         string   `json:"suggestedName"`
	PhotoCount            int      `json:"photoCount"`
	QualityScore          float64  `json:"qualityScore,omitempty"`
	EvidenceDimensions    []string `json:"evidenceDimensions,omitempty"`
	RecommendationReasons []string `json:"recommendationReasons,omitempty"`
	OverrideConflict      bool     `json:"overrideConflict,omitempty"`
	OverrideSources       []string `json:"overrideSources,omitempty"`
	CoverResourceID       string   `json:"coverResourceId,omitempty"`
	CoverVersion          string   `json:"coverVersion,omitempty"`
	Members               []string `json:"members"`
	sortKey               string
}

func (s *SmartAlbumService) analysisFingerprint(
	dimension string,
	albumName string,
	media []smartAlbumMedia,
	metadata map[string]AIAnalysisRecord,
	face map[string]AIAnalysisRecordSummary,
	people []PeopleAlbumGroup,
	metadataStatus, faceStatus, embeddingStatus AIJobModule,
) string {
	hash := sha256.New()
	write := func(value string) {
		_, _ = hash.Write([]byte(value))
		_, _ = hash.Write([]byte{0})
	}
	if dimension == SmartAlbumDimensionPeople || dimension == SmartAlbumDimensionRecommended {
		write(smartAlbumFaceModel(s.jobs, dimension))
	}
	switch dimension {
	case SmartAlbumDimensionTime, SmartAlbumDimensionPlace:
		write(metadataStatus.Version)
		ids := make([]string, 0, len(metadata))
		for id := range metadata {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			record := metadata[id]
			dataHash := sha256.Sum256(record.Data)
			write(fmt.Sprintf("%s:%s:%s", id, record.Status, hex.EncodeToString(dataHash[:])))
		}
	case SmartAlbumDimensionPeople:
		write(faceStatus.Version)
		ids := make([]string, 0, len(face))
		for id := range face {
			ids = append(ids, id)
		}
		sort.Strings(ids)
		for _, id := range ids {
			record := face[id]
			write(fmt.Sprintf("%s:%s:%d:%d:%s", id, record.Status, record.Size, record.MTimeNs, record.ModuleVersion))
		}
		for _, group := range people {
			write(group.Group.ID + ":" + group.Group.Name + ":" + group.Fingerprint)
		}
	case SmartAlbumDimensionScene:
		write(embeddingStatus.Version)
		if s.vectors != nil {
			vectorBytes := make([]byte, AIEmbeddingDimension*4)
			for _, item := range media {
				vector, ok := s.vectors.Vector(item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
				if !ok {
					continue
				}
				write(item.id)
				for index, value := range vector {
					binary.LittleEndian.PutUint32(vectorBytes[index*4:], math.Float32bits(value))
				}
				_, _ = hash.Write(vectorBytes)
			}
		}
	case SmartAlbumDimensionRecommended:
		write(albumName)
		write(metadataStatus.Version)
		write(faceStatus.Version)
		write(embeddingStatus.Version)
		for _, detailDimension := range smartAlbumDetailDimensions() {
			write(smartAlbumAlgorithmVersion(detailDimension))
		}
		metadataIDs := make([]string, 0, len(metadata))
		for id := range metadata {
			metadataIDs = append(metadataIDs, id)
		}
		sort.Strings(metadataIDs)
		for _, id := range metadataIDs {
			record := metadata[id]
			dataHash := sha256.Sum256(record.Data)
			write(fmt.Sprintf("%s:%s:%s", id, record.Status, hex.EncodeToString(dataHash[:])))
		}
		faceIDs := make([]string, 0, len(face))
		for id := range face {
			faceIDs = append(faceIDs, id)
		}
		sort.Strings(faceIDs)
		for _, id := range faceIDs {
			record := face[id]
			write(fmt.Sprintf("%s:%s:%d:%d:%s", id, record.Status, record.Size, record.MTimeNs, record.ModuleVersion))
		}
		for _, group := range people {
			write(group.Group.ID + ":" + group.Group.Name + ":" + group.Fingerprint)
		}
		if s.vectors != nil {
			vectorBytes := make([]byte, AIEmbeddingDimension*4)
			for _, item := range media {
				vector, ok := s.vectors.Vector(item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
				if !ok {
					continue
				}
				write(item.id)
				for index, value := range vector {
					binary.LittleEndian.PutUint32(vectorBytes[index*4:], math.Float32bits(value))
				}
				_, _ = hash.Write(vectorBytes)
			}
		}
	}
	if dimension == SmartAlbumDimensionPlace {
		write(chinaBoundaryVersion)
	}
	write(smartAlbumAlgorithmVersion(dimension))
	return hex.EncodeToString(hash.Sum(nil))
}

func smartAlbumCacheKey(albumID, dimension string, media []smartAlbumMedia, analysisFingerprint string) string {
	hash := sha256.New()
	_, _ = fmt.Fprintf(hash, "%s\x00%s\x00%s\x00", albumID, dimension, smartAlbumAlgorithmVersion(dimension))
	for _, item := range media {
		_, _ = fmt.Fprintf(hash, "%s\x00%d\x00%d\n", item.id, item.fingerprint.Size, item.fingerprint.MTimeNs)
	}
	_, _ = hash.Write([]byte(analysisFingerprint))
	return hex.EncodeToString(hash.Sum(nil))
}

func (s *SmartAlbumService) cachePath(albumID, dimension string) string {
	hash := sha256.Sum256([]byte(albumID + "\x00" + dimension))
	return filepath.Join(s.cacheDir, hex.EncodeToString(hash[:])+".json")
}

func readSmartAlbumCache(path, albumID, dimension, key string) (smartAlbumCache, bool) {
	cache, ok := readSmartAlbumCacheFile(path, albumID, dimension)
	if !ok || cache.Key != key {
		return smartAlbumCache{}, false
	}
	return cache, true
}

// readSmartAlbumCacheFile 读一本相册某个维度的分组缓存。
//
// 只看缓存自身的身份（版本、相册、维度），不比对媒体指纹：目录要的是
// 「已经生成了哪些分组」，指纹变了也照旧列出来，等刷新任务更新。
func readSmartAlbumCacheFile(path, albumID, dimension string) (smartAlbumCache, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return smartAlbumCache{}, false
	}
	var cache smartAlbumCache
	if json.Unmarshal(data, &cache) != nil || cache.Version < 1 || cache.Version > smartAlbumCacheVersion ||
		cache.AlbumID != albumID || cache.Dimension != dimension || cache.Groups == nil {
		return smartAlbumCache{}, false
	}
	return cache, true
}

// readCachedGroups 读一本相册某个维度已生成的分组；没有缓存就是没有。
func (s *SmartAlbumService) readCachedGroups(albumID, dimension string) (smartAlbumCache, bool) {
	cache, ok := readSmartAlbumCacheFile(s.cachePath(albumID, dimension), albumID, dimension)
	if !ok || (dimension != SmartAlbumDimensionPeople && dimension != SmartAlbumDimensionRecommended) {
		return cache, ok
	}
	model := cache.FaceModel
	if model == "" {
		model = DefaultFaceModel
	}
	return cache, model == smartAlbumFaceModel(s.jobs, dimension)
}

func smartAlbumFaceModel(jobs *AIJobService, dimension string) string {
	// 只有这两个维度会根据人脸结果计算成员或推荐内容。
	if dimension != SmartAlbumDimensionPeople && dimension != SmartAlbumDimensionRecommended {
		return ""
	}
	if jobs == nil {
		return DefaultFaceModel
	}
	return jobs.FaceModel()
}

func cacheSmartAlbumGroups(groups []SmartAlbumGroup) []smartAlbumCachedGroup {
	result := make([]smartAlbumCachedGroup, len(groups))
	for index, group := range groups {
		result[index] = smartAlbumCachedGroup{
			ID: group.ID, Dimension: group.Dimension, Name: group.SuggestedName,
			SuggestedName: group.SuggestedName, PhotoCount: group.PhotoCount,
			QualityScore: group.QualityScore, EvidenceDimensions: append([]string(nil), group.EvidenceDimensions...),
			RecommendationReasons: append([]string(nil), group.RecommendationReasons...),
			OverrideConflict:      group.OverrideConflict, OverrideSources: append([]string(nil), group.overrideSources...),
			CoverResourceID: group.CoverResourceID, CoverVersion: group.CoverVersion,
			Members: append([]string(nil), group.Members...), sortKey: group.sortKey,
		}
	}
	return result
}

func smartAlbumGroups(groups []smartAlbumCachedGroup) []SmartAlbumGroup {
	result := make([]SmartAlbumGroup, len(groups))
	for index, group := range groups {
		result[index] = SmartAlbumGroup{
			ID: group.ID, Dimension: group.Dimension, Name: group.Name,
			SuggestedName: group.SuggestedName, PhotoCount: group.PhotoCount,
			QualityScore: group.QualityScore, EvidenceDimensions: append([]string(nil), group.EvidenceDimensions...),
			RecommendationReasons: append([]string(nil), group.RecommendationReasons...),
			OverrideConflict:      group.OverrideConflict, overrideSources: append([]string(nil), group.OverrideSources...),
			CoverResourceID: group.CoverResourceID, CoverVersion: group.CoverVersion,
			Members: append([]string(nil), group.Members...), sortKey: group.sortKey,
		}
	}
	return result
}

func smartAlbumAlgorithmVersion(dimension string) string {
	switch dimension {
	case SmartAlbumDimensionRecommended:
		return smartAlbumRecommendedVersion
	case SmartAlbumDimensionTime:
		return smartAlbumTimeVersion
	case SmartAlbumDimensionPlace:
		return smartAlbumPlaceVersion
	case SmartAlbumDimensionPeople:
		return smartAlbumPeopleVersion + "-" + strconv.Itoa(peopleGroupingVersion)
	case SmartAlbumDimensionScene:
		return smartAlbumSceneVersion
	default:
		return ""
	}
}

// smartAlbumRecordFreshness 是判断一条分析结果是否仍然有效需要的两个字段。
type smartAlbumRecordFreshness struct {
	size    int64
	mtimeNs int64
}

// currentAnalysis 挑出文件指纹仍然匹配的分析结果。
//
// 文件被换过之后旧结果就不该再算：这里按大小与纳秒修改时间比对。
// 完整记录与摘要的区别只是「怎么取这两个字段」，判据只有这一份。
func currentAnalysis[V any](
	records map[string]V,
	fingerprints map[string]smartAlbumFileFingerprint,
	freshness func(V) smartAlbumRecordFreshness,
) map[string]V {
	result := make(map[string]V, len(records))
	for id, record := range records {
		fingerprint, exists := fingerprints[id]
		if !exists {
			continue
		}
		current := freshness(record)
		if current.size == fingerprint.Size && current.mtimeNs == fingerprint.MTimeNs {
			result[id] = record
		}
	}
	return result
}

func currentAnalysisRecords(records map[string]AIAnalysisRecord, fingerprints map[string]smartAlbumFileFingerprint) map[string]AIAnalysisRecord {
	return currentAnalysis(records, fingerprints, func(record AIAnalysisRecord) smartAlbumRecordFreshness {
		return smartAlbumRecordFreshness{size: record.Size, mtimeNs: record.MTimeNs}
	})
}

func currentAnalysisSummaries(records map[string]AIAnalysisRecordSummary, fingerprints map[string]smartAlbumFileFingerprint) map[string]AIAnalysisRecordSummary {
	return currentAnalysis(records, fingerprints, func(record AIAnalysisRecordSummary) smartAlbumRecordFreshness {
		return smartAlbumRecordFreshness{size: record.Size, mtimeNs: record.MTimeNs}
	})
}

func currentFingerprints(records map[string]AIAnalysisRecordSummary, fingerprints map[string]smartAlbumFileFingerprint) map[string]smartAlbumFileFingerprint {
	result := make(map[string]smartAlbumFileFingerprint, len(records))
	for id := range records {
		if fingerprint, exists := fingerprints[id]; exists {
			result[id] = fingerprint
		}
	}
	return result
}

// coverageFromRecords 按一组分析结果统计覆盖率。
//
// 完整记录与摘要的区别只是「怎么取状态」，缺失数的算法是同一套。
func coverageFromRecords[V any](
	total, available int,
	module AIJobModule,
	records map[string]V,
	status func(V) string,
) SmartAlbumCoverage {
	coverage := SmartAlbumCoverage{Module: module.Type, Total: total, Available: module.Installed, Reason: module.Reason}
	for _, record := range records {
		if status(record) == "failed" {
			coverage.Failed++
		} else {
			coverage.Analyzed++
		}
	}
	applySmartAlbumCoverageMissing(&coverage, total, available)
	return coverage
}

// applySmartAlbumCoverageMissing 补上缺失数。
//
// 有结果但没覆盖到的资源算缺失；模块整体可用数少于总数时，
// 缺失数至少要等于这个差额 —— 否则界面会说「全都分析了」而实际没有。
func applySmartAlbumCoverageMissing(coverage *SmartAlbumCoverage, total, available int) {
	coverage.Missing = max(0, total-coverage.Analyzed-coverage.Failed)
	if available < total && coverage.Missing < total-available {
		coverage.Missing = total - available
	}
}

func coverageForRecords(total, available int, records map[string]AIAnalysisRecord, module AIJobModule) SmartAlbumCoverage {
	return coverageFromRecords(total, available, module, records, func(record AIAnalysisRecord) string {
		return record.Status
	})
}

func coverageForSummaries(total, available int, records map[string]AIAnalysisRecordSummary, module AIJobModule) SmartAlbumCoverage {
	return coverageFromRecords(total, available, module, records, func(record AIAnalysisRecordSummary) string {
		return record.Status
	})
}

func coverageForVectors(
	total, available int,
	vectors *VectorIndexStore,
	fingerprints map[string]smartAlbumFileFingerprint,
	records map[string]AIAnalysisRecordSummary,
	module AIJobModule,
) SmartAlbumCoverage {
	coverage := SmartAlbumCoverage{Module: module.Type, Total: total, Available: module.Installed, Reason: module.Reason}
	for id, fingerprint := range fingerprints {
		if vectors != nil && vectors.Current(id, fingerprint.Size, fingerprint.MTimeNs) {
			coverage.Analyzed++
			continue
		}
		if record, exists := records[id]; exists && record.Status == "failed" {
			coverage.Failed++
		}
	}
	applySmartAlbumCoverageMissing(&coverage, total, available)
	coverage.WithEvidence = coverage.Analyzed
	return coverage
}

func coverageForRecommendations(total, available int, groups []smartAlbumCachedGroup) SmartAlbumCoverage {
	members := make(map[string]struct{})
	for _, group := range groups {
		for _, id := range group.Members {
			members[id] = struct{}{}
		}
	}
	return SmartAlbumCoverage{
		Module: "combined", Total: total, Analyzed: available,
		Missing: max(0, total-available), WithEvidence: len(members),
		Available: available > 0,
	}
}

func peopleEvidencePhotoCount(groups []PeopleAlbumGroup) int {
	resourceIDs := make(map[string]struct{})
	for _, group := range groups {
		for _, resourceID := range group.ResourceIDs {
			resourceIDs[resourceID] = struct{}{}
		}
	}
	return len(resourceIDs)
}

func metadataEvidenceCount(records map[string]AIAnalysisRecord, dimension string) int {
	count := 0
	for _, record := range records {
		if record.Status != MetadataParseParsed || len(record.Data) == 0 {
			continue
		}
		var metadata ImageMetadata
		if json.Unmarshal(record.Data, &metadata) != nil {
			continue
		}
		if dimension == SmartAlbumDimensionTime {
			if _, ok := parseSmartCaptureTime(metadata.DateTimeOriginal); ok {
				count++
			}
		} else if metadata.GPS != nil && validCoordinates(metadata.GPS.Latitude, metadata.GPS.Longitude) {
			count++
		}
	}
	return count
}
