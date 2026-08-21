// Package services 提供漫画阅读器核心业务服务。
package services

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/tianlongxiang/comic-reader/internal/models"
)

// ScanOptions 扫描选项。
//
// Roots 优先于 Root：当 Roots 非空时扫描所有根并合并结果；否则回退到
// 老的单根 Root 字段（兼容）。Root 仍然会作为单元素根的来源同步到 Roots
// 用于规范化处理。
type ScanOptions struct {
	Root     string   // 单根（兼容）；与 Roots 二选一
	Roots    []string // 多根（推荐）；非空时优先
	MaxDepth int      // 集合（collection）最大递归深度，0 或负数视为 1
}

// effectiveRoots 返回本轮要扫描的根列表（去重、保序、规范化）。
func (o ScanOptions) effectiveRoots() []string {
	src := o.Roots
	if len(src) == 0 && o.Root != "" {
		src = []string{o.Root}
	}
	seen := make(map[string]bool, len(src))
	out := make([]string, 0, len(src))
	for _, r := range src {
		r = filepath.Clean(r)
		if r == "" || seen[r] {
			continue
		}
		seen[r] = true
		out = append(out, r)
	}
	return out
}

// ScanProgress 扫描进度回调参数。
//
// 由 Scanner 在扫描过程中多次调用，提供给 AsyncScanRunner 转换为 SSE 事件。
type ScanProgress struct {
	Phase        string         // "scanning" / "smart-grouping"
	CurrentPath  string         // 当前处理的目录/文件
	Processed    int            // 已处理的子目录数
	Total        int            // 总子目录数（用于计算百分比）
	AlbumsFound  int            // 累计发现的相册数
	NewAlbums    []models.Album // 本轮新发现的相册
}

// ScanHook 进度回调函数。
type ScanHook func(p ScanProgress)

// ScanErrorKind 扫描过程中可恢复的错误类型。
type ScanErrorKind int

const (
	ScanOK ScanErrorKind = iota
	ScanRootMissing
	ScanRootNotDir
)

func (k ScanErrorKind) String() string {
	switch k {
	case ScanRootMissing:
		return "root missing"
	case ScanRootNotDir:
		return "root is not a directory"
	default:
		return "ok"
	}
}

// ScanError 扫描失败描述。
type ScanError struct {
	Kind ScanErrorKind
	Path string
	Err  error
}

func (e *ScanError) Error() string {
	return e.Kind.String() + ": " + e.Path + ": " + e.Err.Error()
}

func (e *ScanError) Unwrap() error { return e.Err }

// Scanner 漫画扫描器。
type Scanner struct {
	workers int
}

// NewScanner 创建扫描器。
func NewScanner() *Scanner {
	return &Scanner{workers: min(8, runtime.NumCPU())}
}

// Scan 执行同步扫描。返回完整结果树。
func (s *Scanner) Scan(opts ScanOptions) (*models.ScanResult, error) {
	return s.ScanWithHook(opts, nil)
}

