package services

import (
	"context"
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/config"
)

const AIJobTypeComicMeta = "comicMeta"

var ErrOnlineComicDisabled = errors.New("online comic metadata disabled")

type comicRefreshOptions struct {
	worker   *localAIWorker
	provider ComicMetadataProvider
	config   func() config.ComicMetaConfig
	device   func() string
}

func (s *ComicMetaService) ConfigureAnalysis(w *localAIWorker, cfg func() config.ComicMetaConfig, device func() string) {
	s.refresh = comicRefreshOptions{worker: w, config: cfg, device: device, provider: &BangumiProvider{config: cfg, slot: make(chan struct{}, 1)}}
}

// 识别目标由作品的首个正篇代表，散卷用自己的首页。所有入口共用同一抽样表。
func comicSampleIDs(snap CatalogSnapshot, filter aiTargetFilter) map[string]string {
	out := map[string]string{}
	if !snap.Ready() {
		return out
	}
	st := snap.state
	type firstVolume struct {
		id       string
		priority int
		path     string
	}
	first := map[string]firstVolume{}
	for id, a := range st.albums {
		if a.ContentKind != "comic" || len(a.ImageFiles) == 0 {
			continue
		}
		if filter == aiTargetComicCoverSample {
			for _, i := range comicSampleIndices(a.ImageFiles) {
				out[externalID(st, a.ImageFiles[i], ResourceFile)] = id
			}
			continue
		}
		work := id
		for p := parentCollectionID(st, a.Path, a.Virtual); p != ""; p = parentCollectionID(st, st.collections[p].Path, false) {
			work = p
		}
		rank := 1
		t := st.comics[id].EpisodeType
		if t == ComicEpisodeVolume || t == ComicEpisodeMain {
			rank = 0
		}
		if a.Virtual {
			rank = 2
		}
		prev, ok := first[work]
		if !ok || rank < prev.priority || rank == prev.priority && naturalLess(a.Path, prev.path) {
			first[work] = firstVolume{id, rank, a.Path}
		}
	}
	for work, v := range first {
		out[externalID(st, st.albums[v.id].ImageFiles[0], ResourceFile)] = work
	}
	return out
}
func (s *ComicMetaService) readIntel(ctx context.Context, snap CatalogSnapshot, nodeID, firstID, device string, online bool) (ComicWorkIntel, string, error) {
	d, ok := s.ResolveNodeMeta(snap, nodeID)
	if !ok {
		return ComicWorkIntel{}, "", ErrLibraryResourceNotFound
	}
	if online && (s.refresh.config == nil || !s.refresh.config().OnlineEnabled) {
		return ComicWorkIntel{}, "", ErrOnlineComicDisabled
	}
	ref, _ := snap.Lookup(nodeID)
	v := readComicLocalMeta(ref.AbsolutePath, d.Kind == "collection", s.ValidatePath)
	warning := ""
	title := ParseComicWorkName(filepath.Base(ref.AbsolutePath)).CleanTitle
	if v.Title != "" {
		title = v.Title
	}
	if v.Synopsis == "" && firstID != "" && s.refresh.worker != nil {
		media := snap.state.library.mediaByFile[firstID]
		files := snap.state.albums[media.albumID].ImageFiles
		indices := comicSampleIndices(files)
		if len(files) > 0 && !slices.Contains(indices, len(files)-1) {
			indices = append(indices, len(files)-1)
		}
		var paths []string
		for _, i := range indices {
			path, err := s.ValidatePath(files[i])
			if err != nil {
				continue
			}
			st, err := os.Lstat(path)
			if err == nil && st.Mode().IsRegular() {
				paths = append(paths, path)
			}
		}
		if len(paths) > 0 {
			items, err := s.refresh.worker.AnalyzeOCROnDevice(ctx, paths, device)
			if err != nil {
				warning = "本机文字识别暂不可用"
			} else {
				for _, item := range items {
					var o struct{ Text string }
					if json.Unmarshal(item.Data, &o) != nil || noticeText.MatchString(o.Text) {
						continue
					}
					if v.Title == "" {
						for _, line := range strings.Split(o.Text, "\n") {
							if name, ok := strings.CutPrefix(strings.TrimSpace(line), "书名："); ok && len([]rune(name)) <= 120 && strings.TrimSpace(name) != "" {
								v.Title = strings.TrimSpace(name)
								v.Source = ComicMetaSourceLocalOCR
								v.Provider = "rapidocr"
								break
							}
						}
					}
					for _, label := range []string{"故事简介", "内容简介", "故事大纲", "剧情简介", "简介"} {
						if _, after, ok := strings.Cut(o.Text, label); ok && len([]rune(strings.TrimSpace(after))) >= 8 {
							v.Synopsis = comicText(strings.Trim(after, " \n\t:："), 2000)
							v.Source = ComicMetaSourceLocalOCR
							v.Provider = "rapidocr"
							break
						}
					}
					if v.Synopsis != "" {
						break
					}
				}
			}
		}
	}
	if online && (v.Source != ComicMetaSourceLocalFile || v.Synopsis == "") && !strings.ContainsAny(title, `/\:`) {
		m, err := s.refresh.provider.SearchWork(ctx, ComicMetadataQuery{Title: title})
		if err != nil {
			warning = "公开元数据源暂不可用，已保留本地结果"
		} else if m != nil {
			v = ComicWorkIntel{Title: m.Title, OriginalTitle: m.OriginalTitle, Author: m.Author, Synopsis: m.Synopsis, Genres: m.Genres, Year: m.Year, Status: m.Status, Provider: m.Provider, ExternalID: m.ExternalID, Confidence: m.Confidence, Source: ComicMetaSourceOnline}
		}
	}
	if v.Source == "" {
		v.Source = ComicMetaSourceRule
	}
	v.NodeID = nodeID
	v.UpdatedAt = time.Now().UTC()
	v.ContentSig = snap.state.comicSignatures[nodeID]
	return v, warning, ctx.Err()
}
func (s *ComicMetaService) storeIntel(values []ComicWorkIntel) error {
	c := s.Catalog
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	next := maps.Clone(s.view.Intel)
	changed := false
	for _, v := range values {
		snapshot := c.Acquire()
		if _, ok := s.ResolveNodeMeta(snapshot, v.NodeID); !ok || v.ContentSig != snapshot.state.comicSignatures[v.NodeID] || s.view.Overrides[v.NodeID].Locked || !next[v.NodeID].UpdatedAt.Before(v.UpdatedAt) {
			continue
		}
		next[v.NodeID] = v
		delete(c.comicLocal, v.NodeID)
		changed = true
	}
	if !changed {
		return nil
	}
	if err := writeAIJSONAtomic(filepath.Join(s.Layout.ComicDerivedDir, "intel.json"), next); err != nil {
		return err
	}
	s.view.Intel = next
	c.republishLocked()
	return nil
}
func (s *ComicMetaService) OnlineEnabled() bool {
	return s.refresh.config != nil && s.refresh.config().OnlineEnabled
}
func (s *ComicMetaService) RefreshWork(ctx context.Context, snap CatalogSnapshot, id string, online bool) (ComicMetaDetail, error) {
	d, ok := s.ResolveNodeMeta(snap, id)
	if !ok {
		return d, ErrLibraryResourceNotFound
	}
	first := ""
	if a, ok := snap.state.albums[id]; ok && len(a.ImageFiles) > 0 {
		first = externalID(snap.state, a.ImageFiles[0], ResourceFile)
	} else {
		if a, ok := snap.state.albums[d.FirstEpisodeID]; ok && len(a.ImageFiles) > 0 {
			first = externalID(snap.state, a.ImageFiles[0], ResourceFile)
		}
		for fid, n := range snap.state.comicTargets {
			if n == id {
				first = fid
				break
			}
		}
	}
	device := "cpu"
	if s.refresh.device != nil {
		device = s.refresh.device()
	}
	v, w, err := s.readIntel(ctx, snap, id, first, device, online)
	if err != nil {
		return d, err
	}
	if err = s.storeIntel([]ComicWorkIntel{v}); err != nil {
		return d, err
	}
	d, _ = s.ResolveNodeMeta(s.Catalog.Acquire(), id)
	d.Warning = w
	return d, nil
}

