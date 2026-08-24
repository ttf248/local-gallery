package config

import (
	"os"
	"path/filepath"
	"testing"
)

// writeTempYAML 写入临时 YAML 配置文件并返回路径。
func writeTempYAML(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

func TestDefault(t *testing.T) {
	d := Default()
	if d.MediaRoot == "" {
		t.Error("default MediaRoot must not be empty")
	}
	if d.Port <= 0 || d.Port > 65535 {
		t.Errorf("default Port out of range: %d", d.Port)
	}
	if d.ThumbSizeW <= 0 || d.ThumbSizeH <= 0 {
		t.Error("default thumb size must be positive")
	}
	if d.CacheMaxAgeDays <= 0 {
		t.Error("default cache max age must be positive")
	}
	if filepath.Base(d.CacheDir) != DefaultCacheDirName {
		t.Errorf("default CacheDir must end with %q, got %q",
			DefaultCacheDirName, d.CacheDir)
	}
	if d.StaticDir == "" {
		t.Error("default StaticDir must not be empty")
	}
}

func TestLoadFile_MissingReturnsDefault(t *testing.T) {
	cfg, err := LoadFile(filepath.Join(t.TempDir(), "nope.yaml"))
	if err != nil {
		t.Fatalf("LoadFile should not error on missing file, got: %v", err)
	}
	d := Default()
	if cfg.MediaRoot != d.MediaRoot {
		t.Errorf("expected default MediaRoot, got %q", cfg.MediaRoot)
	}
}

func TestLoadFile_OverridesDefaults(t *testing.T) {
	path := writeTempYAML(t, `
mediaRoot: D:\photos
port: 9090
thumbSizeW: 210
thumbSizeH: 280
allowOsOpen: true
cacheDir: D:\custom-cache
staticDir: build/web
`)

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.MediaRoot != "D:\\photos" {
		t.Errorf("mediaRoot: got %q", cfg.MediaRoot)
	}
	if cfg.Port != 9090 {
		t.Errorf("port: got %d", cfg.Port)
	}
	if cfg.ThumbSizeW != 210 || cfg.ThumbSizeH != 280 {
		t.Errorf("thumb size: got %dx%d", cfg.ThumbSizeW, cfg.ThumbSizeH)
	}
	if !cfg.AllowOsOpen {
		t.Error("allowOsOpen should be true from file")
	}
	if cfg.CacheDir != "D:\\custom-cache" {
		t.Errorf("cacheDir: got %q", cfg.CacheDir)
	}
	if cfg.StaticDir != "build/web" {
		t.Errorf("staticDir: got %q", cfg.StaticDir)
	}
}

// 老配置中只有 comicRoot 字段时，应被识别为 Root()。
func TestLoadFile_LegacyComicRoot(t *testing.T) {
	path := writeTempYAML(t, `
comicRoot: D:\legacy
port: 7070
`)

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.LegacyComicRoot != "D:\\legacy" {
		t.Errorf("LegacyComicRoot: got %q", cfg.LegacyComicRoot)
	}
	if cfg.Root() != "D:\\legacy" {
		t.Errorf("Root(): got %q", cfg.Root())
	}
	if !cfg.HasLegacyRoot() {
		t.Error("HasLegacyRoot should be true")
	}
}

// 同时给出 mediaRoot 和 comicRoot 时，以 mediaRoot 为准。
func TestLoadFile_MediaRootWinsOverComicRoot(t *testing.T) {
	path := writeTempYAML(t, `
mediaRoot: D:\new
comicRoot: D:\old
`)

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.MediaRoot != "D:\\new" {
		t.Errorf("MediaRoot: got %q", cfg.MediaRoot)
	}
	if cfg.Root() != "D:\\new" {
		t.Errorf("Root() should prefer MediaRoot, got %q", cfg.Root())
	}
	if cfg.HasLegacyRoot() {
		t.Error("HasLegacyRoot should be false when MediaRoot is set")
	}
}

func TestLoadFile_PartialOverrides(t *testing.T) {
	// 只覆盖一个字段，其余应保持 Default()
	path := writeTempYAML(t, `port: 9090`)

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.Port != 9090 {
		t.Errorf("port: got %d", cfg.Port)
	}
	d := Default()
	if cfg.Host != d.Host {
		t.Errorf("host should keep default, got %q", cfg.Host)
	}
	if cfg.ThumbSizeW != d.ThumbSizeW {
		t.Errorf("thumbSizeW should keep default")
	}
}

func TestLoadFile_InvalidYAML(t *testing.T) {
	path := writeTempYAML(t, `port: "not closed`)
	_, err := LoadFile(path)
	if err == nil {
		t.Error("expected error on invalid YAML")
	}
}

func TestValidate(t *testing.T) {
	dir := t.TempDir()

	cases := []struct {
		name    string
		mutate  func(c *Config)
		wantErr bool
	}{
		{"empty_root", func(c *Config) { c.MediaRoot = ""; c.LegacyComicRoot = "" }, true},
		{"missing_root", func(c *Config) { c.MediaRoot = filepath.Join(dir, "nope") }, true},
		{"legacy_root_works", func(c *Config) {
			c.MediaRoot = ""
			c.LegacyComicRoot = dir
		}, false},
		{"file_not_dir", func(c *Config) {
			f := filepath.Join(dir, "f.txt")
			os.WriteFile(f, []byte("x"), 0o644)
			c.MediaRoot = f
		}, true},
		{"bad_port_low", func(c *Config) { c.Port = 0 }, true},
		{"bad_port_high", func(c *Config) { c.Port = 70000 }, true},
		{"bad_thumb_w", func(c *Config) { c.ThumbSizeW = 0 }, true},
		{"bad_thumb_h", func(c *Config) { c.ThumbSizeH = -1 }, true},
		{"ok", func(c *Config) { c.MediaRoot = dir }, false},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := Default()
			tc.mutate(cfg)
			err := cfg.Validate()
			if tc.wantErr && err == nil {
				t.Errorf("expected error, got nil")
			}
			if !tc.wantErr && err != nil {
				t.Errorf("unexpected error: %v", err)
			}
		})
	}
}

func TestAddr(t *testing.T) {
	c := &Config{Host: "127.0.0.1", Port: 9090}
	if got := c.Addr(); got != "127.0.0.1:9090" {
		t.Errorf("Addr: got %q", got)
	}
}

// 默认缓存目录应使用 .local-gallery；不依赖环境变量。
func TestDefault_CacheDirIsRuntimeRelative(t *testing.T) {
	cfg := Default()
	if filepath.Base(cfg.CacheDir) != DefaultCacheDirName {
		t.Errorf("CacheDir must end with %q, got %q",
			DefaultCacheDirName, cfg.CacheDir)
	}
}
