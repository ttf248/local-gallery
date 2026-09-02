// Package services 提供本地画廊核心业务服务。
package services

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/tianlongxiang/local-gallery/internal/models"
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
	// Exclude 扫描排除规则（详见 ExcludeConfig）。nil 时走 DefaultExclude()
	// 兜底,等价于「跳隐藏 + 跳系统文件」的内置默认。
	//
	// 设计:把规则放在 ScanOptions 而不是构造函数里,让同进程多次扫描能
	// 用不同规则(handler 每次都用最新 config 构造);同时测试也可以
	// 方便地构造空规则 / 严格规则的 ScanOptions。
	Exclude ExcludeConfig
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
	Phase       string         // "scanning" / "smart-grouping"
	CurrentPath string         // 当前处理的目录/文件
	Processed   int            // 已处理的子目录数
	Total       int            // 总子目录数（用于计算百分比）
	AlbumsFound int            // 累计发现的相册数
	NewAlbums   []models.Album // 本轮新发现的相册
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
//
// 并发模型：worker pool + 跨递归共享信号量。任一层 scanLayer 都会启
// workers 个 goroutine 跑 jobs,每层递归又是新一组 workers → 嵌套 5 层
// 时旧版会创建 8^5 = 32K goroutine 持续存在。引入 sem chan struct{}
// (容量 = workers) 跨递归共享,让"任意时刻并发的 classifyAndScan
// 调用" 严格 ≤ workers。深嵌套树会变慢一点(因为浅层可能占满 sem),
// 但 goroutine 数稳定,适合大库 + 嵌套深的真实用户数据(2024年/夏威夷/
// 相册/作品/甜片 这种 5 层结构实测)。
type Scanner struct {
	workers int
	sem     chan struct{}
	ctx     context.Context
}

// NewScanner 创建扫描器。
func NewScanner() *Scanner {
	n := min(8, runtime.NumCPU())
	return &Scanner{
		workers: n,
		sem:     make(chan struct{}, n),
		ctx:     context.Background(),
	}
}

// Scan 执行同步扫描。返回完整结果树。
func (s *Scanner) Scan(opts ScanOptions) (*models.ScanResult, error) {
	return s.ScanWithHook(opts, nil)
}

// ScanWithContext 执行可取消扫描；取消后不再继续读取新目录。
func (s *Scanner) ScanWithContext(ctx context.Context, opts ScanOptions, hook ScanHook) (*models.ScanResult, error) {
	if ctx == nil {
		ctx = context.Background()
	}
	scoped := *s
	scoped.ctx = ctx
	return scoped.ScanWithHook(opts, hook)
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
		if err := s.contextErr(); err != nil {
			return nil, err
		}
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
			len(topSubdirs), 0, opts.Exclude)
		if err := s.contextErr(); err != nil {
			return nil, err
		}

		// 关键修复:scanLayer 只处理 subdirs。如果顶层 root 目录直接放了
		// 文件(用户常见的"一打开 media root 就是 100 张图"场景),原实现
		// 永远返回 0 album,这里补一次 classifyAndScan 顶层。只在以下条件
		// 触发,避免与已有 subdir 路径重复:
		//   - root 下有顶层文件 AND 没有可用 subdir(只有"散图"场景)
		//   - root 下有顶层文件 AND subdir 已被 scanLayer 处理(此处不再
		//     重叠,顶层文件丢失;这是已存在的设计限制,本修复不触及)
		// 实际行为:情形 A(只有顶层文件)→ 顶层 root 自己变成 album;
		// 情形 C(顶层文件+subdir)→ 顶层 root 的文件仍然丢失(已知问题,
		// 计划未来引入"root loose album"模式)
		if hasLooseFilesAtRoot(absRoot, len(topSubdirs)) {
			if al, _ := s.classifyAndScan(absRoot, absRoot, depth, 0, opts.Exclude); al != nil {
				topAlbums = append([]models.Album{*al}, topAlbums...)
			}
		}

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
func (s *Scanner) scanLayer(basePath, currentPath string, maxDepth, curDepth int, exclude ExcludeConfig) ([]models.Album, []models.Collection) {
	return s.scanLayerWithHook(basePath, currentPath, maxDepth, curDepth, nil, 0, 0, exclude)
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
	exclude ExcludeConfig,
) ([]models.Album, []models.Collection) {
	if s.contextErr() != nil {
		return nil, nil
	}
	entries, err := os.ReadDir(currentPath)
	if err != nil {
		return nil, nil
	}

	// 仅取直接子目录 + 应用排除规则。
	// 排除命中的子目录(及其整个子树)不进 worker 队列 → 不会产生空
	// collection、不会让 hook 误以为「这里有条进度」、不会浪费时间 stat。
	// SystemFiles 列表只对文件生效(目录不会被它命中),但为了代码对称,
	// 一起调 ShouldSkipDir 也无害(目录白名单命中通常表示该目录命名像
	// "Thumbs.db",本来就是异常情况)。
	var subdirs []os.DirEntry
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		if exclude.ShouldSkipDir(e.Name()) {
			continue
		}
		subdirs = append(subdirs, e)
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
				if s.contextErr() != nil {
					return
				}
				// classifyAndScan 内部用全局 sem 跨递归控制并发。
				// 这里不再额外取 sem,否则父调用持锁期间子层 scanLayer
				// 的 worker 会全阻塞,退化成串行执行。
				al, co := s.classifyAndScan(basePath, p, maxDepth, curDepth, exclude)
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
						Phase:       "scanning",
						CurrentPath: currentPath,
						Processed:   processed,
						Total:       total,
						AlbumsFound: hookAlbumsFound,
						NewAlbums:   nil,
					})
				}
			}
		}()
	}