// ScanWithHook 与 Scan 相同，但额外接受一个进度回调。
// hook 可以为 nil，此时等同于 Scan。
//
// 多根扫描：opts.Roots 非空时按顺序扫描每个根，合并所有顶层 Albums /
// Collections，并给每个 Album/Collection 填充 SourceRoot/SourceName 字段。
// 跨根同名时，DisplayName 会加 "[SourceName] " 前缀避免歧义。
func (s *Scanner) ScanWithHook(opts ScanOptions, hook ScanHook) (*models.ScanResult, error) {
	roots := opts.effectiveRoots()
	if len(roots) == 0 {
		return nil, errors.New("root is empty")
	}

	depth := opts.MaxDepth
	if depth <= 0 {
		depth = 1
	}

	start := time.Now()

	// 校验所有根并规范化
	absRoots := make([]string, 0, len(roots))
	for _, r := range roots {
		abs, err := filepath.Abs(r)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(abs)
		if err != nil {
			if os.IsNotExist(err) {
				return nil, &ScanError{Kind: ScanRootMissing, Path: r, Err: err}
			}
			return nil, err
		}
		if !info.IsDir() {
			return nil, &ScanError{Kind: ScanRootNotDir, Path: r, Err: errors.New("not a directory")}
		}
		absRoots = append(absRoots, abs)
	}

	var allTopAlbums []models.Album
	var allTopCollections []models.Collection

	// 逐根扫描；进度回调累计所有根的处理数
	for _, absRoot := range absRoots {
		topEntries, _ := os.ReadDir(absRoot)
		var topSubdirs []string
		for _, e := range topEntries {
			if e.IsDir() {
				topSubdirs = append(topSubdirs, e.Name())
			}
		}

		// 把当前根的顶层进度归零；多根的 progress 在 hook 内独立计算
		// 由调用方基于 elapsedMs 自行推断
		topAlbums, topCollections := s.scanLayerWithHook(absRoot, absRoot, depth, 0, hook,
			len(topSubdirs), 0)

		// 给所有产生的 album/collection 打 source 标签
		srcName := filepath.Base(absRoot)
		stampAlbumSource(&topAlbums, absRoot, srcName)
		stampCollectionSource(&topCollections, absRoot, srcName)

		allTopAlbums = append(allTopAlbums, topAlbums...)
		allTopCollections = append(allTopCollections, topCollections...)
	}

	// 跨根同名冲突：给 DisplayName 加 [SourceName] 前缀
	applyNamePrefixIfConflict(&allTopAlbums)
	applyCollectionNamePrefixIfConflict(&allTopCollections)

	allAlbums := flattenAlbums(allTopAlbums, allTopCollections)
	if hook != nil {
		hook(ScanProgress{
			Phase:       "smart-grouping",
			AlbumsFound: len(allAlbums),
		})
	}
	smart := GroupByTag(allAlbums)

	rootsForResult := make([]string, len(absRoots))
	copy(rootsForResult, absRoots)

	result := &models.ScanResult{
		Root:             absRoots[0],
		Roots:            rootsForResult,
		Albums:           allTopAlbums,
		Collections:      allTopCollections,
		SmartCollections: smart,
		AlbumCount:       len(allAlbums),
		CollectionCount:  countCollections(allTopCollections),
		Duration:         time.Since(start).Milliseconds(),
		ScannedAt:        time.Now(),
	}
	return result, nil
}

// stampAlbumSource 给 album 列表（含嵌套 collection 内）打 SourceRoot / SourceName
// 并把空 DisplayName 填上 Name（基础值，后续冲突检测可能再覆盖）。
func stampAlbumSource(albums *[]models.Album, srcRoot, srcName string) {
	for i := range *albums {
		(*albums)[i].SourceRoot = srcRoot
		(*albums)[i].SourceName = srcName
		if (*albums)[i].DisplayName == "" {
			(*albums)[i].DisplayName = (*albums)[i].Name
		}
	}
}

func stampCollectionSource(collections *[]models.Collection, srcRoot, srcName string) {
	for i := range *collections {
		(*collections)[i].SourceRoot = srcRoot
		(*collections)[i].SourceName = srcName
		if (*collections)[i].DisplayName == "" {
			(*collections)[i].DisplayName = (*collections)[i].Name
		}
		// 递归到子 albums
		stampAlbumSource(&(*collections)[i].Albums, srcRoot, srcName)
	}
}

// applyNamePrefixIfConflict 对所有 album 检测同名冲突，冲突的加来源前缀。
// 只在顶层 + collection 内部 album 中各检测一次；不同根的同名 album 会
// 被识别为冲突。
func applyNamePrefixIfConflict(albums *[]models.Album) {
	// 第一遍：统计 name 出现次数
	counts := make(map[string]int)
	for _, a := range *albums {
		counts[a.Name]++
	}
	for i := range *albums {
		if counts[(*albums)[i].Name] > 1 && (*albums)[i].SourceName != "" {
			(*albums)[i].DisplayName = "[" + (*albums)[i].SourceName + "] " + (*albums)[i].Name
		}
	}
}

