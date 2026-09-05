package services

import (
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
)

const (
	DefaultLibraryPageLimit = 60
	MaxLibraryPageLimit     = 200
)

var (
	ErrLibraryNotReady          = errors.New("library is not ready")
	ErrLibraryResourceNotFound  = errors.New("library resource not found")
	ErrLibraryResourceWrongKind = errors.New("library resource has wrong kind")
	ErrLibraryTagNotFound       = errors.New("library tag not found")
)

// LibraryManifest 是首页启动所需的轻量目录描述，不包含相册树或媒体列表。
type LibraryManifest struct {
	Revision   uint64               `json:"revision"`
	ScannedAt  time.Time            `json:"scannedAt"`
	Duration   int64                `json:"duration"`
	Roots      []LibraryRootSummary `json:"roots"`
	Statistics LibraryStatistics    `json:"statistics"`
}

type LibraryStatistics struct {
	RootCount       int `json:"rootCount"`
	AlbumCount      int `json:"albumCount"`
	CollectionCount int `json:"collectionCount"`
	TagCount        int `json:"tagCount"`
	WarningCount    int `json:"warningCount"`
}

type LibraryRootSummary struct {
	ID         string `json:"id"`
	Name       string `json:"name"`
	ChildCount int    `json:"childCount"`
}

// LibraryNodeSummary 是 root/collection 直属子节点的统一卡片 DTO。
// CoverImages 最多四项，可直接用于 collection 的拼贴封面。
type LibraryNodeSummary struct {
	ID          string    `json:"id"`
	Kind        string    `json:"kind"`
	Name        string    `json:"name"`
	DisplayName string    `json:"displayName"`
	SourceRoot  string    `json:"sourceRoot,omitempty"`
	SourceName  string    `json:"sourceName,omitempty"`
	Author      string    `json:"author,omitempty"`
	CoverImage  string    `json:"coverImage,omitempty"`
	CoverImages []string  `json:"coverImages"`
	CoverKind   string    `json:"coverKind,omitempty"`
	ImageCount  int       `json:"imageCount,omitempty"`
	VideoCount  int       `json:"videoCount,omitempty"`
	MediaCount  int       `json:"mediaCount,omitempty"`
	AlbumCount  int       `json:"albumCount,omitempty"`
	ChildCount  int       `json:"childCount,omitempty"`
	FolderSize  int64     `json:"folderSize,omitempty"`
	Tags        []string  `json:"tags,omitempty"`
	ModTime     time.Time `json:"modTime,omitempty"`
	Date        time.Time `json:"date,omitempty"`
	DateSource  string    `json:"dateSource,omitempty"`
	Virtual     bool      `json:"virtual,omitempty"`
}

type LibraryMediaItem struct {
	ID        string `json:"id"`
	Kind      string `json:"kind"`
	Name      string `json:"name"`
	Index     int    `json:"index"`
	KindIndex int    `json:"kindIndex"`
}

type LibraryTagSummary struct {
	Tag         string   `json:"tag"`
	AlbumCount  int      `json:"albumCount"`
	CoverImage  string   `json:"coverImage,omitempty"`
	CoverImages []string `json:"coverImages"`
}

// LibraryPage 在每页都回传 revision；客户端合并分页结果前可再次确认版本。
type LibraryPage[T any] struct {
	Revision   uint64 `json:"revision"`
	Items      []T    `json:"items"`
	Total      int    `json:"total"`
	NextCursor string `json:"nextCursor,omitempty"`
}

// NormalizeLibraryPageLimit 提供服务层的安全默认值与硬上限。
func NormalizeLibraryPageLimit(limit int) int {
	if limit <= 0 {
		return DefaultLibraryPageLimit
	}
	if limit > MaxLibraryPageLimit {
		return MaxLibraryPageLimit
	}
	return limit
}

// libraryPageIndex 随 ResourceCatalog 一次性发布。请求只做游标校验和切片，
// 不再按页遍历目录树、复制完整相册或重复自然排序。
type libraryPageIndex struct {
	manifest  LibraryManifest
	children  map[string][]LibraryNodeSummary
	media     map[string][]LibraryMediaItem
	tags      []LibraryTagSummary
	tagAlbums map[string][]LibraryNodeSummary
}

