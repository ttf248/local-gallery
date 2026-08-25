// Package services 提供本地画廊核心业务服务。
package services

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
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

	mu      sync.RWMutex
	latest  *models.ScanResult
	dirty   bool
	version uint64

	flushMu    sync.Mutex
	flushTimer *time.Timer
}

const (
	flushDebounce          = 500 * time.Millisecond
	scanCacheSchemaVersion = 2
)

type scanCacheEnvelope struct {
	SchemaVersion int                `json:"schemaVersion"`
	RootIDs       []string           `json:"rootIds"`
	Result        *models.ScanResult `json:"result"`
}

// NewScanResultCache 创建缓存，path 为磁盘持久化文件路径。
func NewScanResultCache(path string) *ScanResultCache {
	return &ScanResultCache{path: path}
}

// Get 返回当前缓存的扫描结果（深拷贝避免外部修改）。
func (c *ScanResultCache) Get() *models.ScanResult {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return cloneScanResult(c.latest)
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
	c.latest = cloneScanResult(r)
	c.markDirtyLocked()
	c.mu.Unlock()
}

// Flush 强制立即落盘（用于服务关闭前等关键路径）。幂等：若内存已
// 干净则什么都不做。
func (c *ScanResultCache) Flush() error {
	return c.flush()
}

// LoadWithRoots 启动时加载磁盘缓存，并在缓存记录的多媒体根与 currentRoots
// 不一致时清空缓存（清空后调用方应主动触发一次扫描，避免前端拉到旧根下的
// 扫描结果）。
//
// 行为：
//   - 缓存文件不存在：与 Load 行为一致，直接返回 nil（无错）。
//   - 缓存文件存在但解析失败：返回错误（与 Load 行为一致）。
//   - currentRoots 为 nil 或空：拒绝加载，因为脱敏快照无法还原内部路径。
//   - 缓存里的根集合与 currentRoots 不一致：调用 Clear() 清空内存与磁盘，
//     并通过返回值 rootsMismatch=true 通知调用方需要重扫。
//   - 一致：按原样加载到内存。
//
// 根集合比较规则：
//   - 使用 filepath.Clean 规范化
//   - 顺序无关（按集合比较）
//   - 大小写：Windows 上不敏感（paths.ToLower 后比），其他平台敏感
func (c *ScanResultCache) LoadWithRoots(currentRoots []string) (rootsMismatch bool, err error) {
	if len(currentRoots) == 0 {
		return false, errors.New("current media roots are required to load scan cache")
	}
	c.flushMu.Lock()
	defer c.flushMu.Unlock()
	data, err := os.ReadFile(c.path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return false, nil
		}
		return false, err
	}
	envelope := &scanCacheEnvelope{}
	if err := json.Unmarshal(data, envelope); err != nil {
		return false, err
	}
	if envelope.SchemaVersion != scanCacheSchemaVersion || envelope.Result == nil {
		c.resetMemory()
		if err := removeCacheFile(c.path); err != nil {
			return true, err
		}
		return true, nil
	}
	currentRootIDs := make([]string, 0, len(currentRoots))
	for _, root := range currentRoots {
		abs, absErr := filepath.Abs(root)
		if absErr != nil {
			return false, absErr
		}
		currentRootIDs = append(currentRootIDs, rootIDFor(abs))
	}
	if !sameRootSet(envelope.RootIDs, currentRootIDs) {
		c.resetMemory()
		if err := removeCacheFile(c.path); err != nil {
			return true, err
		}
		return true, nil
	}
	result, err := decodeScanResultFromDisk(envelope.Result, currentRoots)
	if err != nil {
		return false, fmt.Errorf("decode scan cache: %w", err)
	}
	c.mu.Lock()
	c.latest = result
	c.dirty = false
	c.version++
	c.mu.Unlock()
	return false, nil
}

