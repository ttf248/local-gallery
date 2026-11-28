package services

import (
	"fmt"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"path/filepath"
	"testing"
)

func TestUnreadWorksGroupingAndMainFirst(t *testing.T) {
	root := t.TempDir()
	work := filepath.Join(root, "星海")
	album := func(parent, name string) models.Album {
		path := filepath.Join(parent, name)
		return models.Album{Type: "album", Name: name, DisplayName: name, Path: path, SourceRoot: root, ImageCount: 1, ImageFiles: []string{filepath.Join(path, "1.jpg")}}
	}
	chapters := []models.Album{album(work, "0001 番外1")}
	for n := 1; n <= 635; n++ {
		chapters = append(chapters, album(work, fmt.Sprintf("第%d话", n)))
	}
	result := &models.ScanResult{Roots: []string{root}, Albums: []models.Album{album(root, "独立卷")}, Collections: []models.Collection{{Type: "collection", Path: work, Name: "星海", DisplayName: "星海", SourceRoot: root, AlbumCount: 636, Albums: chapters}}}
	catalog := NewResourceCatalog()
	catalog.SetContentKindPolicy(NewContentKindPolicy([]RootKind{{Path: root, Kind: models.ContentKindComic}}))
	catalog.Publish(result, []string{root})
	s := catalog.Acquire()
	ix := NewUnreadLibraryIndex()
	first, err := ix.PageWorks(s, StartedAlbums{}, 1, LibraryKindComic, "", "", 1)
	if err != nil || first.Total != 2 || first.NextCursor == "" {
		t.Fatalf("first %+v %v", first, err)
	}
	second, err := ix.PageWorks(s, StartedAlbums{}, 1, LibraryKindComic, "", first.NextCursor, 1)
	if err != nil {
		t.Fatal(err)
	}
	var standalone, series bool
	for _, g := range append(first.Items, second.Items...) {
		if g.IsStandalone {
			standalone = g.UnreadCount == 1
		} else {
			series = g.UnreadCount == 636 && g.NextChapter.Name == "第1话"
			if !series {
				t.Errorf("count %d next %s", g.UnreadCount, g.NextChapter.Name)
			}
		}
	}
	if !series || !standalone {
		t.Fatal("missing work or standalone")
	}
	d, err := ix.Dashboard(s, nil, StartedAlbums{}, 1, LibraryKindComic)
	if err != nil || len(d.Unread) != 2 {
		t.Fatalf("recommendations %d, %v", len(d.Unread), err)
	}
}