feedJobs:
	for _, d := range subdirs {
		select {
		case jobs <- filepath.Join(currentPath, d.Name()):
		case <-s.ctx.Done():
			break feedJobs
		}
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
// 规则（含嵌套目录时严格不丢数据、不破坏导航层级）：
//   - 仅顶层含图/视频且无子目录 → 纯 Album（最常见）
//   - 顶层含图/视频 + 有子目录 → Collection：
//   - 「散图」虚拟相册（Path=dir, ImageFiles=顶层文件, Name="散图"）
//   - 每个子目录的扫描结果（Album 或 Collection）原样放进 Albums / Collections
//     不再把子目录图合并进"散图"，否则用户点进 2024年 还是看到一坨
//     3549 张混合图，没法继续下钻到 10.1国庆 这种子相册 —— 用户反馈
//     「我需要保留子相册导航」。
//   - 仅含子目录 → Collection：子目录扫描结果放进 Albums / Collections
//     （嵌套 Collection 保持嵌套，不再拍平 —— 否则 5 层嵌套会丢结构）
//   - 都不含 → 跳过
//
// 封面选择（CoverImage / CoverKind）：
//   - 同时含图和视频 → 封面用第一张图,CoverKind="image"
//   - 仅含视频 → 封面用第一个视频,CoverKind="video"（封面缩略图由前端抽帧后回填）
//   - 仅含图 → 封面用第一张图,CoverKind="image"
// fileEntry 把目录项的 size 提前算好,避免 buildAlbum 阶段再次
// os.Stat 整本相册(每张图/视频一次 syscall)。在 1k+ 张图的相册上,
// 这把 FolderSize 的 N+1 syscall 减到 0 次。
type fileEntry struct {
	path string
	size int64
}

func (s *Scanner) classifyAndScan(basePath, dir string, maxDepth, curDepth int, exclude ExcludeConfig) (*models.Album, *models.Collection) {
	if s.contextErr() != nil {
		return nil, nil
	}
	// 全局信号量:跨递归共享,严格限制"任意时刻并发的 classifyAndScan
	// 调用数" ≤ workers。如果在 worker 外面取,父调用持锁期间子层
	// scanLayer 的 worker 全在阻塞 → 退化成串行。必须让递归的每层
	// 各自独立计数,合在一起仍受 workers 上限约束。
	select {
	case s.sem <- struct{}{}:
	case <-s.ctx.Done():
		return nil, nil
	}
	defer func() { <-s.sem }()

	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, nil
	}

	var images []fileEntry
	var videos []fileEntry
	var subdirs []os.DirEntry

	for _, e := range entries {
		if s.contextErr() != nil {
			return nil, nil
		}
		if e.IsDir() {
			// 子目录先收集,实际跳过与否在 scanLayer 里再判(集中逻辑,
			// 避免这里和那里各写一遍 ShouldSkipDir)。
			subdirs = append(subdirs, e)
			continue
		}
		// 文件:系统白名单命中 → 完全不计入(图片/视频分类都跳过)。
		// 否则再判断扩展名。这样 Thumbs.db / desktop.ini / .DS_Store
		// 不会污染图片列表,也不会被错误地当视频/图片。
		if exclude.ShouldSkipFile(e.Name()) {
			continue
		}
		full := filepath.Join(dir, e.Name())
		switch {
		case models.IsImageFile(e.Name()):
			// 只对图片/视频调 Info() 拿 size;系统白名单或非媒体文件
			// 一次 Info 都不浪费。DirEntry.Info() 在 Windows 上首次
			// 调用是一次 syscall,后续命中同一 entry 的 Info 会被 runtime
			// 缓存(go 1.18+),但 buildAlbum 阶段不再二次 stat 才
			// 是真正的优化点。
			size := int64(0)
			if fi, ierr := e.Info(); ierr == nil {
				size = fi.Size()
			}
			images = append(images, fileEntry{path: full, size: size})
		case models.IsVideoFile(e.Name()):
			size := int64(0)
			if fi, verr := e.Info(); verr == nil {
				size = fi.Size()
			}
			videos = append(videos, fileEntry{path: full, size: size})
		}
	}

	// 子目录扫描：先把每个 subdir 单独分类，再决定本目录的最终形态。
	// 子目录扫描深度上限是 maxDepth：它是「集合嵌套层数」上限。
	// 用户数据实测 5 层(2024年/夏威夷-度假/相册/作品/甜片),
	// 旧版 merge 路径在 maxDepth=2 时会丢深度 ≥3 的所有内容;新版本
	// 不再 merge,直接用 maxDepth 控制嵌套层数,所以调用方需要把
	// maxDepth 设大一点(目前 handlers 默认 8)。
	var childAlbums []models.Album
	var childColls []models.Collection
	hasChildren := len(subdirs) > 0 && curDepth+1 <= maxDepth
	if hasChildren {
		childAlbums, childColls = s.scanLayer(basePath, dir, maxDepth, curDepth+1, exclude)
	}

	hasFiles := len(images) > 0 || len(videos) > 0
	hasUsableChildren := len(childAlbums) > 0 || len(childColls) > 0

	// 情形 A：仅顶层文件，无可用子目录 → 普通 Album
	if hasFiles && !hasUsableChildren {
		return buildAlbum(dir, images, videos), nil
	}

	// 情形 B：仅子目录，无顶层文件 → Collection
	if !hasFiles && hasUsableChildren {
		return nil, &models.Collection{
			Type:        "collection",
			Path:        dir,
			Name:        filepath.Base(dir),
			Albums:      childAlbums,
			Collections: childColls,
			AlbumCount:  len(childAlbums),
		}
	}

	// 情形 C：顶层文件 + 有可用子目录 → Collection，包含「散图」+ 子目录
	//
	// 「散图」是 Path 以 `/.loose` 结尾的虚拟相册:用它而不是直接用 dir
	// 作为 Path,是为了避免和 Collection.Path=dir 撞 key(后端 FindAlbum
	// 按精确 Path 查找,撞了就 404 或拿错对象)。合成路径在磁盘上不存在,
	// 但作为 result.albums 里的 key 完全可以 — viewer 通过 albumsApi.
	// detail(synthetic) 拿到虚拟 Album,里面 ImageFiles=顶层文件(不含
	// 子目录图)。Collection 优先匹配路由 + albumGrouping 跳过以 .loose
	// 结尾的 path,共同保证主页时间线不会重复显示「散图」。
	if hasFiles && hasUsableChildren {
		loose := buildAlbum(filepath.Join(dir, ".loose"), images, videos)
		loose.Name = "散图"
		allAlbums := append([]models.Album{*loose}, childAlbums...)
		return nil, &models.Collection{
			Type:        "collection",
			Path:        dir,
			Name:        filepath.Base(dir),
			Albums:      allAlbums,
			Collections: childColls,
			AlbumCount:  len(allAlbums),
		}
	}

	return nil, nil
}