// flush 把内存中的最新结果写到磁盘（原子重命名）。版本号保证写盘期间
// 到达的新 Set 不会被错误标记为已持久化。
func (c *ScanResultCache) flush() error {
	c.flushMu.Lock()
	defer c.flushMu.Unlock()

	c.mu.RLock()
	if !c.dirty || c.latest == nil {
		c.mu.RUnlock()
		return nil
	}
	snapshot := cloneScanResult(c.latest)
	version := c.version
	path := c.path
	c.mu.RUnlock()

	envelope, err := encodeScanResultForDisk(snapshot)
	if err != nil {
		return err
	}
	data, err := json.MarshalIndent(envelope, "", "  ")
	if err != nil {
		return err
	}
	if err := writeScanCacheAtomic(path, data); err != nil {
		return err
	}
	c.mu.Lock()
	if c.version == version {
		c.dirty = false
	}
	c.mu.Unlock()
	return nil
}

// Clear 清空内存中的扫描结果并删除磁盘文件（媒体根目录变更后调用）。
// 后续首次加载/扫描会按新根重新填充。
func (c *ScanResultCache) Clear() error {
	c.flushMu.Lock()
	defer c.flushMu.Unlock()
	c.mu.Lock()
	if c.flushTimer != nil {
		c.flushTimer.Stop()
		c.flushTimer = nil
	}
	c.latest = nil
	c.dirty = false
	c.version++
	c.mu.Unlock()
	return removeCacheFile(c.path)
}

func (c *ScanResultCache) markDirtyLocked() {
	c.dirty = true
	c.version++
	if c.flushTimer != nil {
		c.flushTimer.Stop()
	}
	c.flushTimer = time.AfterFunc(flushDebounce, func() {
		if err := c.flush(); err != nil {
			fmt.Fprintf(os.Stderr, "scan_cache async flush: %v\n", err)
		}
	})
}

func (c *ScanResultCache) resetMemory() {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.flushTimer != nil {
		c.flushTimer.Stop()
		c.flushTimer = nil
	}
	c.latest = nil
	c.dirty = false
	c.version++
}

func cloneScanResult(result *models.ScanResult) *models.ScanResult {
	if result == nil {
		return nil
	}
	out := *result
	out.Roots = append([]string(nil), result.Roots...)
	out.Albums = cloneAlbums(result.Albums)
	out.Collections = cloneCollections(result.Collections)
	out.SmartCollections = make([]models.SmartCollection, len(result.SmartCollections))
	for i := range result.SmartCollections {
		out.SmartCollections[i] = result.SmartCollections[i]
		out.SmartCollections[i].Tags = append([]string(nil), result.SmartCollections[i].Tags...)
		out.SmartCollections[i].Albums = cloneAlbums(result.SmartCollections[i].Albums)
	}
	return &out
}

func cloneAlbums(albums []models.Album) []models.Album {
	if albums == nil {
		return nil
	}
	out := make([]models.Album, len(albums))
	for i := range albums {
		out[i] = albums[i]
		out[i].ImageFiles = append([]string(nil), albums[i].ImageFiles...)
		out[i].VideoFiles = append([]string(nil), albums[i].VideoFiles...)
		out[i].Files = append([]string(nil), albums[i].Files...)
		out[i].Tags = append([]string(nil), albums[i].Tags...)
	}
	return out
}

func cloneCollections(collections []models.Collection) []models.Collection {
	if collections == nil {
		return nil
	}
	out := make([]models.Collection, len(collections))
	for i := range collections {
		out[i] = collections[i]
		out[i].Albums = cloneAlbums(collections[i].Albums)
		out[i].Collections = cloneCollections(collections[i].Collections)
	}
	return out
}

type scanCacheRoot struct {
	id   string
	path string
}

