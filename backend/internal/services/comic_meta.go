package services

import (
	"encoding/json"
	"errors"
	"maps"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/tianlongxiang/local-gallery/internal/store"
)

// ComicMetaSource 标识当前生效元数据的来源（诚实呈现给用户）。
type ComicMetaSource string

const (
	ComicMetaSourceManual    ComicMetaSource = "manual"     // 用户手动编辑（state/comic_overrides.json）
	ComicMetaSourceLocalFile ComicMetaSource = "local_file" // 目录内 ComicInfo.xml / series.json
	ComicMetaSourceOnline    ComicMetaSource = "online"     // 用户显式开启的公开只读元数据匹配（如 Bangumi）
	ComicMetaSourceLocalOCR  ComicMetaSource = "local_ocr"  // 本机 RapidOCR 封面/卷首抽取
	ComicMetaSourceRule      ComicMetaSource = "rule"       // L0 纯目录名清洗与结构统计
)

// ComicWorkIntel 保存派生目录 derived/comic/intel.json 中单个作品/卷的自动识别结果（可重建）。
type ComicWorkIntel struct {
	NodeID        string          `json:"nodeId"`
	ContentSig    string          `json:"contentSig"` // 作品结构/首话指纹，用于增量判定
	Title         string          `json:"title,omitempty"`
	OriginalTitle string          `json:"originalTitle,omitempty"`
	Aliases       []string        `json:"aliases,omitempty"`
	Author        string          `json:"author,omitempty"`
	Synopsis      string          `json:"synopsis,omitempty"` // 纯文本故事大纲（上限 2000 字符）
	Genres        []string        `json:"genres,omitempty"`   // 题材标签（上限 8 个）
	Status        string          `json:"status,omitempty"`   // ongoing / completed / hiatus / unknown
	Year          int             `json:"year,omitempty"`
	Source        ComicMetaSource `json:"source"`
	Provider      string          `json:"provider,omitempty"`   // 如 "bangumi" / "comicinfo" / "rapidocr"
	ExternalID    string          `json:"externalId,omitempty"` // 外部条目 ID（不暴露本地路径）
	Confidence    float64         `json:"confidence,omitempty"` // [0, 1] 匹配置信度
	UpdatedAt     time.Time       `json:"updatedAt"`
}

// ComicWorkOverride 保存 state/comic_overrides.json 中的人工修正（不可重建，纳入备份）。
// 键为节点相对路径签名或稳定节点 ID（落盘使用规范化相对路径+根标识，导出备份转为公开资源 ID）。
type ComicWorkOverride struct {
	Title     *string   `json:"title,omitempty"`
	Author    *string   `json:"author,omitempty"`
	Synopsis  *string   `json:"synopsis,omitempty"`
	Genres    []string  `json:"genres"` // 非 nil 时覆盖（空切片表示显式清空）
	Status    *string   `json:"status,omitempty"`
	Locked    bool      `json:"locked"` // true 时后续自动识别不覆盖任何人工字段
	UpdatedAt time.Time `json:"updatedAt"`
}

// ComicNodeMeta 嵌入 LibraryNodeSummary，仅在 contentKind == "comic" 时序列化下发。
type ComicNodeMeta struct {
	FirstEpisodeID    string           `json:"firstEpisodeId,omitempty"`
	FirstEpisodeLabel string           `json:"firstEpisodeLabel,omitempty"`
	CleanTitle        string           `json:"cleanTitle"`              // 清洗/识别/人工确认后的展示书名或话名
	OriginalName      string           `json:"originalName,omitempty"`  // 与 CleanTitle 不同时返回原始文件夹名
	ChapterLabel      string           `json:"chapterLabel,omitempty"`  // 单集话号眉标（如 "第1话"、"番外 2"）
	ChapterNumber     *float64         `json:"chapterNumber,omitempty"` // 数值话号
	EpisodeType       ComicEpisodeType `json:"episodeType,omitempty"`   // main / extra / special / volume / unknown
	Author            string           `json:"author,omitempty"`
	Synopsis          string           `json:"synopsis,omitempty"` // 列表/卡片下发截取至 400 字（完整大纲在详情端点返回，防列表包膨胀）
	HasFullSyn        bool             `json:"hasFullSynopsis,omitempty"`
	Genres            []string         `json:"genres,omitempty"`
	Status            string           `json:"status,omitempty"`
	MainCount         int              `json:"mainCount,omitempty"`  // 作品级：正篇话数
	ExtraCount        int              `json:"extraCount,omitempty"` // 作品级：番外/特别篇话数
	MetaSource        ComicMetaSource  `json:"metaSource"`
	Locked            bool             `json:"locked,omitempty"`
	CoverReason       string           `json:"coverReason,omitempty"`
}

