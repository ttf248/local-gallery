package middleware

import (
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

func TestValidatePath(t *testing.T) {
	root, _ := filepath.Abs("/safe/root")
	rootWithSep := root + string(os.PathSeparator)

	cases := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"inside", filepath.Join(root, "sub", "a.png"), false},
		{"exact root", root, false},
		{"relative", "sub/a.png", true},
		{"escape", filepath.Join(root, "..", "evil.png"), true},
		{"prefix-attack", "/safe/root-other/x.png", true},
		{"empty", "", true},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := validatePath(root, rootWithSep, c.path)
			if (err != nil) != c.wantErr {
				t.Fatalf("path=%q err=%v wantErr=%v", c.path, err, c.wantErr)
			}
		})
	}
}

func TestOpenInOS_Empty(t *testing.T) {
	if err := OpenInOS(""); err == nil {
		t.Fatal("want error for empty path")
	}
}

func TestOpenInOS_NotExist(t *testing.T) {
	if err := OpenInOS("/this/path/does/not/exist/zzz"); err == nil {
		t.Fatal("want error for missing path")
	}
}

// 跳过需要图形界面的真实打开调用（CI/headless 环境）。
func TestOpenInOS_SkipReal(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("不实际启动 explorer")
	}
}