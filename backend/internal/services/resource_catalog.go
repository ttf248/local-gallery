package services

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync/atomic"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

// ResourceKind 是业务 API 可引用的媒体资源类型。
type ResourceKind string

const (
	ResourceRoot       ResourceKind = "root"
	ResourceAlbum      ResourceKind = "album"
	ResourceCollection ResourceKind = "collection"
	ResourceFile       ResourceKind = "file"
)

// ResourceRef 是绝对路径在业务边界上的脱敏表示。
type ResourceRef struct {
	ID           string
	Kind         ResourceKind
	RootID       string
	RelativePath string
	AbsolutePath string
}

type resourceCatalogState struct {
	byID       map[string]ResourceRef
	byPathKind map[string]string
	roots      []ResourceRef
}

// ResourceCatalog 保存不可变的资源索引；重扫时原子替换整份快照。
// handler 只能通过 ID 解析路径，业务响应不再暴露绝对路径。
type ResourceCatalog struct {
	state atomic.Pointer[resourceCatalogState]
}

func NewResourceCatalog() *ResourceCatalog {
	c := &ResourceCatalog{}
	c.state.Store(&resourceCatalogState{
		byID:       map[string]ResourceRef{},
		byPathKind: map[string]string{},
	})
	return c
}

// Rebuild 根据一次完整扫描结果重建索引。
func (c *ResourceCatalog) Rebuild(result *models.ScanResult, roots []string) {
	state := &resourceCatalogState{
		byID:       make(map[string]ResourceRef),
		byPathKind: make(map[string]string),
	}
	for _, root := range roots {
		abs, err := filepath.Abs(root)
		if err != nil {
			continue
		}
		abs = filepath.Clean(abs)
		rootID := rootIDFor(abs)
		ref := ResourceRef{
			ID:           rootID,
			Kind:         ResourceRoot,
			RootID:       rootID,
			RelativePath: "",
			AbsolutePath: abs,
		}
		state.roots = append(state.roots, ref)
		state.byID[rootID] = ref
		state.byPathKind[pathKindKey(abs, ResourceRoot)] = rootID
	}
	// 根路径按长度降序，嵌套根场景优先匹配最具体的根。
	sort.Slice(state.roots, func(i, j int) bool {
		return len(state.roots[i].AbsolutePath) > len(state.roots[j].AbsolutePath)
	})

	if result != nil {
		for i := range result.Albums {
			indexAlbum(state, &result.Albums[i])
		}
		for i := range result.Collections {
			indexCollection(state, &result.Collections[i])
		}
		for i := range result.SmartCollections {
			for j := range result.SmartCollections[i].Albums {
				indexAlbum(state, &result.SmartCollections[i].Albums[j])
			}
		}
	}
	c.state.Store(state)
}

// Resolve 将业务资源 ID 解析为内部绝对路径。
func (c *ResourceCatalog) Resolve(id string) (string, bool) {
	if c == nil {
		return "", false
	}
	ref, ok := c.state.Load().byID[id]
	return ref.AbsolutePath, ok
}

func (c *ResourceCatalog) Lookup(id string) (ResourceRef, bool) {
	if c == nil {
		return ResourceRef{}, false
	}
	ref, ok := c.state.Load().byID[id]
	return ref, ok
}

// Ready 表示资源目录已经由磁盘快照或一次完整扫描构建完成。
func (c *ResourceCatalog) Ready() bool {
	return c != nil && len(c.state.Load().roots) > 0
}

// ExternalID 返回内部路径对应的业务 ID；未知路径返回空，避免意外泄露。
func (c *ResourceCatalog) ExternalID(path string, kind ResourceKind) string {
	if c == nil || path == "" {
		return ""
	}
	return c.state.Load().byPathKind[pathKindKey(path, kind)]
}

// RelativeLabel 返回适合展示的“根别名/相对路径”。
func (c *ResourceCatalog) RelativeLabel(id string) string {
	ref, ok := c.Lookup(id)
	if !ok {
		return ""
	}
	rootName := "媒体库"
	if root, exists := c.Lookup(ref.RootID); exists {
		if name := filepath.Base(root.AbsolutePath); name != "." && name != string(filepath.Separator) {
			rootName = name
		}
	}
	if ref.RelativePath == "" {
		return rootName
	}
	return rootName + "/" + filepath.ToSlash(ref.RelativePath)
}

// PublicScanResult 生成只包含资源 ID 的 API 快照。
func (c *ResourceCatalog) PublicScanResult(result *models.ScanResult) *models.ScanResult {
	if result == nil {
		return nil
	}
	out := *result
	out.Root = c.ExternalID(result.Root, ResourceRoot)
	out.Roots = mapPaths(result.Roots, func(path string) string {
		return c.ExternalID(path, ResourceRoot)
	})
	out.Albums = make([]models.Album, len(result.Albums))
	for i := range result.Albums {
		out.Albums[i] = c.PublicAlbum(result.Albums[i])
	}
	out.Collections = make([]models.Collection, len(result.Collections))
	for i := range result.Collections {
		out.Collections[i] = c.PublicCollection(result.Collections[i])
	}
	out.SmartCollections = make([]models.SmartCollection, len(result.SmartCollections))
	for i := range result.SmartCollections {
		smart := result.SmartCollections[i]
		smart.CoverImage = c.ExternalID(smart.CoverImage, ResourceFile)
		smart.Albums = make([]models.Album, len(result.SmartCollections[i].Albums))
		for j := range result.SmartCollections[i].Albums {
			smart.Albums[j] = c.PublicAlbum(result.SmartCollections[i].Albums[j])
		}
		out.SmartCollections[i] = smart
	}
	return &out
}