type ComicMetaDetail struct {
	Warning string `json:"-"`
	ComicNodeMeta
	NodeID          string           `json:"nodeId"`
	Kind            string           `json:"kind"`
	FullSynopsis    string           `json:"fullSynopsis,omitempty"`
	Aliases         []string         `json:"aliases"`
	Provider        string           `json:"provider,omitempty"`
	Confidence      float64          `json:"confidence,omitempty"`
	UpdatedAt       *time.Time       `json:"updatedAt,omitempty"`
	HasCustomCover  bool             `json:"hasCustomCover"`
	CoverCandidates []CoverCandidate `json:"coverCandidates"`
}
type ComicWorkOverridePatch struct {
	Title    *string  `json:"title"`
	Author   *string  `json:"author"`
	Synopsis *string  `json:"synopsis"`
	Genres   []string `json:"genres"`
	Status   *string  `json:"status"`
	Locked   *bool    `json:"locked"`
}
type ComicMetaBackup map[string]ComicWorkOverride
type ComicMetaCatalogView struct {
	Intel     map[string]ComicWorkIntel
	Overrides ComicMetaBackup
}
type ComicMetaServiceOptions struct {
	Layout       CacheLayout
	Catalog      *ResourceCatalog
	ValidatePath func(string) (string, error)
}
type ComicMetaService struct {
	ComicMetaServiceOptions
	view    ComicMetaCatalogView
	refresh comicRefreshOptions
}

var ErrInvalidComicMeta = errors.New("invalid comic metadata")

