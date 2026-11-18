package services

import (
	"crypto/sha256"
	"encoding/hex"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/pathutil"
)

// IncrementalOutcome 是一次增量更新的结果。
type IncrementalOutcome struct {
	// Result 是合并后的完整扫描结果。
	Result *models.ScanResult
	// AddedFiles 是新出现在索引里的媒体文件（绝对路径）。
	AddedFiles []string
	// RemovedFiles 是从索引里消失的媒体文件（绝对路径）。
	RemovedFiles []string
	// AddedDirs 是新出现的目录（绝对路径）。
	AddedDirs []string
	// RemovedDirs 是消失的目录（绝对路径）。
	RemovedDirs []string
	// ChangedAlbums 是内容发生变化的相册目录（绝对路径）。
	ChangedAlbums []string
	// Warnings 是本轮重新读取目录时产生的告警。
	Warnings []models.ScanWarning
	// RescannedDirs 是本轮真正重新读取磁盘的目录数量。
	RescannedDirs int
	// Changed 表示图库结构确实变了。
	//
	// 只被碰了一下（目录修改时间变了、内容没变）不算变化：
	// 那样的发布只会让图库版本跳动，界面跟着白刷一遍。
	Changed bool
}

// ChangedResourceCount 是这次变化里新增、删除与内容变动的资源数量。
func (o *IncrementalOutcome) ChangedResourceCount() int {
	if o == nil {
		return 0
	}
	return len(o.AddedFiles) + len(o.RemovedFiles)
}

// dirNode 是扫描结果树里的一个目录节点。
//
// 一个目录要么是「叶子相册」（只有文件、没有子目录），要么是「集合」
// （有子目录，目录里散落的照片以虚拟相册的形式挂在集合下）。
// 两种形态互斥，因此用 collection 是否为空来区分。
type dirNode struct {
	path       string
	album      *models.Album
	collection *models.Collection
	children   map[string]*dirNode
	files      []string
}

// treeIndex 是上一份扫描结果按目录展开的索引。
//
// 增量更新靠它回答两个问题：某个目录以前长什么样（用于算出新增与
// 消失的文件），以及某个目录的子树能不能整段复用（不用重读磁盘）。
type treeIndex struct {
	nodes map[string]*dirNode
}

func (i *treeIndex) node(path string) *dirNode {
	if i == nil {
		return nil
	}
	return i.nodes[filepath.Clean(path)]
}

// syncDiff 收集一次增量更新里的差异。
type syncDiff struct {
	addedFiles   []string
	removedFiles []string
	addedDirs    []string
	removedDirs  []string
	changedDirs  map[string]struct{}
	warnings     []models.ScanWarning
}

// IncrementalEngine 把一批文件变化合并进上一份扫描结果。
//
// 它只重读「内容可能变了」的目录，其余子树整段复用上一份结果，
// 因此一次文件新增不会退化成全库扫描。合并结果是一份完整的新快照，
// 由调用方原子发布；中途失败时上一份快照原样保留。
type IncrementalEngine struct{}

// NewIncrementalEngine 创建增量扫描引擎。
func NewIncrementalEngine() *IncrementalEngine { return &IncrementalEngine{} }

