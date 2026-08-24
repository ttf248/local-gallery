// CoverOverrideStore 持久化用户对每个 album 的人工封面设置。
//
// 持久化位置：cacheDir/cover_overrides.json。
//
//   key:   album 绝对路径（与 ScanResult.albums[i].path 一致）
//   value: 用户指定的封面文件绝对路径（必须在对应 album 目录里）
//
// 运行时每次从 ScanResult 拉数据都把 override 应用上；前端
// PUT/DELETE 改变 override 后，store 会重新生成应用后的 ScanResult
// 并写回 cache，前端下一次拉 scan 看到的就是新封面。
//
// 安全性：值永远受前端 + 后端双重校验，必须在对应 album 目录里，
// 越权访问会被拒绝（参见 handlers/albums.go 的 SetCover/路径安全检查）。
package services

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

// CoverOverride 一条用户封面覆盖记录。
type CoverOverride struct {
	// File 用户选择的图片/视频绝对路径。必须 = CoverPath 字段
	// （handler 层验证 file 在 album path 内）。
	File string `json:"file"`
}

// CoverOverrideStore 持久化 + 内存存储用户封面覆盖。
type CoverOverrideStore struct {
	path string

	mu   sync.RWMutex
	data map[string]CoverOverride // key = album path
}

// NewCoverOverrideStore 创建 store，path 为磁盘 JSON 文件位置。
// 文件不存在不报错 — 当作"没有覆盖"。
func NewCoverOverrideStore(path string) *CoverOverrideStore {
	return &CoverOverrideStore{path: path, data: make(map[string]CoverOverride)}
}

// Load 从磁盘加载。如果文件不存在，store 保持空。
func (s *CoverOverrideStore) Load() error {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("read cover overrides: %w", err)
	}
	var raw map[string]CoverOverride
	if err := json.Unmarshal(data, &raw); err != nil {
		return fmt.Errorf("parse cover overrides: %w", err)
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data = make(map[string]CoverOverride, len(raw))
	for k, v := range raw {
		// 归一化路径分隔符，避免 Windows 上 '\\' vs '/' 引起的命中失败
		s.data[filepath.Clean(k)] = CoverOverride{File: filepath.Clean(v.File)}
	}
	return nil
}

// flush 写盘（持锁或单线程下调用）。失败不返回上层错误：让上层
// 走"内存已更新、稍后 retry"路径。
func (s *CoverOverrideStore) flush() error {
	s.mu.RLock()
	cp := make(map[string]CoverOverride, len(s.data))
	for k, v := range s.data {
		cp[k] = v
	}
	s.mu.RUnlock()

	if len(cp) == 0 {
		// 没有覆盖就删文件，避免磁盘上一直留空文件
		if err := os.Remove(s.path); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}

	if err := os.MkdirAll(filepath.Dir(s.path), 0o755); err != nil {
		return err
	}
	data, err := json.MarshalIndent(cp, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}

// Set 设置 album path 的封面覆盖，立即落盘。
func (s *CoverOverrideStore) Set(albumPath, file string) error {
	albumPath = filepath.Clean(albumPath)
	file = filepath.Clean(file)
	s.mu.Lock()
	s.data[albumPath] = CoverOverride{File: file}
	s.mu.Unlock()
	return s.flush()
}

// Clear 删除 album path 的封面覆盖，落盘。
func (s *CoverOverrideStore) Clear(albumPath string) error {
	albumPath = filepath.Clean(albumPath)
	s.mu.Lock()
	delete(s.data, albumPath)
	s.mu.Unlock()
	return s.flush()
}

// Get 返回 album path 的覆盖（无则 nil）。
func (s *CoverOverrideStore) Get(albumPath string) *CoverOverride {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if v, ok := s.data[filepath.Clean(albumPath)]; ok {
		cp := v
		return &cp
	}
	return nil
}

// Snapshot 返回所有覆盖的浅拷贝（用于 ApplyToScanResult）。
func (s *CoverOverrideStore) Snapshot() map[string]CoverOverride {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make(map[string]CoverOverride, len(s.data))
	for k, v := range s.data {
		out[k] = v
	}
	return out
}

// HasFile 简单判断 file 路径是否被某条 cover override 引用（用于
// 删除/重命名文件时清理相关 override；目前未直接调用，预留接口）。
func (s *CoverOverrideStore) HasFile(file string) bool {
	target := filepath.Clean(file)
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, v := range s.data {
		if strings.EqualFold(v.File, target) {
			return true
		}
	}
	return false
}
