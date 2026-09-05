//go:build windows

package config

import (
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/sys/windows"
)

func TestLoadFileProtectsWindowsDACL(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte("port: 8080\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := LoadFile(path); err != nil {
		t.Fatal(err)
	}
	descriptor, err := windows.GetNamedSecurityInfo(
		path,
		windows.SE_FILE_OBJECT,
		windows.DACL_SECURITY_INFORMATION|windows.OWNER_SECURITY_INFORMATION,
	)
	if err != nil {
		t.Fatal(err)
	}
	dacl, defaulted, err := descriptor.DACL()
	if err != nil {
		t.Fatal(err)
	}
	if defaulted || dacl == nil || dacl.AceCount != 1 {
		t.Fatalf("unexpected protected DACL: defaulted=%v acl=%#v", defaulted, dacl)
	}
	control, _, err := descriptor.Control()
	if err != nil {
		t.Fatal(err)
	}
	if control&windows.SE_DACL_PROTECTED == 0 {
		t.Fatalf("DACL is not protected: control=%#x", control)
	}
}
