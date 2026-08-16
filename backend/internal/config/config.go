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
// 媒体根支持多目录：
//   - 优先使用 `mediaRoots` 数组字段（推荐）
//   - 为兼容老配置也接受 `mediaRoot` 单数字段，扫描时自动视为单元素数组
//   - 也支持老 `comicRoot` 字段（已弃用）
//
// 单数 `MediaRoot` 字段在内部等于 MediaRoots 的首元素；保留它只是为了不破坏
// 旧版 patch / handler 的局部访问。建议新代码统一用 Roots()。
type Config struct {
	MediaRoots      []string `yaml:"mediaRoots"`
	MediaRoot       string   `yaml:"-"` // 由 MediaRoots 派生（首元素），不写盘
	LegacyComicRoot string   // 通过二次解析填充，不走 yaml 标签
	LegacyMediaRoot string   // 老的单数 mediaRoot 字段，过渡期兼容
	Host            string   `yaml:"host"`
	Port            int      `yaml:"port"`
	AllowOsOpen     bool     `yaml:"allowOsOpen"`
	CacheDir        string   `yaml:"cacheDir"`
	ThumbSizeW      int      `yaml:"thumbSizeW"`
	ThumbSizeH      int      `yaml:"thumbSizeH"`
	ThumbCacheSize  int      `yaml:"thumbCacheSize"`
	CacheMaxAgeDays int      `yaml:"cacheMaxAgeDays"`
	StaticDir       string   `yaml:"staticDir"`
}

// Roots 返回规范化后的所有媒体根目录（绝对路径、去空、去重、保序）。
//
// 优先级：MediaRoots 数组 > LegacyComicRoot 单字段（单元素适配）。
// 永远返回非 nil 切片（避免下游 nil 检查）。
func (c *Config) Roots() []string {
	out := make([]string, 0, len(c.MediaRoots))
	seen := make(map[string]bool, len(c.MediaRoots))
	for _, r := range c.MediaRoots {
		r = filepath.Clean(r)
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		out = append(out, r)
	}
	return out
}

// Root 返回第一个根目录。等价于 Roots()[0]；只在至少有一个根时非空。
// 保留为向后兼容的便捷方法；新代码应优先用 Roots()。
func (c *Config) Root() string {
	rs := c.Roots()
	if len(rs) == 0 {
		return ""
	}
	return rs[0]
}

// HasLegacyRoot reports whether the source YAML used the deprecated comicRoot key.
// 即使合并后 MediaRoot 与 LegacyComicRoot 相同，只要后者非空即认为用户用了老字段。
func (c *Config) HasLegacyRoot() bool {
	return c.LegacyComicRoot != ""
}

// syncFirstRoot 把 MediaRoots[0] 同步到 MediaRoot 字段，调用方应在 Root() 之前
// 调用。Marshal 时也需要再次同步以保证序列化结果正确。
func (c *Config) syncFirstRoot() {
	c.MediaRoot = ""
	rs := c.Roots()
	if len(rs) > 0 {
		c.MediaRoot = rs[0]
	}
}

// Default 返回内置默认配置（缓存目录指向 CWD/.image-viewer）。
func Default() *Config {
	c := &Config{
		MediaRoots:      []string{filepath.Join(".", "media")},
		Host:            "0.0.0.0",
		Port:            8080,
		AllowOsOpen:     false,
		CacheDir:        filepath.Join(".", DefaultCacheDirName),
		ThumbSizeW:      320,
		ThumbSizeH:      350,
		ThumbCacheSize:  500,
		CacheMaxAgeDays: 30,
		StaticDir:       "dist",
	}
	c.syncFirstRoot()
	return c
}

// LoadFile 从 YAML 配置文件加载并覆盖默认配置。
// 文件不存在不视为错误；解析失败或字段类型错误视为错误。
func LoadFile(path string) (*Config, error) {
	cfg := Default()

	data, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			cfg.syncFirstRoot()
			return cfg, nil
		}
		return nil, fmt.Errorf("read config file: %w", err)
	}

	// 第一次解析：标准字段
	tmp := &Config{}
	if err := yaml.Unmarshal(data, tmp); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	// 第二次解析：宽松 map，单独取老字段（comicRoot 兼容）。
	// mediaRoot 单数字段也兼容：临时存到 tmp.LegacyMediaRoot（一个不被
	// mergeFile 当作"显式新格式"看待的字段），Validate 时合并校验。
	raw := map[string]any{}
	if err := yaml.Unmarshal(data, &raw); err == nil {
		if v, ok := raw["mediaRoot"].(string); ok && v != "" {
			tmp.LegacyMediaRoot = v
		}
		if v, ok := raw["comicRoot"].(string); ok && v != "" {
			tmp.LegacyComicRoot = v
		}
	}

	mergeFile(cfg, tmp)
	cfg.syncFirstRoot()
	return cfg, nil
}