func OpenComicMetaService(opts ComicMetaServiceOptions) (*ComicMetaService, error) {
	s := &ComicMetaService{ComicMetaServiceOptions: opts, view: ComicMetaCatalogView{map[string]ComicWorkIntel{}, ComicMetaBackup{}}}
	for path, target := range map[string]any{opts.Layout.ComicOverridesPath: &s.view.Overrides, filepath.Join(opts.Layout.ComicDerivedDir, "intel.json"): &s.view.Intel} {
		data, err := os.ReadFile(path)
		if errors.Is(err, os.ErrNotExist) {
			continue
		}
		if err != nil {
			return nil, err
		}
		if err = json.Unmarshal(data, target); err != nil {
			return nil, err
		}
	}
	if s.view.Intel == nil || s.view.Overrides == nil {
		return nil, ErrInvalidComicMeta
	}
	opts.Catalog.SetComicMeta(s)
	return s, nil
}
func (c *ResourceCatalog) SetComicMeta(s *ComicMetaService) {
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	c.comicService = s
	c.republishLocked()
}
func (s *ComicMetaService) SnapshotForCatalog() ComicMetaCatalogView {
	s.Catalog.publishMu.Lock()
	defer s.Catalog.publishMu.Unlock()
	return ComicMetaCatalogView{maps.Clone(s.view.Intel), maps.Clone(s.view.Overrides)}
}
func (s *ComicMetaService) ResolveNodeMeta(snap CatalogSnapshot, id string) (ComicMetaDetail, bool) {
	if !snap.Ready() {
		return ComicMetaDetail{}, false
	}
	d, ok := snap.state.comics[id]
	if !ok {
		return d, false
	}
	n := snap.state.library.nodes[id]
	d.HasCustomCover = n.HasCustomCover
	d.CoverCandidates = append([]CoverCandidate{}, n.CoverCandidates...)
	return d, true
}
func (p ComicWorkOverridePatch) apply(o ComicWorkOverride) (ComicWorkOverride, error) {
	for _, field := range []struct {
		src   *string
		dst   **string
		limit int
	}{{p.Title, &o.Title, 120}, {p.Author, &o.Author, 80}, {p.Synopsis, &o.Synopsis, 2000}, {p.Status, &o.Status, 16}} {
		if field.src == nil {
			continue
		}
		v := strings.TrimSpace(*field.src)
		if utf8.RuneCountInString(v) > field.limit {
			return o, ErrInvalidComicMeta
		}
		*field.dst = &v
	}
	if o.Title != nil && *o.Title == "" {
		return o, ErrInvalidComicMeta
	}
	if o.Status != nil {
		switch *o.Status {
		case "ongoing", "completed", "hiatus", "unknown":
		default:
			return o, ErrInvalidComicMeta
		}
	}
	if p.Genres != nil {
		if len(p.Genres) > 8 {
			return o, ErrInvalidComicMeta
		}
		o.Genres = make([]string, len(p.Genres))
		for i, v := range p.Genres {
			v = strings.TrimSpace(v)
			if v == "" || utf8.RuneCountInString(v) > 24 {
				return o, ErrInvalidComicMeta
			}
			o.Genres[i] = v
		}
	}
	if p.Locked != nil {
		o.Locked = *p.Locked
	}
	o.UpdatedAt = time.Now().UTC()
	return o, nil
}
func (s *ComicMetaService) change(id string, patch *ComicWorkOverridePatch) (ComicMetaDetail, error) {
	c := s.Catalog
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	if _, ok := s.ResolveNodeMeta(c.Acquire(), id); !ok {
		return ComicMetaDetail{}, ErrLibraryResourceNotFound
	}
	next := maps.Clone(s.view.Overrides)
	if patch == nil {
		delete(next, id)
	} else {
		o, err := patch.apply(next[id])
		if err != nil {
			return ComicMetaDetail{}, err
		}
		next[id] = o
	}
	if err := writeAIJSONAtomic(s.Layout.ComicOverridesPath, next); err != nil {
		return ComicMetaDetail{}, err
	}
	s.view.Overrides = next
	c.republishLocked()
	d, _ := s.ResolveNodeMeta(c.Acquire(), id)
	return d, nil
}
func (s *ComicMetaService) SaveOverride(_ CatalogSnapshot, id string, p ComicWorkOverridePatch) (ComicMetaDetail, error) {
	return s.change(id, &p)
}
func (s *ComicMetaService) ClearOverride(_ CatalogSnapshot, id string) (ComicMetaDetail, error) {
	return s.change(id, nil)
}
func (s *ComicMetaService) BackupOverrides(snap CatalogSnapshot) ComicMetaBackup {
	s.Catalog.publishMu.Lock()
	defer s.Catalog.publishMu.Unlock()
	return s.backupLocked(snap)
}
func (s *ComicMetaService) backupLocked(snap CatalogSnapshot) ComicMetaBackup {
	out := ComicMetaBackup{}
	for id, v := range s.view.Overrides {
		if _, ok := s.ResolveNodeMeta(snap, id); ok {
			out[id] = v
		}
	}
	return out
}
func (s *ComicMetaService) CompareAndRestoreOverrides(digest string, backup ComicMetaBackup, snap CatalogSnapshot) error {
	c := s.Catalog
	c.publishMu.Lock()
	defer c.publishMu.Unlock()
	if c.Acquire().Revision() != snap.Revision() || backupDigest(s.backupLocked(snap)) != digest {
		return store.ErrStateChanged
	}
	next := ComicMetaBackup{}
	for id, v := range backup {
		if _, ok := s.ResolveNodeMeta(snap, id); ok {
			next[id] = v
		}
	}
	if err := writeAIJSONAtomic(s.Layout.ComicOverridesPath, next); err != nil {
		return err
	}
	s.view.Overrides = next
	c.republishLocked()
	return nil
}

