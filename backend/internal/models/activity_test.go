package models

import (
	"encoding/json"
	"strings"
	"testing"
)

const (
	validActivityAlbumID = "a_0000000000000000000001"
	validActivityFileID  = "f_0000000000000000000001"
)

func TestNormalizeActivityImageDerivesStatus(t *testing.T) {
	active, err := NormalizeActivity(Activity{
		AlbumID:   validActivityAlbumID,
		MediaKind: MediaKindImage,
		PageIndex: 3,
		PageCount: 10,
		Status:    ActivityCompleted,
	})
	if err != nil {
		t.Fatal(err)
	}
	if active.Status != ActivityInProgress {
		t.Fatalf("status must be derived from page position, got %q", active.Status)
	}

	completed, err := NormalizeActivity(Activity{
		AlbumID:   validActivityAlbumID,
		MediaKind: MediaKindImage,
		PageIndex: 9,
		PageCount: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != ActivityCompleted {
		t.Fatalf("last page should be completed, got %q", completed.Status)
	}
}

func TestActivityJSONKeepsZeroPositions(t *testing.T) {
	image, err := json.Marshal(Activity{
		AlbumID: validActivityAlbumID, MediaKind: MediaKindImage, PageIndex: 0, PageCount: 10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(image), `"pageIndex":0`) {
		t.Fatalf("first image page was omitted: %s", image)
	}

	video, err := json.Marshal(Activity{
		AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo, ItemID: validActivityFileID,
		PositionMS: 0, DurationMS: 10_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(video), `"positionMs":0`) {
		t.Fatalf("video start position was omitted: %s", video)
	}
}

func TestNormalizeActivityVideoDerivesStatusAtNinetyEightPercent(t *testing.T) {
	active, err := NormalizeActivity(Activity{
		AlbumID:    validActivityAlbumID,
		MediaKind:  MediaKindVideo,
		ItemID:     validActivityFileID,
		PositionMS: 97_999,
		DurationMS: 100_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if active.Status != ActivityInProgress {
		t.Fatalf("97.999%% should remain in progress, got %q", active.Status)
	}

	completed, err := NormalizeActivity(Activity{
		AlbumID:    validActivityAlbumID,
		MediaKind:  MediaKindVideo,
		ItemID:     validActivityFileID,
		PositionMS: 98_000,
		DurationMS: 100_000,
	})
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != ActivityCompleted {
		t.Fatalf("98%% should be completed, got %q", completed.Status)
	}
}

func TestNormalizeActivityRejectsMixedOrPathData(t *testing.T) {
	tests := []Activity{
		{AlbumID: `C:\\secret`, MediaKind: MediaKindImage, PageCount: 1},
		{AlbumID: validActivityAlbumID, MediaKind: MediaKindImage, ItemID: validActivityFileID, PageCount: 1},
		{AlbumID: validActivityAlbumID, MediaKind: MediaKindImage, PageIndex: 1, PageCount: 1},
		{AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo, ItemID: `C:\\secret`, DurationMS: 1},
		{AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo, ItemID: validActivityFileID, PageCount: 1, DurationMS: 1},
		{AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo, ItemID: validActivityFileID, PositionMS: 2, DurationMS: 1},
	}
	for i, activity := range tests {
		if _, err := NormalizeActivity(activity); err == nil {
			t.Fatalf("case %d accepted invalid activity: %+v", i, activity)
		}
	}
}

func TestActivityIdentityKeySeparatesMediaAndVideoItems(t *testing.T) {
	imageKey, imageOK := (ActivityIdentity{AlbumID: validActivityAlbumID, MediaKind: MediaKindImage}).Key()
	videoKey, videoOK := (ActivityIdentity{
		AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo, ItemID: validActivityFileID,
	}).Key()
	if !imageOK || !videoOK || imageKey == videoKey {
		t.Fatalf("unexpected keys: image=%q video=%q", imageKey, videoKey)
	}
	if _, ok := (ActivityIdentity{AlbumID: validActivityAlbumID, MediaKind: MediaKindVideo}).Key(); ok {
		t.Fatal("video identity without itemId was accepted")
	}
}