type ComicMetaAnalyzer struct {
	*OCRAnalyzer
	Service *ComicMetaService
}

func (*ComicMetaAnalyzer) Type() string    { return AIJobTypeComicMeta }
func (*ComicMetaAnalyzer) Version() string { return "comic-meta-v1" }
func (a *ComicMetaAnalyzer) RecordCurrent(r AIAnalysisRecord) bool {
	var v ComicWorkIntel
	if json.Unmarshal(r.Data, &v) != nil {
		return false
	}
	snap := a.Service.Catalog.Acquire()
	return snap.Ready() && v.ContentSig != "" && snap.state.comicSignatures[v.NodeID] == v.ContentSig && snap.state.comicTargets[r.ResourceID] == v.NodeID
}
func (a *ComicMetaAnalyzer) AnalyzeBatch(ctx context.Context, inputs []AIAnalysisInput) ([]AIAnalysisOutput, error) {
	snap := a.Service.Catalog.Acquire()
	out := make([]AIAnalysisOutput, len(inputs))
	for i, in := range inputs {
		id := snap.state.comicTargets[in.ResourceID]
		v, _, err := a.Service.readIntel(ctx, snap, id, in.ResourceID, in.ComputeDevice, a.Service.refresh.config().OnlineEnabled)
		if err != nil {
			return nil, err
		}
		data, _ := json.Marshal(v)
		out[i] = AIAnalysisOutput{Status: "recognized", Data: data}
	}
	return out, nil
}
func (s *ComicMetaService) ApplyRecords(records []AIAnalysisRecord) error {
	values := []ComicWorkIntel{}
	for _, r := range records {
		var v ComicWorkIntel
		if r.Type == AIJobTypeComicMeta && r.Status == "recognized" && json.Unmarshal(r.Data, &v) == nil {
			values = append(values, v)
		}
	}
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.Before(values[j].UpdatedAt) })
	return s.storeIntel(values)
}