func (c *ResourceCatalog) buildComicMeta(st *resourceCatalogState) {
	st.comics = map[string]ComicMetaDetail{}
	add := func(id, kind string, p ParsedComicName) {
		d := ComicMetaDetail{NodeID: id, Kind: kind, Aliases: append([]string{}, p.Aliases...), ComicNodeMeta: ComicNodeMeta{CleanTitle: p.CleanTitle, OriginalName: p.RawName, ChapterLabel: p.ChapterLabel, ChapterNumber: p.ChapterNumber, EpisodeType: p.EpisodeType, Genres: p.ExtractedTags, MetaSource: ComicMetaSourceRule}}
		if s := c.comicService; s != nil {
			local, ok := c.comicLocal[id]
			if !ok {
				local = readComicLocalMeta(st.byID[id].AbsolutePath, kind == "collection", s.ValidatePath)
				c.comicLocal[id] = local
			}
			intel := s.view.Intel[id]
			if intel.Source == ComicMetaSourceLocalFile {
				intel = ComicWorkIntel{}
			}
			for _, v := range []ComicWorkIntel{intel, local} {
				if v.Source == "" {
					continue
				}
				if v.Title != "" {
					d.CleanTitle = v.Title
				}
				if v.Author != "" {
					d.Author = v.Author
				}
				if len(v.Genres) > 0 {
					d.Genres = v.Genres
				}
				if v.Status != "" {
					d.Status = v.Status
				}
				if v.Synopsis != "" || d.FullSynopsis == "" {
					d.FullSynopsis = v.Synopsis
					d.MetaSource = v.Source
					d.Provider = v.Provider
					d.Confidence = v.Confidence
				}
				d.Aliases = append(d.Aliases, v.Aliases...)
				if !v.UpdatedAt.IsZero() {
					t := v.UpdatedAt
					d.UpdatedAt = &t
				}
			}
			if v, ok := s.view.Overrides[id]; ok {
				if v.Title != nil {
					d.CleanTitle = *v.Title
				}
				if v.Author != nil {
					d.Author = *v.Author
				}
				if v.Genres != nil {
					d.Genres = v.Genres
				}
				if v.Status != nil {
					d.Status = *v.Status
				}
				if v.Synopsis != nil || d.FullSynopsis == "" {
					if v.Synopsis != nil {
						d.FullSynopsis = *v.Synopsis
					}
					d.MetaSource = ComicMetaSourceManual
					d.Provider = ""
				}
				d.Locked = v.Locked
				d.UpdatedAt = &v.UpdatedAt
			}
		}
		if d.CleanTitle == d.OriginalName {
			d.OriginalName = ""
		}
		d.Synopsis = comicText(d.FullSynopsis, 400)
		d.HasFullSyn = d.FullSynopsis != d.Synopsis
		st.comics[id] = d
	}
	for id, n := range st.collections {
		if n.ContentKind == "comic" {
			add(id, "collection", ParseComicWorkName(filepath.Base(n.Path)))
		}
	}
	for id, n := range st.albums {
		if n.ContentKind != "comic" {
			continue
		}
		parent := parentCollectionID(st, n.Path, n.Virtual)
		p := ParseComicEpisodeName(n.Name, st.comics[parent].CleanTitle)
		if n.Virtual {
			p = ParsedComicName{RawName: n.Name, CleanTitle: albumDisplayName(n), EpisodeType: ComicEpisodeUnknown}
		}
		add(id, "album", p)
		if n.Virtual {
			continue
		}
		for parent != "" {
			d, exists := st.comics[parent]
			if !exists {
				break
			}
			switch p.EpisodeType {
			case ComicEpisodeMain, ComicEpisodeVolume:
				d.MainCount++
			case ComicEpisodeExtra, ComicEpisodeSpecial:
				d.ExtraCount++
			}
			st.comics[parent] = d
			parent = parentCollectionID(st, st.collections[parent].Path, false)
		}
	}
}
func comicSummary(st *resourceCatalogState, n LibraryNodeSummary) LibraryNodeSummary {
	d, ok := st.comics[n.ID]
	if !ok {
		return n
	}
	m := d.ComicNodeMeta
	if n.Kind == "album" && n.ParentID != "" {
		m.Synopsis = ""
		m.HasFullSyn = d.FullSynopsis != ""
	}
	n.Comic = &m
	n.DisplayName = m.CleanTitle
	n.comicSearch = strings.ToLower(strings.Join(append([]string{n.Name, m.CleanTitle, m.Author}, d.Aliases...), " "))
	if len(n.CoverCandidates) > 0 {
		v := n.CoverCandidates[0]
		n.CoverImage = v.ID
		n.CoverImageVersion = v.Version
		n.CoverKind = v.Kind
	} else if _, curated := st.curated[n.ID]; curated {
		n.CoverImage, n.CoverImageVersion, n.CoverKind = "", "", ""
	}
	return n
}