// Apply 把一批文件变化合并进上一份扫描结果。
//
// previous 是上一份已发布的扫描结果（可以为空，等价于全量重建）。
// changes 是监听器给出的变化集合。opts 提供当前的媒体根与排除规则。
func (e *IncrementalEngine) Apply(
	previous *models.ScanResult,
	changes *SyncChangeSet,
	opts ScanOptions,
) (*IncrementalOutcome, error) {
	if changes == nil {
		changes = newSyncChangeSet()
	}
	roots, rootPaths, offline := prepareSyncRoots(opts)
	index := buildTreeIndex(previous, rootPaths)
	rebuild := computeRebuildSet(changes, rootPaths)

	scanner := NewScanner()
	scanner.rootKeys = make(map[string]struct{}, len(rootPaths))
	for _, path := range rootPaths {
		scanner.rootKeys[pathutil.RootKey(path)] = struct{}{}
	}

	diff := &syncDiff{changedDirs: make(map[string]struct{})}
	var allAlbums []models.Album
	var allCollections []models.Collection
	rescanned := 0

	for _, root := range roots {
		albums, collections, count, err := e.rebuildRoot(root, index, rebuild, opts, scanner, diff)
		if err != nil {
			return nil, err
		}
		rescanned += count
		allAlbums = append(allAlbums, albums...)
		allCollections = append(allCollections, collections...)
	}
	// 离线的根（网络共享断了、磁盘没插上）保留上一份结果里的内容：
	// 一个根读不到不该让其它根的变化也一起丢掉。
	for _, path := range offline {
		albums, collections := previousRootContent(previous, path, rootPaths)
		allAlbums = append(allAlbums, albums...)
		allCollections = append(allCollections, collections...)
		diff.warnings = append(diff.warnings, models.ScanWarning{
			Code:    "root_unavailable",
			Path:    filepath.Base(filepath.Clean(path)),
			Message: "媒体根暂时不可用，已保留上次的结果",
		})
	}

	conflicts := albumDisplayConflicts(allAlbums, allCollections)
	allAlbums, allCollections = normalizeDisplayNames(allAlbums, allCollections, conflicts)
	allCollections = normalizeCollectionDisplayNames(allCollections)

	flat := flattenAlbums(allAlbums, allCollections)
	result := &models.ScanResult{
		Roots:            rootPaths,
		Albums:           allAlbums,
		Collections:      allCollections,
		SmartCollections: GroupByTag(flat),
		AlbumCount:       len(flat),
		CollectionCount:  countCollections(allCollections),
		Duration:         0,
		ScannedAt:        time.Now(),
		Warnings:         diff.warnings,
	}

	return &IncrementalOutcome{
		Result:        result,
		AddedFiles:    diff.addedFiles,
		RemovedFiles:  diff.removedFiles,
		AddedDirs:     diff.addedDirs,
		RemovedDirs:   diff.removedDirs,
		ChangedAlbums: sortedKeys(diff.changedDirs),
		Warnings:      diff.warnings,
		RescannedDirs: rescanned,
		Changed:       resultFingerprint(result) != resultFingerprint(previous),
	}, nil
}

// prepareSyncRoots 逐个准备媒体根。
//
// 与全量扫描不同，这里不会因为某个根不可用就整体失败：离线的根被单独
// 列出来，调用方保留它上一份的内容，其余根照常更新。返回值分别是
// 可用的根、全部根路径与离线的根路径。
func prepareSyncRoots(opts ScanOptions) ([]scanRoot, []string, []string) {
	paths := opts.effectiveRoots()
	prepared := make([]scanRoot, 0, len(paths))
	offline := make([]string, 0)
	for _, path := range paths {
		absolute, err := filepath.Abs(path)
		if err != nil {
			absolute = filepath.Clean(path)
		}
		info, err := readScanRoot(absolute)
		if err != nil {
			offline = append(offline, absolute)
			continue
		}
		prepared = append(prepared, scanRoot{path: absolute, info: info})
	}
	return prepared, paths, offline
}

// previousRootContent 取出上一份结果里属于某个媒体根的顶层相册与集合。
func previousRootContent(previous *models.ScanResult, root string, roots []string) ([]models.Album, []models.Collection) {
	if previous == nil {
		return nil, nil
	}
	clean := filepath.Clean(root)
	var albums []models.Album
	var collections []models.Collection
	for i := range previous.Albums {
		owner, _, matched := pathutil.MostSpecificRoot(previous.Albums[i].Path, roots)
		if matched && filepath.Clean(owner) == clean {
			albums = append(albums, previous.Albums[i])
		}
	}
	for i := range previous.Collections {
		owner, _, matched := pathutil.MostSpecificRoot(previous.Collections[i].Path, roots)
		if matched && filepath.Clean(owner) == clean {
			collections = append(collections, previous.Collections[i])
		}
	}
	return albums, collections
}

