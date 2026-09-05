package services

import (
	"errors"
	"testing"
)

func TestPageCursorRoundTripAndBindings(t *testing.T) {
	cursor, err := EncodePageCursor(42, "album:a_123:media", 120)
	if err != nil {
		t.Fatal(err)
	}
	offset, err := DecodePageCursor(cursor, 42, "album:a_123:media")
	if err != nil || offset != 120 {
		t.Fatalf("DecodePageCursor()=(%d, %v), want (120, nil)", offset, err)
	}
	if _, err := DecodePageCursor(cursor, 42, "tags"); !errors.Is(err, ErrInvalidPageCursor) {
		t.Fatalf("scope mismatch error=%v, want ErrInvalidPageCursor", err)
	}
	if _, err := DecodePageCursor(cursor, 43, "album:a_123:media"); !errors.Is(err, ErrStalePageCursor) {
		t.Fatalf("revision mismatch error=%v, want ErrStalePageCursor", err)
	}
}

func TestPageCursorRejectsMalformedOrTamperedInput(t *testing.T) {
	cursor, err := EncodePageCursor(7, "tags", 60)
	if err != nil {
		t.Fatal(err)
	}
	tampered := []byte(cursor)
	if tampered[0] == 'A' {
		tampered[0] = 'B'
	} else {
		tampered[0] = 'A'
	}
	for _, raw := range []string{"", "not-a-cursor", string(tampered), cursor + ".extra"} {
		if _, err := DecodePageCursor(raw, 7, "tags"); !errors.Is(err, ErrInvalidPageCursor) {
			t.Fatalf("DecodePageCursor(%q) error=%v, want ErrInvalidPageCursor", raw, err)
		}
	}
}
