package services

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

func TestApplyCoverOverridesToResultUpdatesEveryView(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(albumPath, "1.jpg")
	custom := filepath.Join(albumPath, "2.jpg")
	for _, path := range []string{first, custom} {
		if err := os.WriteFile(path, []byte("image"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	album := models.Album{
		Path: albumPath, ImageFiles: []string{first, custom}, CoverImage: first, CoverKind: "image",
	}
	result := &models.ScanResult{
		Roots: []string{root}, Albums: []models.Album{album},
		SmartCollections: []models.SmartCollection{{
			Tag: "tag", CoverImage: first, Albums: []models.Album{album},
		}},
	}

	next, applied := ApplyCoverOverridesToResult(result, map[string]CoverOverride{
		albumPath: {File: custom},
	})
	if applied != 1 {
		t.Fatalf("applied=%d", applied)
	}
	if next.Albums[0].CoverImage != custom || next.SmartCollections[0].Albums[0].CoverImage != custom {
		t.Fatal("override was not applied to album and smart views")
	}
	if next.SmartCollections[0].CoverImage != custom {
		t.Fatal("smart collection cover did not follow overridden album cover")
	}
	if result.Albums[0].CoverImage != first {
		t.Fatal("input scan result was mutated")
	}
}

func TestApplyCoverOverridesToResultRejectsUnindexedFile(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	if err := os.MkdirAll(albumPath, 0o755); err != nil {
		t.Fatal(err)
	}
	first := filepath.Join(albumPath, "1.jpg")
	unknown := filepath.Join(albumPath, "not-scanned.jpg")
	for _, path := range []string{first, unknown} {
		if err := os.WriteFile(path, []byte("image"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	result := &models.ScanResult{Albums: []models.Album{{
		Path: albumPath, ImageFiles: []string{first}, CoverImage: first,
	}}}

	next, applied := ApplyCoverOverridesToResult(result, map[string]CoverOverride{
		albumPath: {File: unknown},
	})
	if applied != 0 || next.Albums[0].CoverImage != first {
		t.Fatalf("unindexed file was accepted: applied=%d cover=%q", applied, next.Albums[0].CoverImage)
	}
}

func TestRebuildCoverViewClearsPreviousOverride(t *testing.T) {
	root := t.TempDir()
	albumPath := filepath.Join(root, "album")
	first := filepath.Join(albumPath, "1.jpg")
	custom := filepath.Join(albumPath, "2.jpg")
	alreadyOverridden := &models.ScanResult{
		Albums: []models.Album{{
			Path: albumPath, ImageFiles: []string{first, custom}, CoverImage: custom, CoverKind: "image",
		}},
		SmartCollections: []models.SmartCollection{{
			CoverImage: custom,
			Albums: []models.Album{{
				Path: albumPath, ImageFiles: []string{first, custom}, CoverImage: custom, CoverKind: "image",
			}},
		}},
	}

	next, applied := RebuildCoverView(alreadyOverridden, nil)
	if applied != 0 || next.Albums[0].CoverImage != first || next.SmartCollections[0].CoverImage != first {
		t.Fatalf("cover view did not reset to defaults: %+v", next)
	}
}