func (s *Scanner) contextErr() error {
	if s == nil || s.ctx == nil {
		return nil
	}
	return s.ctx.Err()
}

// hasLooseFilesAtRoot 判断 root 顶层是否含可直接被分类的图/视频文件。
//
// 仅用于"顶层 root 直接放文件"那种场景(情形 A),与 scanLayer 处理的
// subdir 路径不重叠。如果 root 既有 subdir 又有顶层文件,这里返回
// false — 顶层文件仍会被丢失(已知设计限制,见 ScanWithHook 注释)。
func hasLooseFilesAtRoot(root string, subdirCount int) bool {
	if subdirCount > 0 {
		// 避免与 scanLayer 已处理的子目录重复;后续可改成总是处理顶层文件
		return false
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return false
	}
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		name := e.Name()
		if models.IsImageFile(name) || models.IsVideoFile(name) {
			return true
		}
	}
	return false
}

// buildAlbum 把「图片+视频」组装成一个 Album（不含任何子目录逻辑）。
//
// images/videos 的 size 由 classifyAndScan 在收集时通过 DirEntry.Info()
// 拿到,这里直接累加,不再 N+1 stat。N+1 在 1k+ 张图的相册上是几百毫秒
// 级别的浪费(每张 stat 一次),改完后整本相册只多一次 dir stat 拿 modTime。
func buildAlbum(dir string, images, videos []fileEntry) *models.Album {
	imagePaths := make([]string, len(images))
	var totalSize int64
	for i, e := range images {
		imagePaths[i] = e.path
		totalSize += e.size
	}
	videoPaths := make([]string, len(videos))
	for i, e := range videos {
		videoPaths[i] = e.path
		totalSize += e.size
	}
	sort.Strings(imagePaths)
	sort.Strings(videoPaths)
	modTime := time.Time{}
	if fi, err := os.Stat(dir); err == nil {
		modTime = fi.ModTime()
	}
	name := filepath.Base(dir)
	// 封面选择：图片优先
	var cover, coverKind string
	switch {
	case len(imagePaths) > 0:
		cover, coverKind = imagePaths[0], "image"
	default:
		cover, coverKind = videoPaths[0], "video"
	}
	return &models.Album{
		Type:       "album",
		Path:       dir,
		Name:       name,
		ImageFiles: imagePaths,
		VideoFiles: videoPaths,
		CoverImage: cover,
		CoverKind:  coverKind,
		ImageCount: len(imagePaths),
		VideoCount: len(videoPaths),
		FolderSize: totalSize,
		Author:     ExtractAuthor(name),
		Tags:       ExtractTags(name),
		ModTime:    modTime,
	}
}

// flattenAlbums 汇总所有顶层 + 集合（含嵌套集合）内含的相册。
//
// 现在扫描模型支持 Collection 嵌套（Collection.Collections 字段），所以
// smart grouping 要走到所有层级，否则深嵌套里的相册不会被聚合到
// 「标签 / 主题」维度。
func flattenAlbums(topAlbums []models.Album, topCollections []models.Collection) []models.Album {
	all := make([]models.Album, 0, len(topAlbums))
	all = append(all, topAlbums...)
	var walk func(cols []models.Collection)
	walk = func(cols []models.Collection) {
		for _, c := range cols {
			all = append(all, c.Albums...)
			if len(c.Collections) > 0 {
				walk(c.Collections)
			}
		}
	}
	walk(topCollections)
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