func encodeScanResultForDisk(result *models.ScanResult) (*scanCacheEnvelope, error) {
	if result == nil {
		return nil, errors.New("scan result is empty")
	}
	roots := append([]string(nil), result.Roots...)
	if len(roots) == 0 && result.Root != "" {
		roots = []string{result.Root}
	}
	refs := make([]scanCacheRoot, 0, len(roots))
	rootIDs := make([]string, 0, len(roots))
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, err
		}
		abs = filepath.Clean(abs)
		id := rootIDFor(abs)
		refs = append(refs, scanCacheRoot{id: id, path: abs})
		rootIDs = append(rootIDs, id)
	}
	if len(refs) == 0 {
		return nil, errors.New("scan result has no roots")
	}
	// 嵌套根优先匹配更具体的路径；RootIDs 仍保持配置顺序。
	sort.Slice(refs, func(i, j int) bool { return len(refs[i].path) > len(refs[j].path) })

	out := cloneScanResult(result)
	encode := func(path string) (string, error) { return encodeScanCachePath(path, refs) }
	if err := transformScanResultPaths(out, encode); err != nil {
		return nil, err
	}
	return &scanCacheEnvelope{
		SchemaVersion: scanCacheSchemaVersion,
		RootIDs:       rootIDs,
		Result:        out,
	}, nil
}

func decodeScanResultFromDisk(result *models.ScanResult, roots []string) (*models.ScanResult, error) {
	rootByID := make(map[string]string, len(roots))
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			return nil, err
		}
		abs = filepath.Clean(abs)
		rootByID[rootIDFor(abs)] = abs
	}
	out := cloneScanResult(result)
	decode := func(path string) (string, error) { return decodeScanCachePath(path, rootByID) }
	if err := transformScanResultPaths(out, decode); err != nil {
		return nil, err
	}
	return out, nil
}

func transformScanResultPaths(result *models.ScanResult, transform func(string) (string, error)) error {
	var err error
	if result.Root, err = transform(result.Root); err != nil {
		return err
	}
	if result.Roots, err = transformScanCachePaths(result.Roots, transform); err != nil {
		return err
	}
	for i := range result.Albums {
		if err := transformAlbumPaths(&result.Albums[i], transform); err != nil {
			return err
		}
	}
	for i := range result.Collections {
		if err := transformCollectionPaths(&result.Collections[i], transform); err != nil {
			return err
		}
	}
	for i := range result.SmartCollections {
		if result.SmartCollections[i].CoverImage, err = transform(result.SmartCollections[i].CoverImage); err != nil {
			return err
		}
		for j := range result.SmartCollections[i].Albums {
			if err := transformAlbumPaths(&result.SmartCollections[i].Albums[j], transform); err != nil {
				return err
			}
		}
	}
	return nil
}

func transformAlbumPaths(album *models.Album, transform func(string) (string, error)) error {
	var err error
	if album.Path, err = transform(album.Path); err != nil {
		return err
	}
	if album.SourceRoot, err = transform(album.SourceRoot); err != nil {
		return err
	}
	if album.CoverImage, err = transform(album.CoverImage); err != nil {
		return err
	}
	if album.ImageFiles, err = transformScanCachePaths(album.ImageFiles, transform); err != nil {
		return err
	}
	if album.VideoFiles, err = transformScanCachePaths(album.VideoFiles, transform); err != nil {
		return err
	}
	if album.Files, err = transformScanCachePaths(album.Files, transform); err != nil {
		return err
	}
	return nil
}

func transformCollectionPaths(collection *models.Collection, transform func(string) (string, error)) error {
	var err error
	if collection.Path, err = transform(collection.Path); err != nil {
		return err
	}
	if collection.SourceRoot, err = transform(collection.SourceRoot); err != nil {
		return err
	}
	for i := range collection.Albums {
		if err := transformAlbumPaths(&collection.Albums[i], transform); err != nil {
			return err
		}
	}
	for i := range collection.Collections {
		if err := transformCollectionPaths(&collection.Collections[i], transform); err != nil {
			return err
		}
	}
	return nil
}

