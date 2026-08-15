// Package config 提供漫画阅读器后端的 YAML 配置加载。
//
// 配置来源唯一：YAML 文件（默认 ./config.yaml，可用 --config 指定）。
// 未配置的字段走内置默认值；缓存目录默认在进程 CWD 下创建
// `.comic-reader/`（存放缩略图、扫描结果、用户偏好）。
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
const DefaultCacheDirName = ".comic-reader"

// Config 后端总配置（YAML 字段保持 camelCase，与历史 JSON 字段一致）。
type Config struct {
	ComicRoot       string `yaml:"comicRoot"`
	Host            string `yaml:"host"`
	Port            int    `yaml:"port"`
	AllowOsOpen     bool   `yaml:"allowOsOpen"`
	CacheDir        string `yaml:"cacheDir"`
	ThumbSizeW      int    `yaml:"thumbSizeW"`
	ThumbSizeH      int    `yaml:"thumbSizeH"`
	CacheMaxAgeDays int    `yaml:"cacheMaxAgeDays"`
	StaticDir       string `yaml:"staticDir"`
}

// Default 返回内置默认配置（缓存目录指向 CWD/.comic-reader）。
func Default() *Config {
	return &Config{
		ComicRoot:       filepath.Join(".", "comics"),
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

	tmp := &Config{}
	if err := yaml.Unmarshal(data, tmp); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	mergeFile(cfg, tmp)
	return cfg, nil
}

// mergeFile 把 file 中显式值合并到 dst。零值字段保持 dst 默认。
//
// bool 字段特殊处理：YAML 未设置时为零值 false；只要 file 显式给出
// true 即视为开启，false 视为未配置（沿用 dst 默认），这与历史 JSON
// 行为一致（AllowOsOpen bool 零值也是有意义的，保留）。
func mergeFile(dst, file *Config) {
	if file.ComicRoot != "" {
		dst.ComicRoot = file.ComicRoot
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

// Validate 校验配置合法性。ComicRoot 必须是已存在的目录。
func (c *Config) Validate() error {
	if c.ComicRoot == "" {
		return errors.New("comicRoot is required")
	}
	info, err := os.Stat(c.ComicRoot)
	if err != nil {
		return fmt.Errorf("comicRoot %q: %w", c.ComicRoot, err)
	}
	if !info.IsDir() {
		return fmt.Errorf("comicRoot %q is not a directory", c.ComicRoot)
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