func (c *ResourceCatalog) PublicAlbum(album models.Album) models.Album {
	out := album
	out.Path = c.ExternalID(album.Path, ResourceAlbum)
	out.SourceRoot = c.ExternalID(album.SourceRoot, ResourceRoot)
	out.CoverImage = c.ExternalID(album.CoverImage, ResourceFile)
	out.ImageFiles = mapPaths(album.ImageFiles, func(path string) string {
		return c.ExternalID(path, ResourceFile)
	})
	out.VideoFiles = mapPaths(album.VideoFiles, func(path string) string {
		return c.ExternalID(path, ResourceFile)
	})
	out.Files = mapPaths(album.Files, func(path string) string {
		return c.ExternalID(path, ResourceFile)
	})
	return out
}

func (c *ResourceCatalog) PublicCollection(collection models.Collection) models.Collection {
	out := collection
	out.Path = c.ExternalID(collection.Path, ResourceCollection)
	out.SourceRoot = c.ExternalID(collection.SourceRoot, ResourceRoot)
	out.Albums = make([]models.Album, len(collection.Albums))
	for i := range collection.Albums {
		out.Albums[i] = c.PublicAlbum(collection.Albums[i])
	}
	out.Collections = make([]models.Collection, len(collection.Collections))
	for i := range collection.Collections {
		out.Collections[i] = c.PublicCollection(collection.Collections[i])
	}
	return out
}

func indexCollection(state *resourceCatalogState, collection *models.Collection) {
	indexPath(state, collection.Path, ResourceCollection)
	for i := range collection.Albums {
		indexAlbum(state, &collection.Albums[i])
	}
	for i := range collection.Collections {
		indexCollection(state, &collection.Collections[i])
	}
}

func indexAlbum(state *resourceCatalogState, album *models.Album) {
	indexPath(state, album.Path, ResourceAlbum)
	for _, path := range album.ImageFiles {
		indexPath(state, path, ResourceFile)
	}
	for _, path := range album.VideoFiles {
		indexPath(state, path, ResourceFile)
	}
	if album.CoverImage != "" {
		indexPath(state, album.CoverImage, ResourceFile)
	}
}

func indexPath(state *resourceCatalogState, path string, kind ResourceKind) {
	if path == "" {
		return
	}
	abs := filepath.Clean(path)
	for _, root := range state.roots {
		rel, err := filepath.Rel(root.AbsolutePath, abs)
		if err != nil || relEscapesRoot(rel) {
			continue
		}
		rel = filepath.ToSlash(rel)
		if rel == "." {
			rel = ""
		}
		id := resourceID(root.ID, kind, rel)
		ref := ResourceRef{
			ID:           id,
			Kind:         kind,
			RootID:       root.ID,
			RelativePath: rel,
			AbsolutePath: abs,
		}
		state.byID[id] = ref
		state.byPathKind[pathKindKey(abs, kind)] = id
		return
	}
}

func rootIDFor(abs string) string {
	normalized := filepath.Clean(abs)
	if runtime.GOOS == "windows" {
		normalized = strings.ToLower(normalized)
	}
	sum := sha256.Sum256([]byte(normalized))
	return "r_" + hex.EncodeToString(sum[:6])
}

func resourceID(rootID string, kind ResourceKind, rel string) string {
	normalized := filepath.ToSlash(filepath.Clean(rel))
	if runtime.GOOS == "windows" {
		normalized = strings.ToLower(normalized)
	}
	sum := sha256.Sum256([]byte(rootID + "\x00" + string(kind) + "\x00" + normalized))
	prefix := "x_"
	switch kind {
	case ResourceAlbum:
		prefix = "a_"
	case ResourceCollection:
		prefix = "c_"
	case ResourceFile:
		prefix = "f_"
	}
	return prefix + base64.RawURLEncoding.EncodeToString(sum[:16])
}

func pathKindKey(path string, kind ResourceKind) string {
	path = filepath.Clean(path)
	if runtime.GOOS == "windows" {
		path = strings.ToLower(path)
	}
	return string(kind) + "\x00" + path
}

func relEscapesRoot(rel string) bool {
	return rel == ".." || filepath.IsAbs(rel) || strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

func mapPaths(paths []string, mapper func(string) string) []string {
	if paths == nil {
		return nil
	}
	out := make([]string, 0, len(paths))
	for _, path := range paths {
		if mapped := mapper(path); mapped != "" {
			out = append(out, mapped)
		}
	}
	return out
}