// resultFingerprint 算出扫描结果的结构指纹。
//
// 指纹覆盖目录结构、媒体清单与目录修改时间：这三样变了才值得重新
// 发布。只碰了一下目录（内容没变）不会让指纹变化，图库版本也就不跳动。
func resultFingerprint(result *models.ScanResult) string {
	if result == nil {
		return ""
	}
	hash := sha256.New()
	write := func(parts ...string) {
		for _, part := range parts {
			hash.Write([]byte(part))
			hash.Write([]byte{0})
		}
	}
	var walk func(albums []models.Album, collections []models.Collection)
	walk = func(albums []models.Album, collections []models.Collection) {
		for i := range albums {
			write(albums[i].Path)
			for _, file := range albums[i].ImageFiles {
				write("i", file)
			}
			for _, file := range albums[i].VideoFiles {
				write("v", file)
			}
			write(albums[i].ModTime.UTC().Format(time.RFC3339Nano))
		}
		for i := range collections {
			write(collections[i].Path)
			write(collections[i].ModTime.UTC().Format(time.RFC3339Nano))
			walk(collections[i].Albums, collections[i].Collections)
		}
	}
	walk(result.Albums, result.Collections)
	return hex.EncodeToString(hash.Sum(nil))
}

// rebuildRoot 重建一个媒体根的顶层结果。
func (e *IncrementalEngine) rebuildRoot(
	root scanRoot,
	index *treeIndex,
	rebuild map[string]bool,
	opts ScanOptions,
	scanner *Scanner,
	diff *syncDiff,
) ([]models.Album, []models.Collection, int, error) {
	old := index.node(root.path)
	record, warnings, err := inspectForSync(scanner, root, root.path, 0, opts)
	if err != nil {
		return nil, nil, 0, err
	}
	diff.warnings = append(diff.warnings, warnings...)
	childAlbums, childCollections, err := e.rebuildChildren(root, old, record, rebuild, opts, scanner, diff)
	if err != nil {
		return nil, nil, 0, err
	}
	hasFiles := len(record.images)+len(record.videos) > 0
	hasChildren := len(childAlbums)+len(childCollections) > 0

	var albums []models.Album
	if hasFiles {
		album := buildAlbum(root.path, record.images, record.videos)
		if hasChildren {
			album.Name = models.VirtualAlbumName
			album.DisplayName = album.Name
			album.Virtual = true
		}
		stampNewAlbum(album, root.path, filepath.Base(root.path))
		albums = append(albums, *album)
	}
	albums = append(albums, childAlbums...)
	collections := childCollections
	sortLibraryNodes(albums, collections)
	return albums, collections, 1, nil
}

// rebuildChildren 重建一个目录的子目录列表。
//
// 子目录分三类处理：整棵子树都没变就复用；变了或者新出现的重新读取；
// 以前有现在没了的整棵子树从索引里摘掉。
func (e *IncrementalEngine) rebuildChildren(
	root scanRoot,
	old *dirNode,
	record directoryRecord,
	rebuild map[string]bool,
	opts ScanOptions,
	scanner *Scanner,
	diff *syncDiff,
) ([]models.Album, []models.Collection, error) {
	var childAlbums []models.Album
	var childCollections []models.Collection
	oldChildren := map[string]*dirNode{}
	if old != nil {
		oldChildren = old.children
	}
	seen := make(map[string]struct{}, len(record.children))
	for _, childPath := range record.children {
		clean := filepath.Clean(childPath)
		seen[clean] = struct{}{}
		oldChild := oldChildren[clean]
		if oldChild != nil && !rebuild[clean] {
			// 整棵子树没有变化：直接复用旧节点，不碰磁盘。
			if oldChild.collection != nil {
				childCollections = append(childCollections, *oldChild.collection)
			} else if oldChild.album != nil {
				childAlbums = append(childAlbums, *oldChild.album)
			}
			continue
		}
		node, err := e.rebuildNode(root, clean, oldChild, rebuild, opts, scanner, diff)
		if err != nil {
			return nil, nil, err
		}
		if node == nil {
			continue
		}
		if node.collection != nil {
			childCollections = append(childCollections, *node.collection)
		} else if node.album != nil {
			childAlbums = append(childAlbums, *node.album)
		}
	}
	// 以前有、现在没了的子目录：整棵子树从索引里消失。
	for path, oldChild := range oldChildren {
		if _, exists := seen[path]; exists {
			continue
		}
		diff.removeNode(oldChild)
		diff.removedDirs = append(diff.removedDirs, path)
	}
	return childAlbums, childCollections, nil
}