func transformScanCachePaths(paths []string, transform func(string) (string, error)) ([]string, error) {
	if paths == nil {
		return nil, nil
	}
	out := make([]string, len(paths))
	for i, path := range paths {
		mapped, err := transform(path)
		if err != nil {
			return nil, err
		}
		out[i] = mapped
	}
	return out, nil
}

func encodeScanCachePath(path string, roots []scanCacheRoot) (string, error) {
	if path == "" {
		return "", nil
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	for _, root := range roots {
		rel, relErr := filepath.Rel(root.path, abs)
		if relErr != nil || relEscapesRoot(rel) {
			continue
		}
		if rel == "." {
			return root.id, nil
		}
		return root.id + "/" + filepath.ToSlash(rel), nil
	}
	return "", errors.New("scan result contains a path outside configured roots")
}

func decodeScanCachePath(ref string, roots map[string]string) (string, error) {
	if ref == "" {
		return "", nil
	}
	rootID, rel, hasRel := strings.Cut(ref, "/")
	root, ok := roots[rootID]
	if !ok {
		return "", errors.New("scan cache references an unknown root")
	}
	if !hasRel {
		return root, nil
	}
	rel = filepath.Clean(filepath.FromSlash(rel))
	if relEscapesRoot(rel) {
		return "", errors.New("scan cache path escapes its root")
	}
	path := filepath.Join(root, rel)
	check, err := filepath.Rel(root, path)
	if err != nil || relEscapesRoot(check) {
		return "", errors.New("scan cache path escapes its root")
	}
	return path, nil
}

func writeScanCacheAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".scan-cache-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err := tmp.Write(data); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Sync(); err != nil {
		_ = tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}