// applyCollectionNamePrefixIfConflict 对所有 collection（含嵌套的子 albums）
// 做同名冲突检测。冲突的 collection 改名；其内部子 album 由于名字继承关系
// 不会被全局计数重复（不同根的同名 collection 才会撞）。
func applyCollectionNamePrefixIfConflict(collections *[]models.Collection) {
	// 顶层冲突
	counts := make(map[string]int)
	for _, c := range *collections {
		counts[c.Name]++
	}
	for i := range *collections {
		if counts[(*collections)[i].Name] > 1 && (*collections)[i].SourceName != "" {
			(*collections)[i].DisplayName = "[" + (*collections)[i].SourceName + "] " + (*collections)[i].Name
		}
		// 子 album 在 stampAlbumSource 已经按所在 collection 的源打了 source
		// 但跨根同名时，stampAlbumSource 不会重新命名，需要做冲突检测
		// 不过子 album 的路径在所在 collection 之下，不会跨根冲突
		// 所以此处不处理子 album
	}
}

// scanLayer 扫描单层目录（无进度回调）。
func (s *Scanner) scanLayer(basePath, currentPath string, maxDepth, curDepth int) ([]models.Album, []models.Collection) {
	return s.scanLayerWithHook(basePath, currentPath, maxDepth, curDepth, nil, 0, 0)
}

// scanLayerWithHook 扫描单层目录，支持进度回调。
//
//   - basePath：用于路径安全校验的根
//   - currentPath：当前扫描的目录
//   - maxDepth：集合最大允许深度
//   - curDepth：当前深度（从 0 开始）
//   - hook：进度回调（可为 nil）
//   - total：当前层总目录数（用于百分比）
//   - processedOffset：已处理的目录数（递归累计）
func (s *Scanner) scanLayerWithHook(
	basePath, currentPath string,
	maxDepth, curDepth int,
	hook ScanHook,
	total, processedOffset int,
) ([]models.Album, []models.Collection) {
	entries, err := os.ReadDir(currentPath)
	if err != nil {
		return nil, nil
	}

	// 仅取直接子目录
	var subdirs []os.DirEntry
	for _, e := range entries {
		if e.IsDir() {
			subdirs = append(subdirs, e)
		}
	}

	type result struct {
		album   *models.Album
		coll    *models.Collection
		isAlbum bool
	}

	jobs := make(chan string, len(subdirs))
	results := make(chan result, len(subdirs))
	var wg sync.WaitGroup

	// 计数器：已处理子目录数
	var processedCount int
	var countMu sync.Mutex
	albumsFound := 0

	for i := 0; i < s.workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for p := range jobs {
				al, co := s.classifyAndScan(basePath, p, maxDepth, curDepth)
				if al != nil {
					results <- result{album: al, isAlbum: true}
				} else if co != nil {
					results <- result{coll: co}
				} else {
					results <- result{}
				}

				// 更新计数 + 回调
				countMu.Lock()
				processedCount++
				if al != nil {
					albumsFound++
				}
				processed := processedOffset + processedCount
				currentPath := p
				hookAlbumsFound := albumsFound
				countMu.Unlock()

				if hook != nil {
					hook(ScanProgress{
						Phase:        "scanning",
						CurrentPath:  currentPath,
						Processed:    processed,
						Total:        total,
						AlbumsFound:  hookAlbumsFound,
						NewAlbums:    nil,
					})
				}
			}
		}()
	}

	for _, d := range subdirs {
		jobs <- filepath.Join(currentPath, d.Name())
	}
	close(jobs)
	wg.Wait()
	close(results)

	var albums []models.Album
	var colls []models.Collection
	for r := range results {
		if r.isAlbum && r.album != nil {
			albums = append(albums, *r.album)
		} else if !r.isAlbum && r.coll != nil {
			colls = append(colls, *r.coll)
		}
	}

	// 排序保证结果稳定
	sort.Slice(albums, func(i, j int) bool { return albums[i].Name < albums[j].Name })
	sort.Slice(colls, func(i, j int) bool { return colls[i].Name < colls[j].Name })
	return albums, colls
}