// rebuildNode 重建一个子目录。
func (e *IncrementalEngine) rebuildNode(
	root scanRoot,
	path string,
	old *dirNode,
	rebuild map[string]bool,
	opts ScanOptions,
	scanner *Scanner,
	diff *syncDiff,
) (*dirNode, error) {
	depth := scanDepth(root.path, path)
	record, warnings, err := inspectForSync(scanner, root, path, depth, opts)
	if err != nil {
		return nil, err
	}
	diff.warnings = append(diff.warnings, warnings...)
	childAlbums, childCollections, err := e.rebuildChildren(root, old, record, rebuild, opts, scanner, diff)
	if err != nil {
		return nil, err
	}
	hasFiles := len(record.images)+len(record.videos) > 0
	hasChildren := len(childAlbums)+len(childCollections) > 0

	if hasFiles && !hasChildren {
		album := buildAlbum(path, record.images, record.videos)
		stampNewAlbum(album, root.path, filepath.Base(root.path))
		diff.diffAlbum(path, old, album)
		if old == nil {
			diff.addedDirs = append(diff.addedDirs, path)
		}
		return &dirNode{
			path:     path,
			album:    album,
			files:    albumFiles(album),
			children: map[string]*dirNode{},
		}, nil
	}
	if !hasFiles && !hasChildren {
		// 目录空了：它不再出现在索引里。
		if old != nil {
			diff.removeNode(old)
		}
		diff.removedDirs = append(diff.removedDirs, path)
		return nil, nil
	}

	var albums []models.Album
	if hasFiles {
		loose := buildAlbum(path, record.images, record.videos)
		loose.Name = models.VirtualAlbumName
		loose.DisplayName = loose.Name
		loose.Virtual = true
		stampNewAlbum(loose, root.path, filepath.Base(root.path))
		diff.diffAlbum(path, old, loose)
		albums = append(albums, *loose)
	}
	albums = append(albums, childAlbums...)
	sortLibraryNodes(albums, childCollections)

	collection := &models.Collection{
		Type:        "collection",
		Path:        path,
		Name:        filepath.Base(path),
		DisplayName: filepath.Base(path),
		Albums:      albums,
		Collections: childCollections,
		AlbumCount:  descendantAlbumCount(albums, childCollections),
	}
	stampNewCollection(collection, root.path, filepath.Base(root.path))
	applyCollectionDate(collection, path)
	if old == nil {
		diff.addedDirs = append(diff.addedDirs, path)
	}
	return &dirNode{
		path:       path,
		collection: collection,
		files:      albumFilesOf(albums),
		children:   map[string]*dirNode{},
	}, nil
}

// inspectForSync 重新读取一个目录，复用扫描器的目录读取规则。
//
// 复用扫描器而不是另写一份，是为了让增量更新与全量扫描对同一个目录
// 的判断完全一致：排除规则、符号链接、嵌套媒体根、.nomedia 标记。
func inspectForSync(
	scanner *Scanner,
	root scanRoot,
	path string,
	depth int,
	opts ScanOptions,
) (directoryRecord, []models.ScanWarning, error) {
	result := scanner.inspectDirectory(root, directoryTask{path: path, depth: depth}, opts.MaxDepth, opts.Exclude)
	if result.err != nil {
		return directoryRecord{}, nil, result.err
	}
	return result.record, result.warnings, nil
}

// buildTreeIndex 把上一份扫描结果展开成按目录索引的树。
func buildTreeIndex(result *models.ScanResult, roots []string) *treeIndex {
	index := &treeIndex{nodes: make(map[string]*dirNode)}
	ensure := func(path string) *dirNode {
		key := filepath.Clean(path)
		node, exists := index.nodes[key]
		if !exists {
			node = &dirNode{path: key, children: map[string]*dirNode{}}
			index.nodes[key] = node
		}
		return node
	}
	for _, root := range roots {
		ensure(root)
	}
	if result == nil {
		return index
	}
	for i := range result.Albums {
		album := &result.Albums[i]
		owner, _, matched := pathutil.MostSpecificRoot(album.Path, roots)
		if !matched {
			continue
		}
		rootNode := ensure(owner)
		if filepath.Clean(album.Path) == filepath.Clean(owner) {
			// 媒体根自身的散图相册。
			if rootNode.album == nil {
				rootNode.album = album
				rootNode.files = albumFiles(album)
			}
			continue
		}
		child := ensure(album.Path)
		if child.album == nil {
			child.album = album
			child.files = albumFiles(album)
		}
		rootNode.children[child.path] = child
	}
	for i := range result.Collections {
		collection := &result.Collections[i]
		owner, _, matched := pathutil.MostSpecificRoot(collection.Path, roots)
		if !matched {
			continue
		}
		rootNode := ensure(owner)
		child := ensure(collection.Path)
		child.collection = collection
		rootNode.children[child.path] = child
		attachCollectionNodes(child, collection)
	}
	return index
}