func buildLibraryPageIndex(state *resourceCatalogState) *libraryPageIndex {
	index := &libraryPageIndex{
		children:  make(map[string][]LibraryNodeSummary),
		media:     make(map[string][]LibraryMediaItem),
		tags:      []LibraryTagSummary{},
		tagAlbums: make(map[string][]LibraryNodeSummary),
	}
	if state == nil || state.result == nil {
		return index
	}

	rootAlbums := make(map[string][]models.Album, len(state.roots))
	rootCollections := make(map[string][]models.Collection, len(state.roots))
	for i := range state.result.Albums {
		album := state.result.Albums[i]
		id := externalID(state, album.Path, ResourceAlbum)
		if ref, ok := state.byID[id]; ok {
			rootAlbums[ref.RootID] = append(rootAlbums[ref.RootID], album)
		}
	}
	for i := range state.result.Collections {
		collection := state.result.Collections[i]
		id := externalID(state, collection.Path, ResourceCollection)
		if ref, ok := state.byID[id]; ok {
			rootCollections[ref.RootID] = append(rootCollections[ref.RootID], collection)
		}
	}
	for _, root := range state.roots {
		index.children[root.ID] = buildNodeIndex(state, rootAlbums[root.ID], rootCollections[root.ID])
	}
	for id, collection := range state.collections {
		index.children[id] = buildNodeIndex(state, collection.Albums, collection.Collections)
	}

	for id, album := range state.albums {
		sources := albumMediaSources(state, album)
		items := make([]LibraryMediaItem, 0, len(sources))
		kindIndexes := map[string]int{"image": 0, "video": 0}
		for itemIndex, source := range sources {
			items = append(items, LibraryMediaItem{
				ID:        source.id,
				Kind:      source.kind,
				Name:      filepath.Base(source.path),
				Index:     itemIndex,
				KindIndex: kindIndexes[source.kind],
			})
			kindIndexes[source.kind]++
		}
		index.media[id] = items
	}

	smartCollections := append([]models.SmartCollection(nil), state.result.SmartCollections...)
	sort.SliceStable(smartCollections, func(i, j int) bool {
		return naturalLess(tagName(smartCollections[i]), tagName(smartCollections[j]))
	})
	for _, smart := range smartCollections {
		index.tags = append(index.tags, tagSummary(state, smart))
		albums := append([]models.Album(nil), smart.Albums...)
		sort.SliceStable(albums, func(i, j int) bool {
			return albumNaturalLess(albums[i], albums[j])
		})
		summaries := make([]LibraryNodeSummary, 0, len(albums))
		for _, album := range albums {
			summaries = append(summaries, albumSummary(state, album))
		}
		if smart.Tag != "" {
			index.tagAlbums[smart.Tag] = summaries
		}
		if smart.Author != "" {
			index.tagAlbums[smart.Author] = summaries
		}
	}

	index.manifest = buildIndexedLibraryManifest(state, index)
	return index
}

func buildNodeIndex(state *resourceCatalogState, albums []models.Album, collections []models.Collection) []LibraryNodeSummary {
	albums = append([]models.Album(nil), albums...)
	collections = append([]models.Collection(nil), collections...)
	sortNodeSources(albums, collections)
	return mergeNodePage(state, albums, collections, 0, len(albums)+len(collections))
}

func buildIndexedLibraryManifest(state *resourceCatalogState, index *libraryPageIndex) LibraryManifest {
	result := state.result
	snapshot := CatalogSnapshot{state: state}
	roots := make([]LibraryRootSummary, 0, len(state.roots))
	seenRoots := make(map[string]struct{}, len(state.roots))
	appendRoot := func(path string) {
		id := externalID(state, path, ResourceRoot)
		if id == "" {
			return
		}
		if _, exists := seenRoots[id]; exists {
			return
		}
		seenRoots[id] = struct{}{}
		roots = append(roots, LibraryRootSummary{
			ID: id, Name: snapshot.RelativeLabel(id), ChildCount: len(index.children[id]),
		})
	}
	for _, root := range result.Roots {
		appendRoot(root)
	}
	if len(result.Roots) == 0 {
		appendRoot(result.Root)
	}
	// 旧扫描快照可能缺少 Roots；补齐配置根，同时保持路径脱敏。
	for _, root := range state.roots {
		if _, exists := seenRoots[root.ID]; exists {
			continue
		}
		roots = append(roots, LibraryRootSummary{
			ID: root.ID, Name: snapshot.RelativeLabel(root.ID), ChildCount: len(index.children[root.ID]),
		})
	}
	return LibraryManifest{
		Revision:  state.revision,
		ScannedAt: result.ScannedAt,
		Duration:  result.Duration,
		Roots:     roots,
		Statistics: LibraryStatistics{
			RootCount:       len(roots),
			AlbumCount:      result.AlbumCount,
			CollectionCount: result.CollectionCount,
			TagCount:        len(index.tags),
			WarningCount:    len(result.Warnings),
		},
	}
}