// classifyAndScan 判断子目录是相册还是集合，并扫描它。
//
// 规则（重要 — 含嵌套目录时不丢数据）：
//   - 含子目录时先递归收集子目录里的图/视频,合并进当前相册
//     (旧版直接 return album,子目录里的图就静默丢了 — 用户反馈:
//      缓存数量明显不对,2024年只数到 1193 张,实际 3549 张里 2322 张在子目录)
//   - 含图片或视频 → Album(可能来自顶层,也可能来自子目录合并)
//   - 仅含子目录且允许继续递归 → Collection(递归子目录的 albums/collections)
//   - 都不含 → 跳过
//
// 封面选择（CoverImage / CoverKind）：
//   - 同时含图和视频 → 封面用第一张图,CoverKind="image"
//   - 仅含视频 → 封面用第一个视频,CoverKind="video"（封面缩略图由前端抽帧后回填）
//   - 仅含图 → 封面用第一张图,CoverKind="image"
func (s *Scanner) classifyAndScan(basePath, dir string, maxDepth, curDepth int) (*models.Album, *models.Collection) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}

	var images []string
	var videos []string
	var subdirs []os.DirEntry

	for _, e := range entries {
		if e.IsDir() {
			subdirs = append(subdirs, e)
			continue
		}
		full := filepath.Join(dir, e.Name())
		switch {
		case models.IsImageFile(e.Name()):
			images = append(images, full)
		case models.IsVideoFile(e.Name()):
			videos = append(videos, full)
		}
	}

	// 仅当顶层**已经有图/视频**且**也有子目录**时,才把子目录的图合并进当前相册。
	// 旧版只判断顶层有没有图就直接 return album,子目录里的图就静默丢了
	// — 用户反馈: 2024年 1227 顶层图 + 6 个子目录 2322 张被忽略,数量明显不对。
	//
	// 合并时用 mergeDepth 而非 maxDepth:maxDepth 是「集合嵌套层数」上限,
	// 但 merge 是把所有层级的图扁平化到一个相册里,深度理论上不受限。
	// 用户数据实测有 5 层(2024年/夏威夷-度假/相册/作品/甜片),maxDepth=2 会把
	// 深度 ≥3 的全部丢掉。mergeDepth 设大一点(32)够覆盖任意合理深度,
	// 又能防止真出现环状软链导致无限递归。
	//
	// 重要: 同时合并 childAlbums 和 childColls 里的 albums。
	// scanLayer 对「顶层无图只有子目录」的子目录会包成 Collection 回来
	// (例如 2024年/2024.10.1 顶层 0 张,会被识别成 Collection 包着原片+照片),
	// 旧版只看 childAlbums 会漏掉 Collection 内的图。
	const mergeDepth = 32
	if (len(images) > 0 || len(videos) > 0) && len(subdirs) > 0 && curDepth+1 <= mergeDepth {
		childAlbums, childColls := s.scanLayer(basePath, dir, mergeDepth, curDepth+1)
		for _, sa := range childAlbums {
			images = append(images, sa.ImageFiles...)
			videos = append(videos, sa.VideoFiles...)
		}
		// Collection 内可能还有子专辑(嵌套),继续向下挖
		for _, sc := range childColls {
			for _, sa := range sc.Albums {
				images = append(images, sa.ImageFiles...)
				videos = append(videos, sa.VideoFiles...)
			}
		}
	}

	// 含图片或视频 → 当作相册(可能来自顶层,也可能来自子目录合并)
	if len(images) > 0 || len(videos) > 0 {
		sort.Strings(images)
		sort.Strings(videos)
		var totalSize int64
		for _, p := range append(append([]string{}, images...), videos...) {
			if fi, err := os.Stat(p); err == nil {
				totalSize += fi.Size()
			}
		}
		modTime := time.Time{}
		if fi, err := os.Stat(dir); err == nil {
			modTime = fi.ModTime()
		}
		name := filepath.Base(dir)
		// 封面选择：图片优先
		var cover, coverKind string
		switch {
		case len(images) > 0:
			cover, coverKind = images[0], "image"
		default:
			cover, coverKind = videos[0], "video"
		}
		return &models.Album{
			Type:       "album",
			Path:       dir,
			Name:       name,
			ImageFiles: images,
			VideoFiles: videos,
			CoverImage: cover,
			CoverKind:  coverKind,
			ImageCount: len(images),
			VideoCount: len(videos),
			FolderSize: totalSize,
			Author:     ExtractAuthor(name),
			Tags:       ExtractTags(name),
			ModTime:    modTime,
		}, nil
	}

	// 仅含子目录(且递归后仍无图) → 当作集合
	//
	// 把 childColls 的子集合也展开到当前集合里 — 避免数据丢失。
	// 实际数据里 5 层嵌套是存在的(2024年/夏威夷-度假/相册/作品),其中
	// "相册"会被识别成包着 [作品] 的 Collection,这个 Collection 不能
	// 直接塞进 "夏威夷" 集合(Collection 模型里 Albums 是 []Album 不是
	// []Collection),只能把它的 Albums 拍平。
	if len(subdirs) > 0 && curDepth+1 <= maxDepth {
		childAlbums, childColls := s.scanLayer(basePath, dir, maxDepth, curDepth+1)
		if len(childAlbums) > 0 || len(childColls) > 0 {
			allAlbums := childAlbums
			for _, c := range childColls {
				allAlbums = append(allAlbums, c.Albums...)
			}
			return nil, &models.Collection{
				Type:       "collection",
				Path:       dir,
				Name:       filepath.Base(dir),
				Albums:     allAlbums,
				AlbumCount: len(allAlbums),
			}
		}
	}

	return nil, nil
}

