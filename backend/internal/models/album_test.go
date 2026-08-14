package models

import "testing"

func TestIsImageFile(t *testing.T) {
	cases := []struct {
		name string
		want bool
	}{
		// 正例
		{"a.jpg", true},
		{"a.JPG", true},
		{"a.jpeg", true},
		{"a.png", true},
		{"a.PNG", true},
		{"a.gif", true},
		{"a.bmp", true},
		{"a.webp", true},
		{"a.tiff", true},
		{"a.tif", true},
		{"page-001.jpg", true},
		// 反例
		{"a.txt", false},
		{"a", false},
		{".jpg", false},
		{"", false},
		{"noext", false},
		{"a.tar.gz", false},
		{"a.mp4", false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := IsImageFile(tc.name); got != tc.want {
				t.Errorf("IsImageFile(%q) = %v, want %v", tc.name, got, tc.want)
			}
		})
	}
}

func TestLowerExt(t *testing.T) {
	cases := []struct {
		in, want string
	}{
		{"a.JPG", ".jpg"},
		{"page.Png", ".png"},
		{"no.ext.here", ".here"},
		{"noext", ""},
	}
	for _, tc := range cases {
		if got := lowerExt(tc.in); got != tc.want {
			t.Errorf("lowerExt(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