func BuildLibraryManifest(snapshot CatalogSnapshot) (LibraryManifest, error) {
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return LibraryManifest{}, ErrLibraryNotReady
	}
	manifest := snapshot.state.library.manifest
	manifest.Roots = append([]LibraryRootSummary(nil), manifest.Roots...)
	return manifest, nil
}

func PageLibraryChildren(snapshot CatalogSnapshot, parentID, cursor string, limit int) (LibraryPage[LibraryNodeSummary], error) {
	scope := "library-children:" + parentID
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryNotReady
	}
	ref, exists := snapshot.state.byID[parentID]
	if !exists {
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryResourceNotFound
	}

	switch ref.Kind {
	case ResourceRoot, ResourceCollection:
	default:
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryResourceWrongKind
	}
	items, exists := snapshot.state.library.children[parentID]
	if !exists {
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryResourceNotFound
	}
	total := len(items)
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, total, limit)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	return LibraryPage[LibraryNodeSummary]{
		Revision: snapshot.Revision(), Items: cloneNodePage(items, start, end), Total: total, NextCursor: next,
	}, nil
}

func PageAlbumMedia(snapshot CatalogSnapshot, albumID, cursor string, limit int) (LibraryPage[LibraryMediaItem], error) {
	scope := "album-media:" + albumID
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryMediaItem]{}, err
	}
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryNotReady
	}
	ref, exists := snapshot.state.byID[albumID]
	if !exists {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceNotFound
	}
	if ref.Kind != ResourceAlbum {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceWrongKind
	}
	media, exists := snapshot.state.library.media[albumID]
	if !exists {
		return LibraryPage[LibraryMediaItem]{}, ErrLibraryResourceNotFound
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(media), limit)
	if err != nil {
		return LibraryPage[LibraryMediaItem]{}, err
	}
	return LibraryPage[LibraryMediaItem]{
		Revision: snapshot.Revision(), Items: clonePage(media, start, end), Total: len(media), NextCursor: next,
	}, nil
}

func PageLibraryTags(snapshot CatalogSnapshot, cursor string, limit int) (LibraryPage[LibraryTagSummary], error) {
	const scope = "library-tags"
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryTagSummary]{}, err
	}
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return LibraryPage[LibraryTagSummary]{}, ErrLibraryNotReady
	}
	tags := snapshot.state.library.tags
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(tags), limit)
	if err != nil {
		return LibraryPage[LibraryTagSummary]{}, err
	}
	return LibraryPage[LibraryTagSummary]{
		Revision: snapshot.Revision(), Items: cloneTagPage(tags, start, end), Total: len(tags), NextCursor: next,
	}, nil
}

func PageTagAlbums(snapshot CatalogSnapshot, tag, cursor string, limit int) (LibraryPage[LibraryNodeSummary], error) {
	tag = strings.TrimSpace(tag)
	scope := "tag-albums:" + tag
	offset, err := pageOffset(snapshot, cursor, scope)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	if !snapshot.Ready() || snapshot.state == nil || snapshot.state.library == nil {
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryNotReady
	}
	albums, exists := snapshot.state.library.tagAlbums[tag]
	if !exists {
		return LibraryPage[LibraryNodeSummary]{}, ErrLibraryTagNotFound
	}
	start, end, next, err := pageBounds(snapshot.Revision(), scope, cursor != "", offset, len(albums), limit)
	if err != nil {
		return LibraryPage[LibraryNodeSummary]{}, err
	}
	return LibraryPage[LibraryNodeSummary]{
		Revision: snapshot.Revision(), Items: cloneNodePage(albums, start, end), Total: len(albums), NextCursor: next,
	}, nil
}

func clonePage[T any](items []T, start, end int) []T {
	if start == end {
		return []T{}
	}
	return append([]T(nil), items[start:end]...)
}

func cloneNodePage(items []LibraryNodeSummary, start, end int) []LibraryNodeSummary {
	out := clonePage(items, start, end)
	for i := range out {
		out[i].CoverImages = append([]string(nil), out[i].CoverImages...)
		out[i].Tags = append([]string(nil), out[i].Tags...)
	}
	return out
}

func cloneTagPage(items []LibraryTagSummary, start, end int) []LibraryTagSummary {
	out := clonePage(items, start, end)
	for i := range out {
		out[i].CoverImages = append([]string(nil), out[i].CoverImages...)
	}
	return out
}