// flattenAlbums 汇总所有顶层 + 集合内含的相册。
// 当前扫描模型下集合不嵌套集合，但保留通用性以备将来扩展。
func flattenAlbums(topAlbums []models.Album, topCollections []models.Collection) []models.Album {
	all := make([]models.Album, 0, len(topAlbums))
	all = append(all, topAlbums...)
	for _, c := range topCollections {
		all = append(all, c.Albums...)
	}
	return all
}

func countCollections(colls []models.Collection) int {
	return len(colls)
}

// ExtractTags 从文件夹名中提取所有方括号标签。
//
// 规则：扫描整个名称，把每一对 `[...]` 的内容作为一个标签；
// 标签首尾空白会被 trim；空标签会被丢弃。
//
// 例子：
//   - "[作者A] 我的图集" → ["作者A"]
//   - "[tag1][tag2] 名字"  → ["tag1", "tag2"]
//   - "（无标签）"          → []
func ExtractTags(name string) []string {
	var tags []string
	for {
		i := strings.Index(name, "[")
		if i < 0 {
			break
		}
		rest := name[i+1:]
		j := strings.Index(rest, "]")
		if j < 0 {
			break
		}
		if t := strings.TrimSpace(rest[:j]); t != "" {
			tags = append(tags, t)
		}
		// 继续往后找（一次可能多个 [tag]）
		name = rest[j+1:]
	}
	return tags
}

// ExtractAuthor 是 ExtractTags 的第一个标签别名；老调用方使用。
// 若名称不含方括号，返回空字符串。
func ExtractAuthor(name string) string {
	tags := ExtractTags(name)
	if len(tags) == 0 {
		return ""
	}
	return tags[0]
}
