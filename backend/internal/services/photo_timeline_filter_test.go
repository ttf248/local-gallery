package services

import "testing"

func TestPhotoTimelineFilterBySourceAndPrecision(t *testing.T) {
	f := newTimelineFixture(t)
	f.seedCaptureTime(t, f.files[f.ids["名字带日期"]], "2024-03-05T09:00:00")
	s := f.service()
	snap := f.catalog.Acquire()
	base, err := s.Page(snap, MediaFeedQuery{}, "", 100)
	if err != nil {
		t.Fatal(err)
	}
	for _, source := range []string{"exif", "filename", "folder", "modified"} {
		for _, precision := range []string{"day", "month", "year", "unknown"} {
			q := MediaFeedQuery{DateSource: source, DatePrecision: precision}
			want := map[string]bool{}
			for _, item := range base.Items {
				if item.DateSource == source && item.DatePrecision == precision {
					want[item.ID] = true
				}
			}
			cursor := ""
			seen := map[string]bool{}
			for {
				page, err := s.Page(snap, q, cursor, 1)
				if err != nil || page.Total != len(want) {
					t.Fatalf("%+v total=%d want=%d %v", q, page.Total, len(want), err)
				}
				for _, item := range page.Items {
					if seen[item.ID] || !want[item.ID] {
						t.Fatalf("unexpected item %+v", item)
					}
					seen[item.ID] = true
				}
				if page.NextCursor == "" {
					break
				}
				cursor = page.NextCursor
			}
			if len(seen) != len(want) {
				t.Fatal("missing items")
			}
		}
	}
	page, err := s.Page(snap, MediaFeedQuery{Year: "2024", DateSource: "modified"}, "", 50)
	if err != nil || page.Total != 0 {
		t.Fatalf("unknown dates in year: %+v %v", page, err)
	}
	for _, q := range []MediaFeedQuery{{DateSource: "anything"}, {DatePrecision: "minute"}} {
		if _, err := s.Page(snap, q, "", 20); err == nil {
			t.Fatal("invalid filter accepted")
		}
	}
}
