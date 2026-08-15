// Package config 提供图像浏览器后端的 YAML 配置加载。
//
// 配置来源唯一：YAML 文件（默认 ./config.yaml，可用 --config 指定）。
// 未配置的字段走内置默认值；缓存目录默认在进程 CWD 下创建
// `.image-viewer/`（存放缩略图、扫描结果、用户偏好）。
//
// 字段优先级：YAML 文件中显式值 > 内置默认值。无任何 env / flag 覆盖。
package config

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"gopkg.in/yaml.v3"
)

// Version 后端版本号（编译期可通过 -ldflags 注入）。
var Version = "0.1.0"

// DefaultConfigName 未指定 --config 时查找的文件名（相对 CWD）。
const DefaultConfigName = "config.yaml"

// DefaultCacheDirName 未配置 cacheDir 时使用的目录名（创建在 CWD 下）。
const DefaultCacheDirName = ".image-viewer"

// Config 后端总配置（YAML 字段保持 camelCase）。
//
// MediaRoot 优先读取 `mediaRoot` 字段；为兼容老配置也接受
// `comicRoot` 字段（已弃用）。
type Config struct {
	MediaRoot       string `yaml:"mediaRoot"`
	LegacyComicRoot string // 通过二次解析填充，不走 yaml 标签
	Host            string `yaml:"host"`
	Port            int    `yaml:"port"`
	AllowOsOpen     bool   `yaml:"allowOsOpen"`
	CacheDir        string `yaml:"cacheDir"`
	ThumbSizeW      int    `yaml:"thumbSizeW"`
	ThumbSizeH      int    `yaml:"thumbSizeH"`
	CacheMaxAgeDays int    `yaml:"cacheMaxAgeDays"`
	StaticDir       string `yaml:"staticDir"`
}

// Root 返回实际使用的根目录（兼容老 comicRoot 字段）。
func (c *Config) Root() string {
	if c.MediaRoot != "" {
		return c.MediaRoot
	}
	return c.LegacyComicRoot
}

// HasLegacyRoot reports whether the source YAML used the deprecated comicRoot key.
// 即使合并后 MediaRoot 与 LegacyComicRoot 相同，只要后者非空即认为用户用了老字段。
func (c *Config) HasLegacyRoot() bool {
	return c.LegacyComicRoot != ""
}

// Default 返回内置默认配置（缓存目录指向 CWD/.image-viewer）。
func Default() *Config {
	return &Config{
		MediaRoot:       filepath.Join(".", "media"),
		Host:            "0.0.0.0",
		Port:            8080,
		AllowOsOpen:     false,
		CacheDir:        filepath.Join(".", DefaultCacheDirName),
		ThumbSizeW:      320,
		ThumbSizeH:      350,
		CacheMaxAgeDays: 30,
		StaticDir:       "dist",
	}
}

// LoadFile 从 YAML 配置文件加载并覆盖默认配置。
// 文件不存在不视为错误；解析失败或字段类型错误视为错误。
func LoadFile(path string) (*Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return cfg, nil
		}
		return nil, fmt.Errorf("read config file: %w", err)
	}

	// 第一次解析：标准字段
	tmp := &Config{}
	if err := yaml.Unmarshal(data, tmp); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	// 第二次解析：宽松 map，单独取 comicRoot 老字段
	raw := map[string]any{}
	if err := yaml.Unmarshal(data, &raw); err == nil {
		if v, ok := raw["comicRoot"].(string); ok && v != "" {
			tmp.LegacyComicRoot = v
		}
	}

	mergeFile(cfg, tmp)
	return cfg, nil
}

// mergeFile 把 file 中显式值合并到 dst。零值字段保持 dst 默认。
//
// bool 字段特殊处理：YAML 未设置时为零值 false；只要 file 显式给出
// true 即视为开启，false 视为未配置（沿用 dst 默认）。
//
// MediaRoot / LegacyComicRoot 的解析：
//   - file.MediaRoot 给值  → 用 file.MediaRoot，同时清空 dst.LegacyComicRoot
//   - 否则 file.LegacyComicRoot 给值 → 用 file.LegacyComicRoot（覆盖 dst.MediaRoot 默认值），
//     并保留 dst.LegacyComicRoot 以便后续 HasLegacyRoot() 报告
//   - 都没有 → 保持 dst 默认
func mergeFile(dst, file *Config) {
	switch {
	case file.MediaRoot != "":
		dst.MediaRoot = file.MediaRoot
		dst.LegacyComicRoot = ""
	case file.LegacyComicRoot != "":
		dst.MediaRoot = file.LegacyComicRoot
		dst.LegacyComicRoot = file.LegacyComicRoot
	}
	if file.Host != "" {
		dst.Host = file.Host
	}
	if file.Port != 0 {
		dst.Port = file.Port
	}
	if file.AllowOsOpen {
		dst.AllowOsOpen = true
	}
	if file.CacheDir != "" {
		dst.CacheDir = file.CacheDir
	}
	if file.ThumbSizeW != 0 {
		dst.ThumbSizeW = file.ThumbSizeW
	}
	if file.ThumbSizeH != 0 {
		dst.ThumbSizeH = file.ThumbSizeH
	}
	if file.CacheMaxAgeDays != 0 {
		dst.CacheMaxAgeDays = file.CacheMaxAgeDays
	}
	if file.StaticDir != "" {
		dst.StaticDir = file.StaticDir
	}
}

// Validate 校验配置合法性。Root 必须是已存在的目录。
func (c *Config) Validate() error {
	root := c.Root()
	if root == "" {
		return errors.New("mediaRoot is required (or legacy comicRoot)")
	}
	info, err := os.Stat(root)
	if err != nil {
		return fmt.Errorf("mediaRoot %q: %w", root, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("mediaRoot %q is not a directory", root)
	}
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("invalid port %d", c.Port)
	}
	if c.ThumbSizeW <= 0 || c.ThumbSizeH <= 0 {
		return errors.New("thumb size must be positive")
	}
	return nil
}

// Addr 返回监听地址 host:port。
func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}
