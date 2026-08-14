package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// resetEnv 在子测试间清理环境变量。
func resetEnv(t *testing.T) {
	t.Helper()
	envs := []string{
		"COMIC_ROOT", "COMIC_HOST", "COMIC_PORT",
		"COMIC_CACHE_DIR", "COMIC_THUMB_W", "COMIC_THUMB_H",
		"COMIC_CACHE_MAX_AGE_DAYS", "COMIC_ALLOW_OS_OPEN",
	}
	for _, e := range envs {
		os.Unsetenv(e)
	}
}

// writeTempJSON 写入临时 JSON 配置文件并返回路径。
func writeTempJSON(t *testing.T, content string) string {
	t.Helper()
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write temp config: %v", err)
	}
	return path
}

func TestDefault(t *testing.T) {
	d := Default()
	if d.ComicRoot == "" {
		t.Error("default ComicRoot must not be empty")
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
}

func TestLoadFile_MissingReturnsDefault(t *testing.T) {
	cfg, err := LoadFile(filepath.Join(t.TempDir(), "nope.json"))
	if err != nil {
		t.Fatalf("LoadFile should not error on missing file, got: %v", err)
	}
	d := Default()
	if cfg.ComicRoot != d.ComicRoot {
		t.Errorf("expected default ComicRoot, got %q", cfg.ComicRoot)
	}
}

func TestLoadFile_OverridesDefaults(t *testing.T) {
	path := writeTempJSON(t, `{
		"comicRoot": "D:\\manga",
		"port": 9090,
		"thumbSizeW": 210,
		"thumbSizeH": 280,
		"allowOsOpen": true
	}`)

	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.ComicRoot != "D:\\manga" {
		t.Errorf("comicRoot: got %q", cfg.ComicRoot)
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
}

func TestLoadFile_InvalidJSON(t *testing.T) {
	path := writeTempJSON(t, `{invalid json}`)
	_, err := LoadFile(path)
	if err == nil {
		t.Error("expected error on invalid JSON")
	}
}

func TestApplyEnv_OverridesFile(t *testing.T) {
	resetEnv(t)
	defer resetEnv(t)

	// 先从文件加载一个非默认 comicRoot
	path := writeTempJSON(t, `{"comicRoot": "from-file"}`)
	cfg, err := LoadFile(path)
	if err != nil {
		t.Fatalf("LoadFile: %v", err)
	}
	if cfg.ComicRoot != "from-file" {
		t.Fatalf("setup: expected from-file, got %q", cfg.ComicRoot)
	}

	// env 覆盖
	os.Setenv("COMIC_ROOT", "from-env")
	os.Setenv("COMIC_PORT", "7777")
	os.Setenv("COMIC_THUMB_W", "256")
	os.Setenv("COMIC_ALLOW_OS_OPEN", "true")
	ApplyEnv(cfg)

	if cfg.ComicRoot != "from-env" {
		t.Errorf("env should override file, got %q", cfg.ComicRoot)
	}
	if cfg.Port != 7777 {
		t.Errorf("port from env: got %d", cfg.Port)
	}
	if cfg.ThumbSizeW != 256 {
		t.Errorf("thumbW from env: got %d", cfg.ThumbSizeW)
	}
	if !cfg.AllowOsOpen {
		t.Error("allowOsOpen from env")
	}
}

func TestApplyEnv_InvalidPortIgnored(t *testing.T) {
	resetEnv(t)
	defer resetEnv(t)

	cfg := Default()
	os.Setenv("COMIC_PORT", "not-a-number")
	ApplyEnv(cfg)

	if cfg.Port != 8080 {
		t.Errorf("invalid env port should not change config, got %d", cfg.Port)
	}
}

func TestApplyEnv_BoolVariants(t *testing.T) {
	resetEnv(t)
	defer resetEnv(t)

	cases := []struct {
		val      string
		expected bool
	}{
		{"true", true},
		{"TRUE", true},
		{"1", true},
		{"false", false},
		{"0", false},
		{"yes", false}, // 仅 1/true/TRUE 视为 true
	}

	for _, tc := range cases {
		os.Setenv("COMIC_ALLOW_OS_OPEN", tc.val)
		cfg := Default()
		ApplyEnv(cfg)
		if cfg.AllowOsOpen != tc.expected {
			t.Errorf("COMIC_ALLOW_OS_OPEN=%q: expected %v, got %v",
				tc.val, tc.expected, cfg.AllowOsOpen)
		}
	}
}

func TestValidate(t *testing.T) {
	dir := t.TempDir()

	cases := []struct {
		name    string
		mutate  func(c *Config)
		wantErr bool
	}{
		{"empty_root", func(c *Config) { c.ComicRoot = "" }, true},
		{"missing_root", func(c *Config) { c.ComicRoot = filepath.Join(dir, "nope") }, true},
		{"file_not_dir", func(c *Config) {
			f := filepath.Join(dir, "f.txt")
			os.WriteFile(f, []byte("x"), 0o644)
			c.ComicRoot = f
		}, true},
		{"bad_port_low", func(c *Config) { c.Port = 0 }, true},
		{"bad_port_high", func(c *Config) { c.Port = 70000 }, true},
		{"bad_thumb_w", func(c *Config) { c.ThumbSizeW = 0 }, true},
		{"bad_thumb_h", func(c *Config) { c.ThumbSizeH = -1 }, true},
		{"ok", func(c *Config) { c.ComicRoot = dir }, false},
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

// 端到端模拟 main.go 中的合并顺序：file → env → flag(由调用方手动)。
func TestPriorityChain(t *testing.T) {
	resetEnv(t)
	defer resetEnv(t)

	dir := t.TempDir()
	cfgPath := filepath.Join(dir, "config.json")
	os.WriteFile(cfgPath, []byte(`{"comicRoot": "from-file"}`), 0o644)

	// 1) 文件
	cfg, err := LoadFile(cfgPath)
	if err != nil {
		t.Fatalf("file: %v", err)
	}
	if cfg.ComicRoot != "from-file" {
		t.Fatalf("file layer: %q", cfg.ComicRoot)
	}

	// 2) env 覆盖
	os.Setenv("COMIC_ROOT", "from-env")
	ApplyEnv(cfg)
	if cfg.ComicRoot != "from-env" {
		t.Fatalf("env layer: %q", cfg.ComicRoot)
	}

	// 3) flag 覆盖（模拟 main.go 中的 if *flag != ""）
	flagVal := "from-flag"
	cfg.ComicRoot = flagVal
	if cfg.ComicRoot != "from-flag" {
		t.Fatalf("flag layer: %q", cfg.ComicRoot)
	}
}

// 演示 JSON 编解码往返。
func TestJSONRoundTrip(t *testing.T) {
	src := Default()
	src.ComicRoot = "X:\\test"
	src.Port = 12345
	src.AllowOsOpen = true

	data, err := json.MarshalIndent(src, "", "  ")
	if err != nil {
		t.Fatal(err)
	}

	dst := Default()
	if err := json.Unmarshal(data, dst); err != nil {
		t.Fatal(err)
	}

	if dst.ComicRoot != src.ComicRoot ||
		dst.Port != src.Port ||
		dst.AllowOsOpen != src.AllowOsOpen {
		t.Errorf("round-trip mismatch: %+v vs %+v", src, dst)
	}
}
