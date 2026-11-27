package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math/bits"
	"os"
	"path/filepath"
	"sort"
	"strconv"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

const AIJobTypeAlbumCover = "albumCover"
const coverVersion = "aesthetic-v2.5-quality-v1"

type AlbumCoverAnalyzer struct {
	worker *localAIWorker
	video  *VideoCoverExtractor
}

func NewAlbumCoverAnalyzer(worker *localAIWorker, video *VideoCoverExtractor) *AlbumCoverAnalyzer {
	return &AlbumCoverAnalyzer{worker, video}
}
func (*AlbumCoverAnalyzer) Type() string    { return AIJobTypeAlbumCover }
func (*AlbumCoverAnalyzer) Version() string { return coverVersion }
func (a *AlbumCoverAnalyzer) Available() (bool, string) {
	s := a.worker.ModuleStatus(a.Type())
	return s.Ready, s.Error
}
func (a *AlbumCoverAnalyzer) Ready(ctx context.Context) error {
	s, err := a.worker.Status(ctx)
	if err != nil {
		return err
	}
	if !s.Modules[a.Type()].Ready {
		return ErrAIAnalyzerUnavailable
	}
	return nil
}
func (a *AlbumCoverAnalyzer) ValidateHardware(ctx context.Context, device string) error {
	return validateImageGPU(ctx, a.worker, device)
}
func (*AlbumCoverAnalyzer) Analyze(context.Context, io.ReadSeeker) (AIAnalysisOutput, error) {
	return AIAnalysisOutput{}, errors.New("cover scoring requires validated inputs")
}

type coverEvidence struct {
	Aesthetic float64           `json:"aesthetic"`
	Feature   SimilarityFeature `json:"feature"`
	Hash      string            `json:"hash"`
}

func (a *AlbumCoverAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	outputs := make([]AIAnalysisOutput, len(inputs))
	var paths []string
	var indices []int
	for i, in := range inputs {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		path := in.AnalysisPath
		if path == "" {
			path = in.Path
		}
		if models.IsVideoFile(in.Path) {
			frame, err := a.video.extractContext(ctx, in.Path)
			if err != nil {
				outputs[i] = AIAnalysisOutput{Status: "failed", ErrorCode: "video_cover_failed", ErrorMessage: "无法提取视频封面"}
				continue
			}
			f, err := os.CreateTemp("", "gallery-cover-*.jpg")
			if err != nil {
				return nil, err
			}
			defer os.Remove(f.Name())
			_, err = f.Write(frame)
			closeErr := f.Close()
			if err != nil {
				return nil, err
			}
			if closeErr != nil {
				return nil, closeErr
			}
			path = f.Name()
		}
		paths = append(paths, path)
		indices = append(indices, i)
	}
	if len(paths) == 0 {
		return outputs, ctx.Err()
	}
	results, err := a.worker.analyzeImages(ctx, "score_covers", paths, inputs[0].ComputeDevice)
	if err != nil {
		return nil, err
	}
	if len(results) != len(paths) {
		return nil, errors.New("incomplete cover scores")
	}
	for j, r := range results {
		i := indices[j]
		var e coverEvidence
		if r.Error != "" || json.Unmarshal(r.Data, &e) != nil || len(e.Hash) != 16 || e.Feature.Width <= 0 {
			code := r.Error
			if code == "" {
				code = "image_analysis_failed"
			}
			outputs[i] = AIAnalysisOutput{Status: "failed", ErrorCode: code, ErrorMessage: "封面评分失败"}
			continue
		}
		outputs[i] = AIAnalysisOutput{Status: "scored", Data: r.Data}
	}
	return outputs, nil
}

type CoverCandidate struct {
	ID      string `json:"id"`
	Kind    string `json:"kind"`
	Version string `json:"version"`
}
type albumCoverScore struct {
	version string
	score   float64
	hash    uint64
}

func (c *ResourceCatalog) SetCoverScores(records []AIAnalysisRecord) {
	scores := make(map[string]albumCoverScore, len(records))
	for _, r := range records {
		var e coverEvidence
		if r.Type != AIJobTypeAlbumCover || r.ModuleVersion != coverVersion || r.Status != "scored" || json.Unmarshal(r.Data, &e) != nil {
			continue
		}
		hash, err := strconv.ParseUint(e.Hash, 16, 64)
		if err != nil {
			continue
		}
		scores[r.ResourceID] = albumCoverScore{fmt.Sprintf("%d-%d-r%d", r.MTimeNs, r.Size, renditionAlgoVersion), .6*e.Aesthetic + .4*similarityQualityScore(e.Feature).Score, hash}
	}
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	if len(c.coverScores) == 0 && len(scores) == 0 {
		return
	}
	c.coverScores = scores
	c.republishLocked()
}

func buildCuratedCovers(s *resourceCatalogState, scores map[string]albumCoverScore) map[string][]CoverCandidate {
	pools := map[string][]CoverCandidate{}
	for id, album := range s.albums {
		if album.ContentKind != "photo" {
			continue
		}
		var ranked []CoverCandidate
		add := func(path, kind string, manual bool) {
			fid := externalID(s, path, ResourceFile)
			score, ok := scores[fid]
			if !ok && !manual {
				return
			}
			version := score.version
			if manual {
				version = mediaVersionOfID(s, fid)
				if version == "" {
					return
				}
			}
			ranked = append(ranked, CoverCandidate{fid, kind, version})
		}
		if s.customCovers[filepath.Clean(album.Path)] {
			add(album.CoverImage, album.CoverKind, true)
			pools[id] = ranked
			continue
		}
		if len(scores) == 0 {
			continue
		}
		for _, p := range album.ImageFiles {
			add(p, "image", false)
		}
		for _, p := range album.VideoFiles {
			add(p, "video", false)
		}
		sort.Slice(ranked, func(i, j int) bool {
			a, b := scores[ranked[i].ID].score, scores[ranked[j].ID].score
			if a == b {
				return ranked[i].ID < ranked[j].ID
			}
			return a > b
		})
		for _, candidate := range ranked {
			score := scores[candidate.ID]
			if len(pools[id]) > 0 && scores[pools[id][0].ID].score-score.score > .08 {
				break
			}
			similar := false
			for _, prev := range pools[id] {
				if bits.OnesCount64(scores[prev.ID].hash^score.hash) <= 5 {
					similar = true
					break
				}
			}
			if !similar && candidate.Version == mediaVersionOfID(s, candidate.ID) {
				pools[id] = append(pools[id], candidate)
				if len(pools[id]) == 5 {
					break
				}
			}
		}
	}
	var collect func(models.Collection) []CoverCandidate
	collect = func(folder models.Collection) []CoverCandidate {
		id := externalID(s, folder.Path, ResourceCollection)
		if items, ok := pools[id]; ok {
			return items
		}
		var children [][]CoverCandidate
		for _, album := range folder.Albums {
			children = append(children, pools[externalID(s, album.Path, ResourceAlbum)])
		}
		for _, child := range folder.Collections {
			children = append(children, collect(child))
		}
		seen := map[string]bool{}
		var result []CoverCandidate
		for i := 0; i < 5 && len(result) < 5; i++ {
			for _, pool := range children {
				if i < len(pool) && !seen[pool[i].ID] {
					seen[pool[i].ID] = true
					result = append(result, pool[i])
					if len(result) == 5 {
						break
					}
				}
			}
		}
		pools[id] = result
		return result
	}
	for _, folder := range s.result.Collections {
		collect(folder)
	}
	return pools
}
