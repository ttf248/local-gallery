package services

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestComicCoverSamplingAndDedup(t *testing.T) {
	if n := comicSampleIndices([]string{"1", "2", "3", "4", "5", "6", "7", "8", "cover.jpg"}); len(n) != 5 || n[0] != 8 {
		t.Fatal(n)
	}
	s, id, _ := comicFixture(t)
	snap := s.Catalog.Acquire()
	work := snap.state.collections[id]
	var records []AIAnalysisRecord
	for i, a := range work.Albums {
		for j, p := range a.ImageFiles {
			e := comicCoverEvidence{Aesthetic: .94, Colorfulness: .8, AspectRatio: .68, CropHash: "0123456789abcdef", Feature: SimilarityFeature{Width: 800, Height: 1200}}
			if j == 1 {
				e.CropHash = []string{"ffffffff00000000", "ff00ff00ff00ff00", "00ff00ff00ff00ff"}[i]
				e.Aesthetic = .60
			}
			if i == 0 {
				e.TextRatio = 1
			}
			data, _ := json.Marshal(e)
			st, _ := os.Stat(p)
			records = append(records, AIAnalysisRecord{Type: AIJobTypeComicCover, ModuleVersion: comicCoverVersion, Status: "scored", ResourceID: snap.ExternalID(p, ResourceFile), MTimeNs: st.ModTime().UnixNano(), Size: st.Size(), Data: data})
		}
	}
	// 分批任务可能先完成首卷内页；暂停或重启时仍应选中首卷扉页。
	s.Catalog.SetComicCoverScores(records[3:4])
	partial := s.Catalog.Acquire()
	for _, nodeID := range []string{id, partial.ExternalID(work.Albums[1].Path, ResourceAlbum)} {
		n, _ := partial.LibraryNode(nodeID)
		if n.CoverImage != records[2].ResourceID || n.Comic.CoverReason != "fallback_first" {
			t.Fatalf("部分评分改变了默认封面：%+v", n)
		}
	}
	s.Catalog.SetComicCoverScores(records)
	snap = s.Catalog.Acquire()
	d, _ := s.ResolveNodeMeta(snap, id)
	if len(d.CoverCandidates) == 0 || d.CoverCandidates[0].ID != records[2].ResourceID {
		t.Fatal(d.CoverCandidates)
	}
	second, _ := snap.LibraryNode(snap.ExternalID(work.Albums[2].Path, ResourceAlbum))
	if second.CoverImage != records[5].ResourceID || second.Comic.CoverReason != "dedup_scene" {
		t.Fatal(second)
	}
	ev := comicCoverEvidence{AspectRatio: .68}
	if scoreComicPage(ev, 0, "cover.jpg", "公告") >= scoreComicPage(ev, 0, "page.jpg", "") {
		t.Fatal("公告页排序错误")
	}
}
func TestCollectionCoverOverride(t *testing.T) {
	s, id, _ := comicFixture(t)
	snap := s.Catalog.Acquire()
	work := snap.state.collections[id]
	store := NewCoverOverrideStore(filepath.Join(t.TempDir(), "covers.json"))
	file := work.Albums[0].ImageFiles[1]
	if err := store.SetCollection(work.Path, file); err != nil {
		t.Fatal(err)
	}
	s.Catalog.RefreshCovers(nil, store)
	n, _ := s.Catalog.Acquire().LibraryNode(id)
	if !n.HasCustomCover || n.CoverImage != snap.ExternalID(file, ResourceFile) {
		t.Fatal(n)
	}
	if err := store.Load(); err != nil {
		t.Fatal(err)
	}
	if err := store.ClearCollection(work.Path); err != nil {
		t.Fatal(err)
	}
	s.Catalog.RefreshCovers(nil, store)
	n, _ = s.Catalog.Acquire().LibraryNode(id)
	if n.HasCustomCover || n.CoverImage == snap.ExternalID(file, ResourceFile) {
		t.Fatal(n)
	}
}
