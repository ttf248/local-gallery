package services

// 本文件管分析目标：把相册或资源集合变成带文件指纹的目标清单，
// 并用同一份判据回答「既有结果对这张文件是否仍然有效」。
//
// 任务开跑和空闲时的规模预估都走这里，两条路径共用一份判据，
// 预估出来的张数才与任务实际的 planned 对得上。

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

type aiJobTarget struct {
	resourceID  string
	path        string
	displayPath string
	position    int
	size        int64
	mtimeNs     int64
	statCode    string
}

// aiTargetFilter 描述分析目标集合的筛选口径。
//
// 目标集合只随口径变，不随模块变：metadata、embedding、ocr 看的都是
// 全部图片，人脸与相似照片只看照片侧。
//
// 按模块缓存会让同一份文件指纹在一次核算里被 stat 六遍 —— 大库上
// 这是一轮秒级开销，而六轮的结果完全一样。
type aiTargetFilter int

const (
	// aiTargetAllImages 包含图库里的全部图片。
	aiTargetAllImages aiTargetFilter = iota
	// aiTargetPhotoOnly 只包含照片侧的图片。
	aiTargetPhotoOnly
	aiTargetPhotoMedia
	aiTargetEstimateMedia
)

// aiTargetFilterForModule 返回模块对应的目标口径。
func aiTargetFilterForModule(moduleType string) aiTargetFilter {
	switch moduleType {
	case AIJobTypeAlbumCover:
		return aiTargetPhotoMedia
	case AIJobTypeFace, AIJobTypePortrait, AIJobTypeSimilarity:
		return aiTargetPhotoOnly
	default:
		return aiTargetAllImages
	}
}

// aiTargetCache 是一次文件指纹采集的结果，按媒体库 revision 归类。
type aiTargetCache struct {
	revision   uint64
	builtAt    time.Time
	stats      map[string]aiTargetStat
	photoCount int
	videoCount int
}

func (s *AIJobService) buildTargets(ctx context.Context, snapshot CatalogSnapshot, filter aiTargetFilter, albumIDs ...string) []aiJobTarget {
	ids := snapshot.FileIDs()
	if albumID, err := s.analysisAlbumID(albumIDs); err != nil {
		return nil
	} else if albumID != "" {
		var exists bool
		if filter == aiTargetPhotoMedia && snapshot.Ready() {
			items, found := snapshot.state.library.media[albumID]
			exists = found
			ids = make([]string, 0, len(items))
			for _, item := range items {
				ids = append(ids, item.ID)
			}
		} else {
			ids, exists = snapshot.AlbumImageIDs(albumID)
		}
		if !exists {
			return nil
		}
	}
	return s.buildTargetsForResources(ctx, snapshot, filter, ids)
}

// buildTargetsForResources 把资源集合转成分析目标。
//
// 资源集合可能来自相册、全库或一批具体资源；已经不在图库里的资源
// （文件刚被删掉）会被跳过。
func (s *AIJobService) buildTargetsForResources(
	ctx context.Context,
	snapshot CatalogSnapshot,
	filter aiTargetFilter,
	ids []string,
) []aiJobTarget {
	if len(ids) == 0 {
		return nil
	}
	targets := make([]aiJobTarget, 0, len(ids))
	for _, id := range ids {
		ref, ok := snapshot.Lookup(id)
		if !ok {
			continue
		}
		image := models.IsImageFile(ref.AbsolutePath)
		if filter == aiTargetPhotoMedia || (!image && filter == aiTargetEstimateMedia) {
			media, exists := snapshot.state.library.mediaByFile[id]
			if !exists || snapshot.state.library.nodes[media.albumID].ContentKind != "photo" {
				continue
			}
		} else if !image {
			continue
		}
		// 人脸与相似照片只处理照片侧：漫画是另一套工作区，
		// 既不参与人物分组，也不进相似照片整理。
		if filter == aiTargetPhotoOnly && !snapshot.IsPhotoImage(id) {
			continue
		}
		targets = append(targets, aiJobTarget{
			resourceID:  id,
			path:        ref.AbsolutePath,
			displayPath: snapshot.RelativeLabel(id),
			position:    len(targets),
		})
	}
	s.statTargets(ctx, targets)
	return targets
}

func (s *AIJobService) analysisAlbumID(albumIDs []string) (string, error) {
	if len(albumIDs) > 1 {
		return "", ErrAIJobInvalidAlbum
	}
	if len(albumIDs) == 0 {
		return "", nil
	}
	return strings.TrimSpace(albumIDs[0]), nil
}

func (s *AIJobService) validateAnalysisAlbum(albumID string) error {
	if albumID == "" {
		return ErrAIJobInvalidAlbum
	}
	snapshot := s.catalog.Acquire()
	if !snapshot.Ready() {
		return ErrAIJobInvalidAlbum
	}
	album, exists := snapshot.AlbumSummary(albumID)
	if !exists || album.ContentKind != string(models.ContentKindPhoto) {
		return ErrAIJobInvalidAlbum
	}
	if _, exists := snapshot.AlbumImageIDs(albumID); !exists {
		return ErrAIJobInvalidAlbum
	}
	return nil
}