func pageOffset(snapshot CatalogSnapshot, cursor, scope string) (int, error) {
	if cursor == "" {
		return 0, nil
	}
	return DecodePageCursor(cursor, snapshot.Revision(), scope)
}

func pageBounds(revision uint64, scope string, hasCursor bool, offset, total, limit int) (int, int, string, error) {
	if offset < 0 || offset > total || (hasCursor && (total == 0 || offset == total)) {
		return 0, 0, "", ErrInvalidPageCursor
	}
	limit = NormalizeLibraryPageLimit(limit)
	end := offset + limit
	if end > total {
		end = total
	}
	next := ""
	if end < total {
		var err error
		next, err = EncodePageCursor(revision, scope, end)
		if err != nil {
			return 0, 0, "", fmt.Errorf("encode next page: %w", err)
		}
	}
	return offset, end, next, nil
}

func sortNodeSources(albums []models.Album, collections []models.Collection) {
	sort.SliceStable(albums, func(i, j int) bool { return albumNaturalLess(albums[i], albums[j]) })
	sort.SliceStable(collections, func(i, j int) bool {
		return naturalLess(nodeDisplayName(collections[i].DisplayName, collections[i].Name),
			nodeDisplayName(collections[j].DisplayName, collections[j].Name))
	})
}

func mergeNodePage(state *resourceCatalogState, albums []models.Album, collections []models.Collection, start, end int) []LibraryNodeSummary {
	items := make([]LibraryNodeSummary, 0, end-start)
	albumIndex, collectionIndex, mergedIndex := 0, 0, 0
	for mergedIndex < end && (albumIndex < len(albums) || collectionIndex < len(collections)) {
		useAlbum := collectionIndex >= len(collections)
		if albumIndex < len(albums) && collectionIndex < len(collections) {
			useAlbum = albumBeforeCollection(albums[albumIndex], collections[collectionIndex])
		}
		if useAlbum {
			if mergedIndex >= start {
				items = append(items, albumSummary(state, albums[albumIndex]))
			}
			albumIndex++
		} else {
			if mergedIndex >= start {
				items = append(items, collectionSummary(state, collections[collectionIndex]))
			}
			collectionIndex++
		}
		mergedIndex++
	}
	return items
}

func albumBeforeCollection(album models.Album, collection models.Collection) bool {
	if album.Virtual {
		return true
	}
	aName := nodeDisplayName(album.DisplayName, album.Name)
	cName := nodeDisplayName(collection.DisplayName, collection.Name)
	if naturalLess(aName, cName) {
		return true
	}
	if naturalLess(cName, aName) {
		return false
	}
	return true // 同名时 album 在前，保证跨请求顺序稳定。
}

func albumNaturalLess(left, right models.Album) bool {
	if left.Virtual != right.Virtual {
		return left.Virtual
	}
	leftName := nodeDisplayName(left.DisplayName, left.Name)
	rightName := nodeDisplayName(right.DisplayName, right.Name)
	if naturalLess(leftName, rightName) {
		return true
	}
	if naturalLess(rightName, leftName) {
		return false
	}
	return left.Path < right.Path
}

func nodeDisplayName(displayName, name string) string {
	if displayName != "" {
		return displayName
	}
	return name
}

func albumSummary(state *resourceCatalogState, album models.Album) LibraryNodeSummary {
	id := externalID(state, album.Path, ResourceAlbum)
	sourceRoot, sourceName := nodeSource(state, id, album.SourceRoot, album.SourceName)
	cover := externalID(state, album.CoverImage, ResourceFile)
	covers := []string{}
	if cover != "" {
		covers = append(covers, cover)
	}
	tags := append([]string(nil), album.Tags...)
	return LibraryNodeSummary{
		ID:          id,
		Kind:        string(ResourceAlbum),
		Name:        album.Name,
		DisplayName: nodeDisplayName(album.DisplayName, album.Name),
		SourceRoot:  sourceRoot,
		SourceName:  sourceName,
		Author:      album.Author,
		CoverImage:  cover,
		CoverImages: covers,
		CoverKind:   album.CoverKind,
		ImageCount:  album.ImageCount,
		VideoCount:  album.VideoCount,
		MediaCount:  len(album.ImageFiles) + len(album.VideoFiles),
		FolderSize:  album.FolderSize,
		Tags:        tags,
		ModTime:     album.ModTime,
		Date:        album.Date,
		DateSource:  album.DateSource,
		Virtual:     album.Virtual,
	}
}