// mergeFile 把 file 中显式值合并到 dst。零值字段保持 dst 默认。
//
// bool 字段特殊处理：YAML 未设置时为零值 false；只要 file 显式给出
// true 即视为开启，false 视为未配置（沿用 dst 默认）。
//
// MediaRoots 解析（按优先级）：
//   - file.MediaRoots 非空 → 用 file.MediaRoots，清空所有 legacy 标记
//   - 否则 file.LegacyMediaRoot 给值（老 mediaRoot 单数）→ 单元素，
//     清空 LegacyComicRoot（更老的 comicRoot 不应同时生效）
//   - 否则 file.LegacyComicRoot 给值 → 单元素，保留 LegacyComicRoot
//   - 都没有 → 保持 dst 默认
func mergeFile(dst, file *Config) {
	switch {
	case len(file.MediaRoots) > 0:
		dst.MediaRoots = append([]string(nil), file.MediaRoots...)
		dst.LegacyComicRoot = ""
		dst.LegacyMediaRoot = ""
	case file.LegacyMediaRoot != "":
		dst.MediaRoots = []string{file.LegacyMediaRoot}
		dst.LegacyMediaRoot = file.LegacyMediaRoot
		dst.LegacyComicRoot = ""
	case file.LegacyComicRoot != "":
		dst.MediaRoots = []string{file.LegacyComicRoot}
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
	if file.ThumbCacheSize > 0 {
		dst.ThumbCacheSize = file.ThumbCacheSize
	}
	if file.StaticDir != "" {
		dst.StaticDir = file.StaticDir
	}
}

// Validate 校验配置合法性。所有根必须存在。
//
// 根集合解析顺序（高优先级覆盖低优先级）：
//  1. c.LegacyComicRoot（最老的 comicRoot 单数字段）
//  2. c.LegacyMediaRoot（老 mediaRoot 单数字段）
//  3. c.MediaRoot（显式单数）
//  4. c.MediaRoots（数组，默认值）
//
// 单数字段显式设置时覆盖数组默认值；这是"老配置文件"语义的延续
// （用户写 mediaRoot/comicRoot 即表示"我只要一个根"）。
func (c *Config) Validate() error {
	roots := c.resolveRootsForValidate()
	if len(roots) == 0 {
		return errors.New("mediaRoots is required (or legacy comicRoot / mediaRoot)")
	}
	for _, r := range roots {
		info, err := os.Stat(r)
		if err != nil {
			return fmt.Errorf("mediaRoot %q: %w", r, err)
		}
		if !info.IsDir() {
			return fmt.Errorf("mediaRoot %q is not a directory", r)
		}
	}
	if c.Port <= 0 || c.Port > 65535 {
		return fmt.Errorf("invalid port %d", c.Port)
	}
	if c.ThumbSizeW <= 0 || c.ThumbSizeH <= 0 {
		return errors.New("thumb size must be positive")
	}
	return nil
}

// resolveRootsForValidate 按优先级选 roots（Validate 专用）。
//
// 优先级：legacy 单数字段 > 显式单数 > 数组。这样单数字段显式
// 设置时（典型场景：测试 mutate 字段、老配置文件）会覆盖默认数组。
// 注意：syncFirstRoot 之后 MediaRoot == MediaRoots[0]，不会冲突。
func (c *Config) resolveRootsForValidate() []string {
	if c.LegacyComicRoot != "" {
		return []string{c.LegacyComicRoot}
	}
	if c.LegacyMediaRoot != "" {
		return []string{c.LegacyMediaRoot}
	}
	if c.MediaRoot != "" {
		return []string{c.MediaRoot}
	}
	if len(c.MediaRoots) > 0 {
		return c.Roots()
	}
	return nil
}

// Addr 返回监听地址 host:port。
func (c *Config) Addr() string {
	return fmt.Sprintf("%s:%d", c.Host, c.Port)
}
