// Package services 提供漫画阅读器核心业务服务。
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// ScanResultCache 全局扫描结果缓存。
//
//   - 每次成功扫描完成后由 AsyncScanRunner 写入
//   - 服务启动时从磁盘加载，供前端无需重新扫描即可看到上次结果
//   - 单进程内自带线程安全（sync.RWMutex）
//   - 写盘异步 + 防抖，避免在 SSE 完成路径上卡住事件流
type ScanResultCache struct {
	path string

	mu         sync.RWMutex
	latest     *models.ScanResult
	loaded     bool
	dirty      bool // 当前内存结果是否尚未写盘
	flushTimer *time.Timer
}

const flushDebounce = 500 * time.Millisecond

// NewScanResultCache 创建缓存，path 为磁盘持久化文件路径。
func NewScanResultCache(path string) *ScanResultCache {
	return &ScanResultCache{path: path}
}

// Get 返回当前缓存的扫描结果（深拷贝避免外部修改）。
func (c *ScanResultCache) Get() *models.ScanResult {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.latest == nil {
		return nil
	}
	cp := *c.latest
	return &cp
}

// Set 写入新的扫描结果并异步、防抖落盘。
//
// 落盘通过 timer 延迟 500ms；若在延迟窗口内再次 Set 则重置 timer，
// 实现"连续多次写合并为一次落盘"。落盘失败不丢内存结果（下次 Set
// 或显式 Flush 会再尝试）。
func (c *ScanResultCache) Set(r *models.ScanResult) {
	if r == nil {
		return
	}
	c.mu.Lock()
	c.latest = r
	c.loaded = true
	c.dirty = true
	if c.flushTimer != nil {
		c.flushTimer.Stop()
	}
	c.flushTimer = time.AfterFunc(flushDebounce, func() {
		if err := c.flush(); err != nil {
			fmt.Fprintf(os.Stderr, "scan_cache async flush: %v\n", err)
		}
	})
	c.mu.Unlock()
}

// Flush 强制立即落盘（用于服务关闭前等关键路径）。幂等：若内存已
// 干净则什么都不做。
func (c *ScanResultCache) Flush() error {
	return c.flush()
}

// Load 启动时加载磁盘缓存。
func (c *ScanResultCache) Load() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := os.ReadFile(c.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.loaded = true
			return nil
		}
		return err
	}
	r := &models.ScanResult{}
	if err := json.Unmarshal(data, r); err != nil {
		return err
	}
	c.latest = r
	c.loaded = true
	return nil
}

// flush 把内存中的最新结果写到磁盘（原子重命名）。
// 必须在持锁或已知无并发时调用，本实现 Get/Set 通过锁保证安全。
func (c *ScanResultCache) flush() error {
	c.mu.RLock()
	if !c.dirty || c.latest == nil {
		c.mu.RUnlock()
		return nil
	}
	data, err := json.MarshalIndent(c.latest, "", "  ")
	path := c.path
	c.mu.RUnlock()
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	c.mu.Lock()
	c.dirty = false
	c.mu.Unlock()
	return os.Rename(tmp, path)
}

// FindAlbum 按路径查找相册（递归 Collection）。
func (c *ScanResultCache) FindAlbum(path string) *models.Album {
	r := c.Get()
	if r == nil {
		return nil
	}
	for i := range r.Albums {
		if r.Albums[i].Path == path {
			a := r.Albums[i]
			return &a
		}
	}
	for i := range r.Collections {
		if a := findAlbumInCollection(&r.Collections[i], path); a != nil {
			return a
		}
	}
	for i := range r.SmartCollections {
		for j := range r.SmartCollections[i].Albums {
			if r.SmartCollections[i].Albums[j].Path == path {
				a := r.SmartCollections[i].Albums[j]
				return &a
			}
		}
	}
	return nil
}

// FindCollection 按路径查找集合。
func (c *ScanResultCache) FindCollection(path string) *models.Collection {
	r := c.Get()
	if r == nil {
		return nil
	}
	for i := range r.Collections {
		if r.Collections[i].Path == path {
			c := r.Collections[i]
			return &c
		}
	}
	return nil
}

// FindSmartCollection 按标签名查找智能集合。
//
// 兼容说明：同时按 Tag 与 Author 字段匹配（两者内容相同）。
func (c *ScanResultCache) FindSmartCollection(tag string) *models.SmartCollection {
	r := c.Get()
	if r == nil {
		return nil
	}
	for i := range r.SmartCollections {
		s := r.SmartCollections[i]
		if s.Tag == tag || s.Author == tag {
			return &s
		}
	}
	return nil
}

func findAlbumInCollection(col *models.Collection, path string) *models.Album {
	for i := range col.Albums {
		if col.Albums[i].Path == path {
			a := col.Albums[i]
			return &a
		}
	}
	return nil
}