func removeCacheFile(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
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

// ApplyCoverOverrides 把用户设置的封面覆盖应用到当前缓存结果上。
//
// 处理流程：
//  1. 遍历 ScanResult.Albums 和嵌套 Collection.Albums
//  2. 对每条 cover override：确认 coverFile 仍在对应 album 目录里（防
//     越权 + 防止文件已被删/移走），否则静默跳过
//  3. 替换 CoverImage + CoverKind（按文件扩展名推断 image/video）
//
// 原地修改缓存内容并在有变化时安排异步落盘。返回被应用的 override 数量。
func (c *ScanResultCache) ApplyCoverOverrides(overrides map[string]CoverOverride) int {
	if len(overrides) == 0 {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.latest == nil {
		return 0
	}
	applied := 0
	caseInsensitive := runtime.GOOS == "windows"
	apply := func(a *models.Album) {
		ov, ok := overrides[filepath.Clean(a.Path)]
		if !ok {
			return
		}
		if !fileInsideDir(ov.File, a.Path, caseInsensitive) {
			// cover 文件不在 album 内（被移走/删除/越权），静默跳过
			return
		}
		kind := coverKindFromExt(ov.File)
		if kind == "" {
			return
		}
		a.CoverImage = ov.File
		a.CoverKind = kind
		applied++
	}
	for i := range c.latest.Albums {
		apply(&c.latest.Albums[i])
	}
	var walk func(cs []models.Collection)
	walk = func(cs []models.Collection) {
		for i := range cs {
			for j := range cs[i].Albums {
				apply(&cs[i].Albums[j])
			}
			if len(cs[i].Collections) > 0 {
				walk(cs[i].Collections)
			}
		}
	}
	if len(c.latest.Collections) > 0 {
		walk(c.latest.Collections)
	}
	if applied > 0 {
		c.markDirtyLocked()
	}
	return applied
}

// fileInsideDir 检查 file 路径是否在 dir 目录内（file 的父目录 = dir，
// 或 file 父目录以 dir 为前缀）。用于验证 cover override 没越权。
func fileInsideDir(file, dir string, caseInsensitive bool) bool {
	fp := filepath.Clean(file)
	dp := filepath.Clean(dir)
	if caseInsensitive {
		fp = strings.ToLower(fp)
		dp = strings.ToLower(dp)
	}
	if fp == dp {
		return false // 文件不能等于目录
	}
	rel, err := filepath.Rel(dp, fp)
	if err != nil {
		return false
	}
	if rel == "." || rel == ".." {
		return false
	}
	if strings.HasPrefix(rel, "..") {
		return false
	}
	return true
}

// coverKindFromExt 按文件扩展名推断 "image" / "video"。
func coverKindFromExt(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".heic", ".heif", ".avif":
		return "image"
	case ".mp4", ".webm", ".mov", ".mkv", ".avi":
		return "video"
	}
	return ""
}

// SetWithOverrideApplied 把用户设置的 cover 立即应用到缓存结果中的
// 对应 album（在顶层 albums 与嵌套 collections 内都找），并标记 dirty
// 让异步 flush 落盘 scan_cache.json。找不到匹配的 album 时静默成功
// （下一次扫描器跑或加载时 ApplyCoverOverrides 会按 store 重新填上）。
func (c *ScanResultCache) SetWithOverrideApplied(albumPath, coverFile, coverKind string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.latest == nil {
		return
	}
	albumPath = filepath.Clean(albumPath)
	caseInsensitive := runtime.GOOS == "windows"
	var walkAlbums func(a *models.Album) bool
	walkAlbums = func(a *models.Album) bool {
		ap := filepath.Clean(a.Path)
		if caseInsensitive {
			if strings.EqualFold(ap, albumPath) {
				a.CoverImage = coverFile
				a.CoverKind = coverKind
				return true
			}
		} else if ap == albumPath {
			a.CoverImage = coverFile
			a.CoverKind = coverKind
			return true
		}
		return false
	}
	// 顶层
	for i := range c.latest.Albums {
		if walkAlbums(&c.latest.Albums[i]) {
			c.markDirtyLocked()
			return
		}
	}
	// 嵌套
	var walk func(cs []models.Collection) bool
	walk = func(cs []models.Collection) bool {
		for i := range cs {
			for j := range cs[i].Albums {
				if walkAlbums(&cs[i].Albums[j]) {
					return true
				}
			}
			if len(cs[i].Collections) > 0 {
				if walk(cs[i].Collections) {
					return true
				}
			}
		}
		return false
	}
	if walk(c.latest.Collections) {
		c.markDirtyLocked()
	}
}

// RebuildCoverForAlbum 清除 override 后让该 album 的封面回到扫描器默认：
// 图片优先 → images[0]，否则 videos[0]。
//
// 找不到该 album 路径时静默成功（同 SetWithOverrideApplied）。
func (c *ScanResultCache) RebuildCoverForAlbum(albumPath string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.latest == nil {
		return
	}
	albumPath = filepath.Clean(albumPath)
	caseInsensitive := runtime.GOOS == "windows"
	var rebuild func(a *models.Album) bool
	rebuild = func(a *models.Album) bool {
		ap := filepath.Clean(a.Path)
		match := ap == albumPath
		if !match && caseInsensitive {
			match = strings.EqualFold(ap, albumPath)
		}
		if !match {
			return false
		}
		if len(a.ImageFiles) > 0 {
			a.CoverImage = a.ImageFiles[0]
			a.CoverKind = "image"
		} else if len(a.VideoFiles) > 0 {
			a.CoverImage = a.VideoFiles[0]
			a.CoverKind = "video"
		} else {
			a.CoverImage = ""
			a.CoverKind = ""
		}
		return true
	}
	for i := range c.latest.Albums {
		if rebuild(&c.latest.Albums[i]) {
			c.markDirtyLocked()
			return
		}
	}
	var walk func(cs []models.Collection) bool
	walk = func(cs []models.Collection) bool {
		for i := range cs {
			for j := range cs[i].Albums {
				if rebuild(&cs[i].Albums[j]) {
					return true
				}
			}
			if len(cs[i].Collections) > 0 {
				if walk(cs[i].Collections) {
					return true
				}
			}
		}
		return false
	}
	if walk(c.latest.Collections) {
		c.markDirtyLocked()
	}
}
