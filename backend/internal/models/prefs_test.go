package models

import "testing"

func TestPreferenceResourceIDValidation(t *testing.T) {
	albumID := "a_0000000000000000000000"
	collectionID := "c_0000000000000000000000"
	if !IsAlbumID(albumID) {
		t.Fatal("valid album ID was rejected")
	}
	for _, value := range []string{albumID, collectionID, "smart:旅行"} {
		if !IsFavoriteResourceID(value) {
			t.Fatalf("valid favorite resource ID was rejected: %q", value)
		}
	}
	for _, value := range []string{
		`C:\Users\reader\secret`,
		"a_short",
		"a_000000000000000000000!",
		"smart:",
		`smart:C:\Users\reader`,
		"smart:bad\nvalue",
	} {
		if IsFavoriteResourceID(value) {
			t.Fatalf("invalid favorite resource ID was accepted: %q", value)
		}
	}
}