// attachCollectionNodes 把集合内部的相册与子集合挂到节点上。
func attachCollectionNodes(node *dirNode, collection *models.Collection) {
	for i := range collection.Albums {
		album := &collection.Albums[i]
		clean := filepath.Clean(album.Path)
		if clean == filepath.Clean(collection.Path) {
			// 集合目录自身的散图（虚拟相册）。
			node.album = album
			node.files = albumFiles(album)
			continue
		}
		leaf := &dirNode{
			path:     clean,
			album:    album,
			files:    albumFiles(album),
			children: map[string]*dirNode{},
		}
		node.children[clean] = leaf
	}
	for i := range collection.Collections {
		sub := &collection.Collections[i]
		subNode := &dirNode{
			path:       filepath.Clean(sub.Path),
			collection: sub,
			children:   map[string]*dirNode{},
		}
		node.children[subNode.path] = subNode
		attachCollectionNodes(subNode, sub)
	}
}

// computeRebuildSet 算出需要重新读取的目录集合。
//
// 一个目录的内容变了，它的所有祖先都要重新读取 —— 祖先的子树结构
// （这个目录是不是叶子相册、有没有虚拟相册）可能随之改变。
func computeRebuildSet(changes *SyncChangeSet, roots []string) map[string]bool {
	rebuild := make(map[string]bool)
	mark := func(path string) {
		owner, relative, matched := pathutil.MostSpecificRoot(path, roots)
		if !matched {
			return
		}
		current := filepath.Clean(owner)
		rebuild[current] = true
		if relative == "." || relative == "" {
			return
		}
		for _, part := range strings.Split(filepath.ToSlash(relative), "/") {
			if part == "" || part == "." {
				continue
			}
			current = filepath.Join(current, part)
			rebuild[current] = true
		}
	}
	for dir := range changes.Dirs {
		mark(dir)
	}
	for file := range changes.Files {
		mark(filepath.Dir(file))
	}
	return rebuild
}

// diffAlbum 比较一个目录重建前后的媒体文件，算出新增与消失的部分。
func (d *syncDiff) diffAlbum(path string, old *dirNode, album *models.Album) {
	newFiles := albumFiles(album)
	var oldFiles []string
	if old != nil {
		oldFiles = old.files
	}
	added, removed := diffFileSets(oldFiles, newFiles)
	d.addedFiles = append(d.addedFiles, added...)
	d.removedFiles = append(d.removedFiles, removed...)
	if len(added) == 0 && len(removed) == 0 && old != nil {
		return
	}
	d.changedDirs[path] = struct{}{}
}

// removeNode 把一整棵消失的子树里的文件记为删除。
func (d *syncDiff) removeNode(node *dirNode) {
	if node == nil {
		return
	}
	if node.album != nil {
		d.removedFiles = append(d.removedFiles, node.files...)
	}
	for _, child := range node.children {
		d.removeNode(child)
	}
}

// albumFiles 返回相册里的全部媒体文件。
func albumFiles(album *models.Album) []string {
	if album == nil {
		return nil
	}
	files := make([]string, 0, len(album.ImageFiles)+len(album.VideoFiles))
	files = append(files, album.ImageFiles...)
	files = append(files, album.VideoFiles...)
	return files
}

// albumFilesOf 返回一组相册里的全部媒体文件。
func albumFilesOf(albums []models.Album) []string {
	var files []string
	for i := range albums {
		files = append(files, albumFiles(&albums[i])...)
	}
	return files
}

// diffFileSets 比较两份媒体文件清单，算出新增与消失的部分。
//
// 比较按平台的路径大小写规则进行：Windows 上大小写不敏感。
func diffFileSets(oldFiles, newFiles []string) (added, removed []string) {
	oldSet := make(map[string]struct{}, len(oldFiles))
	for _, file := range oldFiles {
		oldSet[pathKindKey(file, ResourceFile)] = struct{}{}
	}
	newSet := make(map[string]struct{}, len(newFiles))
	for _, file := range newFiles {
		newSet[pathKindKey(file, ResourceFile)] = struct{}{}
	}
	for _, file := range newFiles {
		if _, exists := oldSet[pathKindKey(file, ResourceFile)]; !exists {
			added = append(added, file)
		}
	}
	for _, file := range oldFiles {
		if _, exists := newSet[pathKindKey(file, ResourceFile)]; !exists {
			removed = append(removed, file)
		}
	}
	return added, removed
}

