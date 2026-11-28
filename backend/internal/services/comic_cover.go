package services

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"math/bits"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// comicCoverEvidence 持久化在 derived/metadata/comicCover/batches/... 的单页分析载荷。
type comicCoverEvidence struct {
	Aesthetic    float64           `json:"aesthetic"`    // [0, 1] 复用 Aesthetic Predictor V2.5
	Feature      SimilarityFeature `json:"feature"`      // 宽高、清晰度、曝光、高光/暗部裁切
	FullHash     string            `json:"fullHash"`     // 16位 hex，整图 64-bit dHash
	CropHash     string            `json:"cropHash"`     // 16位 hex，裁去顶部 18% 标题栏后的主体 64-bit dHash
	PanelScore   float64           `json:"panelScore"`   // [0, 1] 多格分镜网格概率（越高越像内页）
	TextRatio    float64           `json:"textRatio"`    // [0, 1] 文字块与纯色底板占比（越高越像公告/版权页）
	Colorfulness float64           `json:"colorfulness"` // [0, 1] 归一化色彩丰富度（区分彩绘封面与黑白内页）
	AspectRatio  float64           `json:"aspectRatio"`  // width / height
}

// ComicCoverChoice 描述某个节点（作品或单集）的智能封面候选结果。
type ComicCoverChoice struct {
	Candidates      []CoverCandidate `json:"candidates"`                // 按综合分降序，最多 5 项，Candidates[0] 为默认主封面
	IsTemplateDedup bool             `json:"isTemplateDedup,omitempty"` // 单集是否触发了跨话模板页去重
	Reason          string           `json:"reason,omitempty"`          // 机器可读入选依据：manual / filename_cover / aesthetic_poster / dedup_scene / fallback_first
}

const AIJobTypeComicCover = "comicCover"
const comicCoverVersion = "comic-cover-v1"

type ComicCoverAnalyzer struct{ *AlbumCoverAnalyzer }

func (*ComicCoverAnalyzer) Type() string    { return AIJobTypeComicCover }
func (*ComicCoverAnalyzer) Version() string { return comicCoverVersion }
func (w *localAIWorker) ScoreComicCovers(ctx context.Context, paths []string, device string) ([]AIWorkerAnalysis, error) {
	return w.analyzeImages(ctx, "score_comic_covers", paths, device)
}
func (a *ComicCoverAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	if len(inputs) == 0 {
		return nil, nil
	}
	paths := make([]string, len(inputs))
	for i, in := range inputs {
		paths[i] = in.AnalysisPath
		if paths[i] == "" {
			paths[i] = in.Path
		}
	}
	items, err := a.worker.ScoreComicCovers(ctx, paths, inputs[0].ComputeDevice)
	if err != nil {
		return nil, err
	}
	if len(items) != len(inputs) {
		return nil, fmt.Errorf("incomplete comic cover scores")
	}
	out := make([]AIAnalysisOutput, len(items))
	for i, v := range items {
		var e comicCoverEvidence
		if v.Error != "" || json.Unmarshal(v.Data, &e) != nil || len(e.CropHash) != 16 {
			out[i] = AIAnalysisOutput{Status: "failed", ErrorCode: "image_analysis_failed", ErrorMessage: "漫画封面评分失败"}
			continue
		}
		out[i] = AIAnalysisOutput{Status: "scored", Data: v.Data}
	}
	return out, nil
}

var coverFilename = regexp.MustCompile(`(?i)(^|[_\s-])(cover|poster|folder|封面)([_\s.\-]|$)`)
var noticeText = regexp.MustCompile("停刊|编辑的话|公告|通知|免责声明|致读者|扫图组|汉化组招募|仅供试看|版权声明")

