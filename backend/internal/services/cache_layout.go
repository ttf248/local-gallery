package services

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const (
	cacheStateDirName   = "state"
	cacheDerivedDirName = "derived"
	cacheTempDirName    = "temp"
	thumbnailDirName    = "thumbnails"
)

// CacheLayout 把不可随意删除的应用状态与可重建的派生资源隔离开。
// CacheRoot 仍来自 config.yaml 的 cacheDir，保持单一配置入口。
type CacheLayout struct {
	Root               string
	StateDir           string
	DerivedDir         string
	TempDir            string
	ThumbnailDir       string
	ScanCachePath      string
	PreferencesPath    string
	ActivityPath       string
	CoverOverridesPath string
}

// ResolveCacheLayout 只计算路径，不访问文件系统。
func ResolveCacheLayout(root string) CacheLayout {
	cleanRoot := filepath.Clean(root)
	stateDir := filepath.Join(cleanRoot, cacheStateDirName)
	derivedDir := filepath.Join(cleanRoot, cacheDerivedDirName)
	return CacheLayout{
		Root:               cleanRoot,
		StateDir:           stateDir,
		DerivedDir:         derivedDir,
		TempDir:            filepath.Join(cleanRoot, cacheTempDirName),
		ThumbnailDir:       filepath.Join(derivedDir, thumbnailDirName),
		ScanCachePath:      filepath.Join(stateDir, "scan_cache.json"),
		PreferencesPath:    filepath.Join(stateDir, "web_settings.json"),
		ActivityPath:       filepath.Join(stateDir, "activity.json"),
		CoverOverridesPath: filepath.Join(stateDir, "cover_overrides.json"),
	}
}

// EnsureCacheLayout 创建新目录，并把旧版 cacheDir 顶层状态与派生资源
// 原地迁移到分层布局。迁移只移动已知文件；未知文件永远不会被删除。
func EnsureCacheLayout(root string) (CacheLayout, error) {
	if strings.TrimSpace(root) == "" {
		return CacheLayout{}, fmt.Errorf("cache root is required")
	}
	layout := ResolveCacheLayout(root)
	for _, dir := range []string{layout.Root, layout.StateDir, layout.DerivedDir, layout.TempDir, layout.ThumbnailDir} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return CacheLayout{}, fmt.Errorf("create cache layout: %w", err)
		}
	}

	stateFiles := map[string]string{
		"scan_cache.json":      layout.ScanCachePath,
		"web_settings.json":    layout.PreferencesPath,
		"activity.json":        layout.ActivityPath,
		"cover_overrides.json": layout.CoverOverridesPath,
	}
	for legacyName, target := range stateFiles {
		if err := moveLegacyFile(filepath.Join(layout.Root, legacyName), target); err != nil {
			return CacheLayout{}, err
		}
	}

	for _, dirName := range []string{"video-faststart", "video-transcode"} {
		if err := moveLegacyDirectoryContents(
			filepath.Join(layout.Root, dirName),
			filepath.Join(layout.DerivedDir, dirName),
		); err != nil {
			return CacheLayout{}, err
		}
	}
	if err := moveLegacyDirectoryContents(filepath.Join(layout.Root, "thumbs"), layout.ThumbnailDir); err != nil {
		return CacheLayout{}, err
	}

	entries, err := os.ReadDir(layout.Root)
	if err != nil {
		return CacheLayout{}, fmt.Errorf("read legacy cache root: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() || !isThumbnailCacheFile(entry.Name()) {
			continue
		}
		if err := moveLegacyFile(
			filepath.Join(layout.Root, entry.Name()),
			filepath.Join(layout.ThumbnailDir, entry.Name()),
		); err != nil {
			return CacheLayout{}, err
		}
	}
	return layout, nil
}

func moveLegacyFile(source, target string) error {
	if _, err := os.Stat(source); err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("inspect legacy cache entry: %w", err)
	}
	if _, err := os.Stat(target); err == nil {
		// 新文件已存在时保留两者，绝不覆盖较新的持久状态。
		return nil
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("inspect cache migration target: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return fmt.Errorf("create cache migration target: %w", err)
	}
	if err := os.Rename(source, target); err != nil {
		return fmt.Errorf("migrate cache entry: %w", err)
	}
	return nil
}

func moveLegacyDirectoryContents(source, target string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read legacy cache directory: %w", err)
	}
	if err := os.MkdirAll(target, 0o755); err != nil {
		return fmt.Errorf("create derived cache directory: %w", err)
	}
	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}
		if err := moveLegacyFile(filepath.Join(source, entry.Name()), filepath.Join(target, entry.Name())); err != nil {
			return err
		}
	}
	// 只移除已经为空的旧目录；包含未知子目录时 os.Remove 会安全失败。
	_ = os.Remove(source)
	return nil
}

func isThumbnailCacheFile(name string) bool {
	if !strings.EqualFold(filepath.Ext(name), JPEGExt) {
		return false
	}
	base := strings.TrimSuffix(name, filepath.Ext(name))
	if len(base) != 32 {
		return false
	}
	for _, char := range base {
		if !((char >= '0' && char <= '9') || (char >= 'a' && char <= 'f') || (char >= 'A' && char <= 'F')) {
			return false
		}
	}
	return true
}
