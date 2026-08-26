package services

import (
	"path/filepath"
	"strings"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func TestResourceCatalog_PublicSnapshotDoesNotExposeAbsolutePaths(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	filePath := filepath.Join(albumPath, "page.jpg")
	result := &models.ScanResult{
		Root:  root,
		Roots: []string{root},
		Albums: []models.Album{{
			Type:       "album",
			Path:       albumPath,
			SourceRoot: root,
			ImageFiles: []string{filePath},
			CoverImage: filePath,
		}},
	}
	catalog := NewResourceCatalog()
	if catalog.Ready() {
		t.Fatal("new catalog should not be ready")
	}
	catalog.Rebuild(result, []string{root})
	if !catalog.Ready() {
		t.Fatal("rebuilt catalog should be ready")
	}

	public := catalog.PublicScanResult(result)
	if public.Root == root || public.Albums[0].Path == albumPath || public.Albums[0].CoverImage == filePath {
		t.Fatal("public snapshot leaked an absolute path")
	}
	if !strings.HasPrefix(public.Albums[0].Path, "a_") {
		t.Fatalf("album id=%q", public.Albums[0].Path)
	}
	resolved, ok := catalog.Resolve(public.Albums[0].CoverImage)
	if !ok || resolved != filePath {
		t.Fatalf("Resolve()=(%q,%v), want %q", resolved, ok, filePath)
	}
}

func TestResourceCatalog_RejectsOutsideRoot(t *testing.T) {
	root := t.TempDir()
	outside := filepath.Join(t.TempDir(), "secret.jpg")
	result := &models.ScanResult{Root: root, Roots: []string{root}, Albums: []models.Album{{
		Path:       filepath.Join(root, "album"),
		CoverImage: outside,
	}}}
	catalog := NewResourceCatalog()
	catalog.Rebuild(result, []string{root})
	if got := catalog.ExternalID(outside, ResourceFile); got != "" {
		t.Fatalf("outside path received id %q", got)
	}
}
