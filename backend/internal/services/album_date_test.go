package services

import (
	"path/filepath"
	"testing"
	"time"
)

func TestResolveAlbumDatePrecedence(t *testing.T) {
	captured := time.Date(2023, 5, 4, 9, 30, 0, 0, time.UTC)
	modified := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	got, source := resolveAlbumDate(filepath.Join("library", "2024-08-17"), captured, nil, modified)
	if !got.Equal(captured) || source != "captured" {
		t.Fatalf("got (%v, %q), want captured (%v)", got, source, captured)
	}
}

func TestResolveAlbumDateUsesStrictFolderDate(t *testing.T) {
	modified := time.Date(2025, 1, 2, 0, 0, 0, 0, time.UTC)
	tests := []struct {
		path string
		want string
	}{
		{filepath.Join("library", "2024-08-17"), "2024-08-17"},
		{filepath.Join("library", "20240818"), "2024-08-18"},
		{filepath.Join("library", "2022", "07", "09"), "2022-07-09"},
		{filepath.Join("library", "2021_11"), "2021-11-01"},
	}
	for _, tt := range tests {
		t.Run(tt.want, func(t *testing.T) {
			got, source := resolveAlbumDate(tt.path, time.Time{}, nil, modified)
			if got.Format("2006-01-02") != tt.want || source != "folder" {
				t.Fatalf("got (%v, %q), want (%s, folder)", got, source, tt.want)
			}
		})
	}
}

func TestResolveAlbumDateRejectsEmbeddedOrInvalidDates(t *testing.T) {
	dirModified := time.Date(2020, 2, 3, 0, 0, 0, 0, time.UTC)
	fileModified := time.Date(2021, 4, 5, 0, 0, 0, 0, time.UTC)
	for _, path := range []string{
		filepath.Join("library", "trip-2024-08-17"),
		filepath.Join("library", "2024-02-31"),
	} {
		got, source := resolveAlbumDate(path, time.Time{}, []fileEntry{{modTime: fileModified}}, dirModified)
		if !got.Equal(fileModified) || source != "modified" {
			t.Fatalf("path %q: got (%v, %q), want modified (%v)", path, got, source, fileModified)
		}
	}
}