func collectionSummary(state *resourceCatalogState, collection models.Collection) LibraryNodeSummary {
	id := externalID(state, collection.Path, ResourceCollection)
	sourceRoot, sourceName := nodeSource(state, id, collection.SourceRoot, collection.SourceName)
	covers, coverKind := collectionCovers(state, collection, 4)
	cover := ""
	if len(covers) > 0 {
		cover = covers[0]
	}
	return LibraryNodeSummary{
		ID:          id,
		Kind:        string(ResourceCollection),
		Name:        collection.Name,
		DisplayName: nodeDisplayName(collection.DisplayName, collection.Name),
		SourceRoot:  sourceRoot,
		SourceName:  sourceName,
		CoverImage:  cover,
		CoverImages: covers,
		CoverKind:   coverKind,
		AlbumCount:  collection.AlbumCount,
		ChildCount:  len(collection.Albums) + len(collection.Collections),
	}
}

func nodeSource(state *resourceCatalogState, id, configuredRoot, configuredName string) (string, string) {
	rootID := externalID(state, configuredRoot, ResourceRoot)
	if rootID == "" {
		if ref, exists := state.byID[id]; exists {
			rootID = ref.RootID
		}
	}
	name := configuredName
	if name == "" {
		if root, exists := state.byID[rootID]; exists {
			name = filepath.Base(root.AbsolutePath)
		}
	}
	return rootID, name
}

func collectionCovers(state *resourceCatalogState, collection models.Collection, maximum int) ([]string, string) {
	covers := make([]string, 0, maximum)
	coverKind := ""
	var visit func(models.Collection)
	visit = func(current models.Collection) {
		for i := range current.Albums {
			if len(covers) >= maximum {
				return
			}
			if id := externalID(state, current.Albums[i].CoverImage, ResourceFile); id != "" {
				covers = append(covers, id)
				if coverKind == "" {
					coverKind = current.Albums[i].CoverKind
				}
			}
		}
		for i := range current.Collections {
			if len(covers) >= maximum {
				return
			}
			visit(current.Collections[i])
		}
	}
	visit(collection)
	return covers, coverKind
}

type albumMediaSource struct {
	id   string
	kind string
	path string
}

func albumMediaSources(state *resourceCatalogState, album models.Album) []albumMediaSource {
	media := make([]albumMediaSource, 0, len(album.ImageFiles)+len(album.VideoFiles))
	seen := make(map[string]struct{}, cap(media))
	appendMedia := func(path, kind string) {
		if path == "" {
			return
		}
		key := pathKindKey(path, ResourceFile)
		if _, exists := seen[key]; exists {
			return
		}
		id := externalID(state, path, ResourceFile)
		if id == "" {
			return
		}
		seen[key] = struct{}{}
		media = append(media, albumMediaSource{id: id, kind: kind, path: path})
	}
	for _, path := range album.ImageFiles {
		appendMedia(path, "image")
	}
	for _, path := range album.VideoFiles {
		appendMedia(path, "video")
	}
	// 兼容仅包含 Files 的旧快照；当前扫描器始终填充分类后的两个字段。
	if len(album.ImageFiles) == 0 && len(album.VideoFiles) == 0 {
		for _, path := range album.Files {
			switch {
			case models.IsImageFile(path):
				appendMedia(path, "image")
			case models.IsVideoFile(path):
				appendMedia(path, "video")
			}
		}
	}
	sort.SliceStable(media, func(i, j int) bool {
		leftName, rightName := filepath.Base(media[i].path), filepath.Base(media[j].path)
		if naturalLess(leftName, rightName) {
			return true
		}
		if naturalLess(rightName, leftName) {
			return false
		}
		if media[i].kind != media[j].kind {
			return media[i].kind < media[j].kind
		}
		return media[i].path < media[j].path
	})
	return media
}

func tagName(smart models.SmartCollection) string {
	if smart.Tag != "" {
		return smart.Tag
	}
	return smart.Author
}

func tagSummary(state *resourceCatalogState, smart models.SmartCollection) LibraryTagSummary {
	covers := make([]string, 0, 4)
	for i := range smart.Albums {
		if len(covers) >= 4 {
			break
		}
		if id := externalID(state, smart.Albums[i].CoverImage, ResourceFile); id != "" {
			covers = append(covers, id)
		}
	}
	cover := externalID(state, smart.CoverImage, ResourceFile)
	if cover == "" && len(covers) > 0 {
		cover = covers[0]
	}
	return LibraryTagSummary{
		Tag: tagName(smart), AlbumCount: smart.AlbumCount, CoverImage: cover, CoverImages: covers,
	}
}
