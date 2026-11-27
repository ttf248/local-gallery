package services

import (
	"encoding/json"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"os"
	"path/filepath"
	"testing"
)

func TestCuratedCoversFollowMembersVersionsAndOverrides(t *testing.T) {
	f := newLibraryPageFixture(t)
	c := f.catalog
	c.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: f.root, Kind: models.ContentKindPhoto}}))
	var records []AIAnalysisRecord
	for i, name := range []string{"page1.jpg", "page3.jpg", "page2.mp4", "nested.jpg"} {
		dir := "album2"
		if i == 3 {
			dir = filepath.Join("collection3", "nested1")
		}
		path := filepath.Join(f.root, dir, name)
		if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(name), 0644); err != nil {
			t.Fatal(err)
		}
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		hash := []string{"0000000000000000", "0000000000000001", "ffffffffffffffff", "bbbbbbbbbbbbbbbb"}[i]
		data, _ := json.Marshal(coverEvidence{Aesthetic: 1 - float64(i)*.01, Hash: hash, Feature: SimilarityFeature{Width: 1200, Height: 900}})
		records = append(records, AIAnalysisRecord{Type: AIJobTypeAlbumCover, ModuleVersion: coverVersion, ResourceID: c.ExternalID(path, ResourceFile), Size: info.Size(), MTimeNs: info.ModTime().UnixNano(), Status: "scored", Data: data})
	}
	c.SetCoverScores(records)
	pool := func(id string) []CoverCandidate { return c.Acquire().state.library.nodes[id].CoverCandidates }
	if v := pool(f.albumID); len(v) != 2 || v[0].ID != records[0].ResourceID || v[1].Kind != "video" {
		t.Fatalf("album %v", v)
	}
	if v := pool(f.collectionID); len(v) != 1 || v[0].ID != records[3].ResourceID {
		t.Fatalf("folder %v", v)
	}
	if err := os.Remove(filepath.Join(f.root, "collection3", "nested1", "nested.jpg")); err != nil {
		t.Fatal(err)
	}
	c.SetCoverScores(records)
	if len(pool(f.collectionID)) != 0 {
		t.Fatal("removed cover")
	}
	state := c.Acquire().state
	album := state.albums[f.albumID]
	album.CoverImage = album.VideoFiles[0]
	album.CoverKind = "video"
	stateCopy := *state
	stateCopy.albums = map[string]models.Album{f.albumID: album}
	stateCopy.customCovers = map[string]bool{filepath.Clean(album.Path): true}
	if v := buildCuratedCovers(&stateCopy, nil)[f.albumID]; len(v) != 1 || v[0].ID != records[2].ResourceID {
		t.Fatalf("manual %v", v)
	}
}