func comicSampleIndices(paths []string) []int {
	out := make([]int, 0, 5)
	add := func(i int) {
		if len(out) < 5 && !slices.Contains(out, i) {
			out = append(out, i)
		}
	}
	for i, p := range paths {
		if coverFilename.MatchString(filepath.Base(p)) {
			add(i)
			if len(out) == 5 {
				return out
			}
		}
	}
	for i := 0; i < min(4, len(paths)); i++ {
		add(i)
	}
	if len(paths) >= 8 {
		add(min(5, len(paths)/3))
	}
	return out
}
func scoreComicPage(ev comicCoverEvidence, pageIndex int, fileName, ocrText string) float64 {
	score := .45*ev.Aesthetic + .20*similarityQualityScore(ev.Feature).Score + .15*math.Exp(-math.Abs(ev.AspectRatio-.68)/.35) + .12*ev.Colorfulness - .30*ev.PanelScore
	if coverFilename.MatchString(filepath.Base(fileName)) {
		score += .25
	}
	if ev.TextRatio > .35 {
		score -= .45 * (ev.TextRatio - .35) / .65
	}
	if noticeText.MatchString(ocrText) {
		score -= .80
	}
	if ev.Feature.ClippedHigh > .85 || ev.Feature.ClippedLow > .85 {
		score -= .50
	}
	return score
}

type comicPageRecord struct {
	ev            comicCoverEvidence
	version, text string
	failed        bool
}

func (c *ResourceCatalog) SetComicCoverScores(records []AIAnalysisRecord, ocr ...[]AIAnalysisRecord) {
	scores := map[string]comicPageRecord{}
	texts := map[string]string{}
	for _, set := range ocr {
		for _, r := range set {
			var v struct{ Text string }
			if json.Unmarshal(r.Data, &v) == nil {
				texts[r.ResourceID] = v.Text
			}
		}
	}
	for _, r := range records {
		if r.ModuleVersion != comicCoverVersion {
			continue
		}
		v := comicPageRecord{version: fmt.Sprintf("%d-%d-r%d", r.MTimeNs, r.Size, renditionAlgoVersion), text: texts[r.ResourceID], failed: r.Status == "failed"}
		if v.failed || r.Status == "scored" && json.Unmarshal(r.Data, &v.ev) == nil {
			scores[r.ResourceID] = v
		}
	}
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	if len(scores) == 0 && len(c.comicCoverScores) == 0 {
		return
	}
	c.comicCoverScores = scores
	c.republishLocked()
}

type comicPick struct {
	CoverCandidate
	score            float64
	hash             uint64
	hashed, explicit bool
	index            int
	ocr              string
}

