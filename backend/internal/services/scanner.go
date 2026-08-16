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
type ScanOptions struct {
	Root     string // 必填，绝对路径
	MaxDepth int    // 集合（collection）最大递归深度，0 或负数视为 1
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
func (s *Scanner) ScanWithHook(opts ScanOptions, hook ScanHook) (*models.ScanResult, error) {
	root := opts.Root
	if root == "" {
		return nil, errors.New("root is empty")
	}
	info, err := os.Stat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, &ScanError{Kind: ScanRootMissing, Path: root, Err: err}
		}
		return nil, err
	}
	if !info.IsDir() {
		return nil, &ScanError{Kind: ScanRootNotDir, Path: root, Err: errors.New("not a directory")}
	}

	depth := opts.MaxDepth
	if depth <= 0 {
		depth = 1
	}

	absRoot, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}

	start := time.Now()

	// 预计算顶层子目录总数用于进度展示（不阻塞大目录）
	topEntries, _ := os.ReadDir(absRoot)
	var topSubdirs []string
	for _, e := range topEntries {
		if e.IsDir() {
			topSubdirs = append(topSubdirs, e.Name())
		}
	}

	topAlbums, topCollections := s.scanLayerWithHook(absRoot, absRoot, depth, 0, hook,
		len(topSubdirs), 0)

	allAlbums := flattenAlbums(topAlbums, topCollections)
	if hook != nil {
		hook(ScanProgress{
			Phase:       "smart-grouping",
			AlbumsFound: len(allAlbums),
		})
	}
	smart := GroupByTag(allAlbums)

	result := &models.ScanResult{
		Root:             absRoot,
		Albums:           topAlbums,
		Collections:      topCollections,
		SmartCollections: smart,
		AlbumCount:       len(allAlbums),
		CollectionCount:  countCollections(topCollections),
		Duration:         time.Since(start).Milliseconds(),
		ScannedAt:        time.Now(),
	}
	return result, nil
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
// 规则：
//   - 含图片 → Album
//   - 仅含子目录 → Collection（递归一层，深度+1）
//   - 都不含或混合图片 + 子目录 → Album（图片优先，参考 Python 行为）
func (s *Scanner) classifyAndScan(basePath, dir string, maxDepth, curDepth int) (*models.Album, *models.Collection) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}

	var images []string
	var subdirs []os.DirEntry
	var totalSize int64

	for _, e := range entries {
		if e.IsDir() {
			subdirs = append(subdirs, e)
			continue
		}
		if models.IsImageFile(e.Name()) {
			full := filepath.Join(dir, e.Name())
			images = append(images, full)
		}
	}

	// 含图片 → 当作相册
	if len(images) > 0 {
		sort.Strings(images)
		for _, img := range images {
			if fi, err := os.Stat(img); err == nil {
				totalSize += fi.Size()
			}
		}
		modTime := time.Time{}
		if fi, err := os.Stat(dir); err == nil {
			modTime = fi.ModTime()
		}
		name := filepath.Base(dir)
		return &models.Album{
			Type:       "album",
			Path:       dir,
			Name:       name,
			ImageFiles: images,
			CoverImage: images[0],
			ImageCount: len(images),
			FolderSize: totalSize,
			Author:     ExtractAuthor(name),
			Tags:       ExtractTags(name),
			ModTime:    modTime,
		}, nil
	}

	// 仅含子目录且允许继续递归 → 当作集合
	if len(subdirs) > 0 && curDepth+1 <= maxDepth {
		childAlbums, childColls := s.scanLayer(basePath, dir, maxDepth, curDepth+1)
		if len(childAlbums) > 0 || len(childColls) > 0 {
			return nil, &models.Collection{
				Type:       "collection",
				Path:       dir,
				Name:       filepath.Base(dir),
				Albums:     childAlbums,
				AlbumCount: len(childAlbums),
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
