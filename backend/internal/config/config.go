// Package config 提供漫画阅读器后端的配置加载。
//
// 加载优先级（从高到低）：
//   1. 命令行 flag（--comic-root 等）
//   2. 环境变量（COMIC_ROOT 等）
//   3. 配置文件（backend/config.json 字段 comicRoot 等）
//   4. 内置默认值
//
// T2 阶段：基础结构 + 默认值。
// T3 阶段：完善 flag/env/file/default 四层合并与校验。
package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
)

// Version 后端版本号（编译期可通过 -ldflags 注入）。
var Version = "0.1.0"

// Config 后端总配置。
type Config struct {
	ComicRoot       string `json:"comicRoot"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	AllowOsOpen     bool   `json:"allowOsOpen"`
	CacheDir        string `json:"cacheDir"`
	ThumbSizeW      int    `json:"thumbSizeW"`
	ThumbSizeH      int    `json:"thumbSizeH"`
	CacheMaxAgeDays int    `json:"cacheMaxAgeDays"`
}

// Default 返回内置默认配置。
func Default() *Config {
	home, _ := os.UserHomeDir()
	return &Config{
		ComicRoot:       filepath.Join(".", "comics"),
		Host:            "0.0.0.0",
		Port:            8080,
		AllowOsOpen:     false,
		CacheDir:        filepath.Join(home, ".comic_reader", "cache"),
		ThumbSizeW:      320,
		ThumbSizeH:      350,
		CacheMaxAgeDays: 30,
	}
}

// LoadFile 从 JSON 配置文件加载并覆盖默认配置。
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
	if err := json.Unmarshal(data, tmp); err != nil {
		return nil, fmt.Errorf("parse config file: %w", err)
	}

	mergeFile(cfg, tmp)
	return cfg, nil
}

// mergeFile 将 file 中非零值合并到 dst。
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
	dst.AllowOsOpen = file.AllowOsOpen // bool 零值也是有意义的，保留
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
}

// ApplyEnv 用环境变量覆盖配置（env 优先级高于 file，低于 flag）。
func ApplyEnv(cfg *Config) {
	if v := os.Getenv("COMIC_ROOT"); v != "" {
		cfg.ComicRoot = v
	}
	if v := os.Getenv("COMIC_HOST"); v != "" {
		cfg.Host = v
	}
	if v := os.Getenv("COMIC_PORT"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.Port = n
		}
	}
	if v := os.Getenv("COMIC_CACHE_DIR"); v != "" {
		cfg.CacheDir = v
	}
	if v := os.Getenv("COMIC_THUMB_W"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.ThumbSizeW = n
		}
	}
	if v := os.Getenv("COMIC_THUMB_H"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.ThumbSizeH = n
		}
	}
	if v := os.Getenv("COMIC_CACHE_MAX_AGE_DAYS"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			cfg.CacheMaxAgeDays = n
		}
	}
	if v := os.Getenv("COMIC_ALLOW_OS_OPEN"); v != "" {
		cfg.AllowOsOpen = v == "1" || v == "true" || v == "TRUE"
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