func sameComicImage(a, b comicPick, dist int) bool {
	return a.ID == b.ID || a.hashed && b.hashed && bits.OnesCount64(a.hash^b.hash) <= dist
}
func rankComic(p []comicPick) {
	sort.SliceStable(p, func(i, j int) bool { return p[i].score > p[j].score })
}
func (c *ResourceCatalog) buildComicCovers(st *resourceCatalogState) {
	candidate := func(path string, index int) (comicPick, bool) {
		id := externalID(st, path, ResourceFile)
		if id == "" {
			return comicPick{}, false
		}
		v := mediaVersionOfID(st, id)
		p := comicPick{CoverCandidate: CoverCandidate{id, "image", v}, index: index, explicit: coverFilename.MatchString(filepath.Base(path)), score: -1}
		if p.explicit {
			p.score += .25
		}
		if rec, ok := c.comicCoverScores[id]; ok && rec.version == v {
			if rec.failed {
				return p, false
			}
			p.score = scoreComicPage(rec.ev, index, path, rec.text)
			p.ocr = rec.text
			h, err := strconv.ParseUint(rec.ev.CropHash, 16, 64)
			p.hash = h
			p.hashed = err == nil
		}
		return p, true
	}
	save := func(id string, picks []comicPick, reason string) {
		out := []CoverCandidate{}
		for _, p := range picks {
			out = append(out, p.CoverCandidate)
			if len(out) == 5 {
				break
			}
		}
		st.curated[id] = out
		d := st.comics[id]
		d.CoverReason = reason
		st.comics[id] = d
	}
	groups := map[string][]string{}
	pages := map[string][]comicPick{}
	for id, a := range st.albums {
		if a.ContentKind != "comic" {
			continue
		}
		parent := parentCollectionID(st, a.Path, a.Virtual)
		groups[parent] = append(groups[parent], id)
		for _, i := range comicSampleIndices(a.ImageFiles) {
			if p, ok := candidate(a.ImageFiles[i], i); ok {
				pages[id] = append(pages[id], p)
			}
		}
	}
	for parent, ids := range groups {
		sort.Slice(ids, func(i, j int) bool { return naturalLess(st.albums[ids[i]].Path, st.albums[ids[j]].Path) })
		type cluster struct {
			pick        comicPick
			owner, last string
			freq        int
		}
		// 距离不超过 6 的两个 64 位哈希，七段中至少有一段完全相同。
		// 只核验这些候选簇，保留自然顺序中第一个匹配的代表页。
		var buckets [7]map[uint64][]int
		for i := range buckets {
			buckets[i] = make(map[uint64][]int)
		}
		segment := func(h uint64, part int) uint64 {
			if part == 6 {
				return h >> 54
			}
			return (h >> (9 * part)) & 511
		}
		clusters := []cluster{}
		clusterOf := map[string]int{}
		main := func(id string) bool {
			t := st.comics[id].EpisodeType
			return t == ComicEpisodeMain || t == ComicEpisodeVolume
		}
		for _, id := range ids {
			for _, p := range pages[id] {
				if p.index > 1 || !p.hashed {
					continue
				}
				idx := -1
				for part, bucket := range buckets {
					for _, ix := range bucket[segment(p.hash, part)] {
						if (idx < 0 || ix < idx) && sameComicImage(clusters[ix].pick, p, 6) {
							idx = ix
						}
					}
				}
				if idx < 0 {
					idx = len(clusters)
					clusters = append(clusters, cluster{pick: p, owner: id})
					for part, bucket := range buckets {
						key := segment(p.hash, part)
						bucket[key] = append(bucket[key], idx)
					}
				}
				cl := &clusters[idx]
				if cl.last != id {
					cl.freq++
					cl.last = id
				}
				if main(id) && !main(cl.owner) {
					cl.owner = id
				}
				clusterOf[p.ID] = idx
			}
		}
		var previous comicPick
		for _, id := range ids {
			best := slices.Clone(pages[id])
			reason := "fallback_first"
			dedup := false
			for i, p := range best {
				if p.hashed {
					reason = "aesthetic_poster"
				}
				if ix, ok := clusterOf[p.ID]; ok && clusters[ix].freq >= 2 && parent != "" {
					if clusters[ix].owner == id {
						best[i].score -= .05
					} else {
						best[i].score -= .55
						dedup = true
					}
				}
			}
			rankComic(best)
			if len(best) > 1 && parent != "" && sameComicImage(best[0], previous, 8) {
				for i := 1; i < len(best); i++ {
					if best[0].score-best[i].score < .22 && !sameComicImage(best[i], previous, 8) {
						best[0], best[i] = best[i], best[0]
						dedup = true
						break
					}
				}
			}
			a := st.albums[id]
			if st.customCovers[filepath.Clean(a.Path)] {
				best = []comicPick{{CoverCandidate: CoverCandidate{externalID(st, a.CoverImage, ResourceFile), a.CoverKind, mediaVersionOfID(st, externalID(st, a.CoverImage, ResourceFile))}}}
				reason = "manual"
			} else if dedup {
				reason = "dedup_scene"
			} else if len(best) > 0 && best[0].explicit {
				reason = "filename_cover"
			}
			save(id, best, reason)
			if len(best) > 0 {
				previous = best[0]
			}
		}
	}
	var collect func(models.Collection) []comicPick
	collect = func(work models.Collection) []comicPick {
		id := externalID(st, work.Path, ResourceCollection)
		if work.ContentKind != "comic" {
			return nil
		}
		ids := groups[id]
		hasMain := slices.ContainsFunc(ids, func(a string) bool {
			t := st.comics[a].EpisodeType
			return t == ComicEpisodeMain || t == ComicEpisodeVolume
		})
		regular := 0
		pool := []comicPick{}
		firstID := ""
		for _, aid := range ids {
			if st.albums[aid].Virtual || len(st.albums[aid].ImageFiles) == 0 {
				continue
			}
			ep := st.comics[aid]
			if firstID == "" || (ep.EpisodeType == ComicEpisodeMain || ep.EpisodeType == ComicEpisodeVolume) && (st.comics[firstID].EpisodeType != ComicEpisodeMain && st.comics[firstID].EpisodeType != ComicEpisodeVolume || ep.ChapterNumber != nil && st.comics[firstID].ChapterNumber != nil && *ep.ChapterNumber < *st.comics[firstID].ChapterNumber) {
				firstID = aid
			}
		}
		if firstID != "" {
			d := st.comics[id]
			d.FirstEpisodeID = firstID
			first := st.comics[firstID]
			d.FirstEpisodeLabel = first.CleanTitle
			if first.ChapterLabel != "" && first.CleanTitle != first.ChapterLabel {
				d.FirstEpisodeLabel = first.ChapterLabel + " · " + first.CleanTitle
			}
			st.comics[id] = d
		}
		for n, aid := range ids {
			ep := st.comics[aid]
			main := ep.EpisodeType == ComicEpisodeMain || ep.EpisodeType == ComicEpisodeVolume
			take := main && regular < 8 || !hasMain && n < 10
			if main {
				regular++
			}
			picks := slices.Clone(pages[aid])
			for j := range picks {
				p := &picks[j]
				if st.albums[aid].Virtual && p.explicit {
					p.score += 3
				}
				if main && regular == 1 && p.index == 0 {
					p.score += .12
				}
				if ep.EpisodeType == ComicEpisodeExtra || ep.EpisodeType == ComicEpisodeSpecial {
					p.score -= .25
				}
				if strings.Contains(p.ocr, st.comics[id].CleanTitle) {
					p.score += .25
				}
			}
			rankComic(picks)
			for j, p := range picks {
				if take && j < 2 || p.explicit {
					pool = append(pool, p)
				}
			}
		}
		for _, sub := range work.Collections {
			pool = append(pool, collect(sub)...)
			if firstID == "" {
				child := st.comics[externalID(st, sub.Path, ResourceCollection)]
				if child.FirstEpisodeID != "" {
					d := st.comics[id]
					firstID = child.FirstEpisodeID
					d.FirstEpisodeID = firstID
					d.FirstEpisodeLabel = child.FirstEpisodeLabel
					st.comics[id] = d
				}
			}
		}
		rankComic(pool)
		unique := []comicPick{}
		for _, p := range pool {
			if !slices.ContainsFunc(unique, func(q comicPick) bool { return sameComicImage(p, q, 6) }) {
				unique = append(unique, p)
				if len(unique) == 5 {
					break
				}
			}
		}
		reason := "fallback_first"
		if len(unique) > 0 {
			if unique[0].hashed {
				reason = "aesthetic_poster"
			}
			if unique[0].explicit {
				reason = "filename_cover"
			}
		}
		if v, ok := c.collectionCustomCovers[filepath.Clean(work.Path)]; ok {
			rel, err := filepath.Rel(work.Path, v.File)
			if err == nil && !relEscapesRoot(rel) && models.IsImageFile(v.File) {
				fid := externalID(st, v.File, ResourceFile)
				version := mediaVersionOfID(st, fid)
				safe := true
				if c.comicService != nil && c.comicService.ValidatePath != nil {
					_, err := c.comicService.ValidatePath(v.File)
					safe = err == nil
				}
				if fid != "" && version != "" && safe && st.byID[fid].RootID == st.byID[id].RootID {
					p := comicPick{CoverCandidate: CoverCandidate{fid, "image", version}}
					unique = slices.DeleteFunc(unique, func(q comicPick) bool { return q.ID == p.ID })
					unique = append([]comicPick{p}, unique...)
					reason = "manual"
				}
			}
		}
		save(id, unique, reason)
		return unique
	}
	for _, w := range st.result.Collections {
		collect(w)
	}
}
