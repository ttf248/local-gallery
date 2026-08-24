// Package services 提供本地画廊核心业务服务。
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
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
//
// 已废弃：请使用 LoadWithRoots(currentRoots)。该方法等价于
// LoadWithRoots(nil)，不校验缓存里的根目录与当前配置是否一致，
// 仅在测试与历史代码路径中保留。
//
// Deprecated: Use LoadWithRoots instead.
func (c *ScanResultCache) Load() error {
	_, err := c.LoadWithRoots(nil)
	return err
}

// LoadWithRoots 启动时加载磁盘缓存，并在缓存记录的多媒体根与 currentRoots
// 不一致时清空缓存（清空后调用方应主动触发一次扫描，避免前端拉到旧根下的
// 扫描结果）。
//
// 行为：
//   - 缓存文件不存在：与 Load 行为一致，直接返回 nil（无错）。
//   - 缓存文件存在但解析失败：返回错误（与 Load 行为一致）。
//   - currentRoots 为 nil 或空：跳过根目录校验，按原样加载。
//   - 缓存里的根集合与 currentRoots 不一致：调用 Clear() 清空内存与磁盘，
//     并通过返回值 rootsMismatch=true 通知调用方需要重扫。
//   - 一致：按原样加载到内存。
//
// 根集合比较规则：
//   - 使用 filepath.Clean 规范化
//   - 顺序无关（按集合比较）
//   - 大小写：Windows 上不敏感（paths.ToLower 后比），其他平台敏感
func (c *ScanResultCache) LoadWithRoots(currentRoots []string) (rootsMismatch bool, err error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	data, err := os.ReadFile(c.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			c.loaded = true
			return false, nil
		}
		return false, err
	}
	r := &models.ScanResult{}
	if err := json.Unmarshal(data, r); err != nil {
		return false, err
	}
	// currentRoots 为空 → 跳过校验（旧路径/调用方未启用校验）
	if len(currentRoots) == 0 {
		c.latest = r
		c.loaded = true
		return false, nil
	}
	if !sameRootSet(r.Roots, currentRoots) {
		// 缓存属于另一个 mediaRoot，不能直接用——清空内存并删除磁盘文件，
		// 避免下次启动再次读到旧根。
		if c.flushTimer != nil {
			c.flushTimer.Stop()
		}
		c.latest = nil
		c.dirty = false
		// 直接删除磁盘文件；删除失败时退化为写空 JSON（保持下次 Load 行为可预测）
		if rmErr := os.Remove(c.path); rmErr != nil && !os.IsNotExist(rmErr) {
			c.latest = &models.ScanResult{}
			c.dirty = true
			if ferr := c.flushLocked(); ferr != nil {
				return true, rmErr
			}
		}
		c.loaded = true
		return true, nil
	}
	c.latest = r
	c.loaded = true
	return false, nil
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

// flushLocked 与 flush 等价，但调用方必须已持有 c.mu 写锁。
// 用于 LoadWithRoots 在校验失败后立即清空写盘的场景（避免与 flush 中的
// RLock/Lock 切换出现死锁）。
func (c *ScanResultCache) flushLocked() error {
	if !c.dirty || c.latest == nil {
		return nil
	}
	data, err := json.MarshalIndent(c.latest, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(c.path), 0o755); err != nil {
		return err
	}
	tmp := c.path + ".tmp"
	if err := os.WriteFile(tmp, data, 0o644); err != nil {
		return err
	}
	c.dirty = false
	return os.Rename(tmp, c.path)
}

// Clear 清空内存中的扫描结果并立即落盘为空文件（媒体根目录变更后调用）。
// 后续首次加载/扫描会按新根重新填充。
func (c *ScanResultCache) Clear() error {
	c.mu.Lock()
	if c.flushTimer != nil {
		c.flushTimer.Stop()
	}
	c.latest = nil
	c.dirty = true
	c.mu.Unlock()
	return c.Flush()
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

// FindCollection 按路径查找集合（递归嵌套 Collection）。
//
// 扫描器会按目录层级产出嵌套集合（Collection.Collections），所以顶层之外的
// 集合（"2024年/夏威夷-度假"、"2024年/夏威夷-度假/相片"）也必须能找到。
// 旧版只在顶层 r.Collections 里线性查找，导致点击首页 401 个文件夹中的
// 任何深层集合都返回 404 —— 反馈「文件夹里面的子文件夹无法正常加载」。
func (c *ScanResultCache) FindCollection(path string) *models.Collection {
	r := c.Get()
	if r == nil {
		return nil
	}
	for i := range r.Collections {
		if found := findCollectionRecursive(&r.Collections[i], path); found != nil {
			return found
		}
	}
	return nil
}

// findCollectionRecursive 在 col 及其嵌套子集合中查找 path。
// 命中时返回深拷贝（避免外部修改内部状态）。
func findCollectionRecursive(col *models.Collection, path string) *models.Collection {
	if col.Path == path {
		c := *col
		return &c
	}
	for i := range col.Collections {
		if found := findCollectionRecursive(&col.Collections[i], path); found != nil {
			return found
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

// findAlbumInCollection 在 col 及其嵌套子集合中递归查找相册。
//
// 旧实现只在 col.Albums 顶层线性查找，遇到嵌套 Collection（"2024年/
// 夏威夷-度假/相片/作品" 这种 4 层结构）就找不到，导致 FindAlbum 拿不到
// 深层相册。扫描器现在支持 Collection 嵌套（详见 scanner.go），这里
// 也必须跟着递归。
func findAlbumInCollection(col *models.Collection, path string) *models.Album {
	for i := range col.Albums {
		if col.Albums[i].Path == path {
			a := col.Albums[i]
			return &a
		}
	}
	for i := range col.Collections {
		if a := findAlbumInCollection(&col.Collections[i], path); a != nil {
			return a
		}
	}
	return nil
}

// normalizeRoots 把一组根目录字符串做规范化：filepath.Clean + 去空。
// 比较函数 sameRootSet 内部使用。
func normalizeRoots(roots []string) []string {
	out := make([]string, 0, len(roots))
	for _, r := range roots {
		r = filepath.Clean(r)
		if r == "" || r == "." {
			continue
		}
		out = append(out, r)
	}
	return out
}

// sameRootSet 判断 a、b 两个根集合是否等价（顺序无关）。
//
// 规则：
//   - 都先经过 filepath.Clean 规范化
//   - 大小写：Windows 上不敏感（filepath.Clean 不会改变大小写，故此处手工 ToLower）；
//     其他平台保持大小写敏感
//   - 任一为空且另一个也为空 → true；任一为空但另一个非空 → false
func sameRootSet(a, b []string) bool {
	na := normalizeRoots(a)
	nb := normalizeRoots(b)
	if len(na) != len(nb) {
		return false
	}
	caseInsensitive := runtime.GOOS == "windows"
	set := make(map[string]struct{}, len(na))
	for _, r := range na {
		if caseInsensitive {
			r = strings.ToLower(r)
		}
		set[r] = struct{}{}
	}
	for _, r := range nb {
		if caseInsensitive {
			r = strings.ToLower(r)
		}
		if _, ok := set[r]; !ok {
			return false
		}
	}
	return true
}
