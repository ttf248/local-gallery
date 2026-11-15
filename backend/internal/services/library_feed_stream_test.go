package services

import (
	"testing"
)

// streamPage 取随机长流的一页。
func streamPage(t *testing.T, fixture mediaFeedFixture, seed, cursor string, limit int) MediaFeedPage {
	t.Helper()
	snapshot := fixture.catalog.Acquire()
	page, err := PageMediaFeed(snapshot, MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedStream, Seed: seed,
	}, cursor, limit)
	if err != nil {
		t.Fatalf("PageMediaFeed() error = %v", err)
	}
	return page
}

func streamIDs(page MediaFeedPage) []string {
	ids := make([]string, 0, len(page.Items))
	for _, item := range page.Items {
		ids = append(ids, item.ID)
	}
	return ids
}

func TestMediaFeedStreamPagesThroughWholeLibrary(t *testing.T) {
	fixture := newMediaFeedFixture(t)

	seen := map[string]int{}
	collected := 0
	cursor := ""
	for page := 0; page < 10 && collected < 6; page++ {
		result := streamPage(t, fixture, "seed-1", cursor, 2)
		for _, item := range result.Items {
			seen[item.ID]++
			collected++
		}
		cursor = result.NextCursor
	}

	// 一圈是全库每张照片各一次：库里六张，翻完一圈正好六张，且不重不漏。
	if collected != 6 {
		t.Fatalf("stream items = %d, want 6", collected)
	}
	for id, count := range seen {
		if count != 1 {
			t.Fatalf("photo %s appeared %d times in one cycle", id, count)
		}
	}

	// 走完一圈也不结束：小库也得有的滑，长流会绕圈继续给照片。
	next := streamPage(t, fixture, "seed-1", cursor, 2)
	if len(next.Items) == 0 {
		t.Fatal("stream ended after one cycle")
	}
	if next.NextCursor == "" {
		t.Fatal("stream has no cursor after one cycle")
	}
}

func TestMediaFeedStreamKeepsPagesDisjoint(t *testing.T) {
	fixture := newMediaFeedFixture(t)

	first := streamPage(t, fixture, "seed-1", "", 2)
	second := streamPage(t, fixture, "seed-1", first.NextCursor, 2)
	if first.NextCursor == "" {
		t.Fatal("first page has no next cursor")
	}
	for _, id := range streamIDs(second) {
		for _, seen := range streamIDs(first) {
			if id == seen {
				t.Fatalf("photo %s appeared in two consecutive pages", id)
			}
		}
	}
}

func TestMediaFeedStreamSeedIsReproducibleAndChangesWithSeed(t *testing.T) {
	fixture := newMediaFeedFixture(t)

	first := streamIDs(streamPage(t, fixture, "seed-a", "", 3))
	again := streamIDs(streamPage(t, fixture, "seed-a", "", 3))
	if len(first) != len(again) {
		t.Fatalf("same seed returned %d then %d items", len(first), len(again))
	}
	for i := range first {
		if first[i] != again[i] {
			t.Fatalf("same seed gave different order: %v vs %v", first, again)
		}
	}

	other := streamIDs(streamPage(t, fixture, "seed-b", "", 3))
	same := true
	for i := range first {
		if i < len(other) && first[i] != other[i] {
			same = false
		}
	}
	if same {
		t.Fatalf("different seeds gave the same order: %v", other)
	}
}

func TestMediaFeedStreamItemsKeepTheirAlbum(t *testing.T) {
	fixture := newMediaFeedFixture(t)

	page := streamPage(t, fixture, "seed-1", "", 6)
	for _, item := range page.Items {
		if item.AlbumID == "" || item.AlbumName == "" {
			t.Fatalf("stream item lost its album: %+v", item)
		}
	}
	if len(page.Albums) == 0 {
		t.Fatal("stream page reports no source albums")
	}
	for _, album := range page.Albums {
		if album.Count <= 0 {
			t.Fatalf("stream page reports an empty album: %+v", album)
		}
	}
}

func TestMediaFeedStreamRejectsForeignCursor(t *testing.T) {
	fixture := newMediaFeedFixture(t)

	if _, err := PageMediaFeed(fixture.catalog.Acquire(), MediaFeedQuery{
		Kind: LibraryKindPhoto, Scope: MediaFeedStream, Seed: "seed-1",
	}, "not-a-cursor", 10); err == nil {
		t.Fatal("PageMediaFeed() accepted a foreign cursor")
	}
}