// stampNewAlbum 给新建的相册补上来源与展示信息。
//
// 复用到的旧相册已经带着这些字段，不在这里改写 —— 旧节点与已发布的
// 快照共享结构，改写会污染正在被读取的视图。
func stampNewAlbum(album *models.Album, srcRoot, srcName string) {
	album.SourceRoot = srcRoot
	album.SourceName = srcName
	if album.DisplayName == "" {
		album.DisplayName = album.Name
	}
	if album.Virtual {
		album.Location = albumLocation(srcRoot, album.Path)
		if album.Location != "" {
			album.DisplayName = album.Location
		}
	}
}

// stampNewCollection 给新建的集合补上来源与展示信息。
func stampNewCollection(collection *models.Collection, srcRoot, srcName string) {
	collection.SourceRoot = srcRoot
	collection.SourceName = srcName
	if collection.DisplayName == "" {
		collection.DisplayName = collection.Name
	}
}

// albumDisplayConflicts 统计整棵树的同名相册分布。
func albumDisplayConflicts(albums []models.Album, collections []models.Collection) map[string]int {
	counts := make(map[string]int)
	var walk func(albums []models.Album, collections []models.Collection)
	walk = func(albums []models.Album, collections []models.Collection) {
		for i := range albums {
			counts[albumDisplayBase(albums[i])]++
		}
		for i := range collections {
			walk(collections[i].Albums, collections[i].Collections)
		}
	}
	walk(albums, collections)
	return counts
}

// normalizeDisplayNames 统一整棵树的相册展示名。
//
// 跨根同名相册要加来源前缀，而这份前缀取决于全库的同名分布。
// 增量更新只重建了受影响的子树，因此合并完成后要统一算一次。
//
// 复用到的旧节点与已发布快照共享结构，这里只复制相册结构体再改展示名，
// 不会改动已发布的那一份。
func normalizeDisplayNames(
	albums []models.Album,
	collections []models.Collection,
	conflicts map[string]int,
) ([]models.Album, []models.Collection) {
	outAlbums := make([]models.Album, len(albums))
	copy(outAlbums, albums)
	for i := range outAlbums {
		outAlbums[i].DisplayName = desiredAlbumDisplayName(outAlbums[i], conflicts)
	}
	outCollections := make([]models.Collection, len(collections))
	copy(outCollections, collections)
	for i := range outCollections {
		fixedAlbums, fixedCollections := normalizeDisplayNames(
			outCollections[i].Albums, outCollections[i].Collections, conflicts,
		)
		outCollections[i].Albums = fixedAlbums
		outCollections[i].Collections = fixedCollections
	}
	return outAlbums, outCollections
}

// desiredAlbumDisplayName 算出相册应有的展示名。
func desiredAlbumDisplayName(album models.Album, conflicts map[string]int) string {
	base := albumDisplayBase(album)
	if conflicts[base] > 1 && album.SourceName != "" {
		return "[" + album.SourceName + "] " + base
	}
	return base
}

// normalizeCollectionDisplayNames 统一顶层集合的展示名。
func normalizeCollectionDisplayNames(collections []models.Collection) []models.Collection {
	counts := make(map[string]int, len(collections))
	for i := range collections {
		counts[collections[i].Name]++
	}
	out := make([]models.Collection, len(collections))
	copy(out, collections)
	for i := range out {
		if counts[out[i].Name] > 1 && out[i].SourceName != "" {
			out[i].DisplayName = "[" + out[i].SourceName + "] " + out[i].Name
		} else {
			out[i].DisplayName = out[i].Name
		}
	}
	return out
}

// scanDepth 返回目录相对媒体根的层级深度（根为 0）。
func scanDepth(root, path string) int {
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == "." {
		return 0
	}
	return len(strings.Split(filepath.ToSlash(relative), "/"))
}

// sortedKeys 返回集合里的键，按字典序排列。
func sortedKeys(set map[string]struct{}) []string {
	if len(set) == 0 {
		return nil
	}
	keys := make([]string, 0, len(set))
	for key := range set {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