// statTargets 并发补齐每个目标的路径校验、大小与纳秒修改时间。
//
// 逐张 stat 在大库上是秒级开销，而空闲时的规模预估与任务启动都要走这一步。
// 结果写进按下标分配的切片，顺序与资源 ID 排序保持一致 —— position 与
// 检查点都依赖这个顺序。
func (s *AIJobService) statTargets(ctx context.Context, targets []aiJobTarget) {
	if len(targets) == 0 {
		return
	}
	workers := min(aiStatWorkerCount, len(targets))
	var next atomic.Int64
	var wg sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for {
				index := int(next.Add(1)) - 1
				if index >= len(targets) {
					return
				}
				if ctx.Err() != nil {
					return
				}
				s.statTarget(&targets[index])
			}
		}()
	}
	wg.Wait()
}

// statTarget 校验单个目标的路径并记下当前的文件指纹。
func (s *AIJobService) statTarget(target *aiJobTarget) {
	validated, err := s.validatePath(target.path)
	if err != nil {
		target.statCode = "source_unavailable"
		return
	}
	info, err := os.Stat(validated)
	if err != nil || !info.Mode().IsRegular() {
		target.statCode = "source_unavailable"
		return
	}
	target.path = validated
	target.size = info.Size()
	target.mtimeNs = info.ModTime().UnixNano()
}

// aiRecordIsCurrent 判断既有结果对某个目标文件是否仍然有效。
//
// 增量任务跳过与否、空闲时的规模预估，用的是同一条判据 —— 只有一份实现，
// 预估出来的张数才与任务实际的 planned 对得上。
func aiRecordIsCurrent(record AIAnalysisRecord, exists bool, target aiJobTarget, version string, validator AIAnalyzerRecordValidator) bool {
	if !exists || record.Status == "failed" {
		return false
	}
	if record.Size != target.size || record.MTimeNs != target.mtimeNs {
		return false
	}
	if record.ModuleVersion != version {
		return false
	}
	if validator != nil {
		return validator.RecordCurrent(record)
	}
	return true
}

func (s *AIJobService) selectTargets(jobID string, targets []aiJobTarget, digest string) ([]aiJobTarget, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	job := s.jobs[jobID]
	if job == nil {
		return nil, ErrAIJobNotFound
	}
	if job.Type == AIJobTypeFace && job.FaceModel == "" {
		job.FaceModel = DefaultFaceModel
	}
	version := aiAnalyzerVersion(s.analyzers[job.Type], job.FaceModel)
	if job.ModuleVersion != version || job.Checkpoint.ModuleVersion != "" && job.Checkpoint.ModuleVersion != version {
		job.ModuleVersion = version
		job.Checkpoint = AIJobCheckpoint{ModuleVersion: version}
		job.RecoveredAfterRestart = false
		job.Total, job.Processed, job.Skipped, job.Failed, job.Done = 0, 0, 0, 0, 0
		job.Errors = nil
		job.Results, job.Fields = nil, nil
	}
	job.ModuleVersion = version
	job.Checkpoint.ModuleVersion = version

	candidates := make([]aiJobTarget, 0, len(targets))
	if job.Mode == AIJobModeFull && !job.RetryFailedOnly {
		if job.Total > 0 && job.Checkpoint.TargetDigest == digest {
			for _, target := range targets {
				if target.position >= job.Checkpoint.Offset {
					candidates = append(candidates, target)
				}
			}
		} else {
			job.Total = len(targets)
			job.Processed, job.Skipped, job.Failed, job.Done = 0, 0, 0, 0
			job.Checkpoint = AIJobCheckpoint{ModuleVersion: version, TargetDigest: digest}
			job.Errors = nil
			job.Results, job.Fields = nil, nil
			candidates = append(candidates, targets...)
		}
	} else {
		if job.Total == 0 {
			job.Total = len(targets)
		}
		validator, _ := s.analyzers[job.Type].(AIAnalyzerRecordValidator)
		for _, target := range targets {
			record, exists := s.records[aiRecordKeyForVersion(job.Type, version, target.resourceID)]
			current := aiRecordIsCurrent(record, exists, target, version, validator)
			if job.RetryFailedOnly {
				if (exists && record.Status == "failed") || (target.position >= job.RetryFromOffset && !current) {
					candidates = append(candidates, target)
				}
				continue
			}
			if current {
				continue
			}
			candidates = append(candidates, target)
		}
		if job.Done == 0 {
			job.Skipped = len(targets) - len(candidates)
			job.Done = job.Skipped
		}
	}
	job.Stage = job.Type
	job.UpdatedAt = s.now()
	if err := s.persistLocked(); err != nil {
		return nil, err
	}
	s.publishLocked(*job)
	return candidates, nil
}

func digestAITargets(targets []aiJobTarget, albumIDs ...string) string {
	hashValue := sha256.New()
	if len(albumIDs) > 0 && albumIDs[0] != "" {
		_, _ = hashValue.Write([]byte(albumIDs[0]))
		_, _ = hashValue.Write([]byte{0})
	}
	for _, target := range targets {
		_, _ = fmt.Fprintf(hashValue, "%s\x00%d\x00%d\x00%s\n", target.resourceID, target.size, target.mtimeNs, target.statCode)
	}
	return hex.EncodeToString(hashValue.Sum(nil))
}
