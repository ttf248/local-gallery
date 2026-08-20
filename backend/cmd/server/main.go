// Command server 漫画阅读器后端入口。
//
// 启动流程：
//  1. 解析 flag：仅 --config（指定 YAML 路径）和 --static-dir（前端产物目录）
//  2. 通过 config.Manager 加载 config.yaml（缺失则用内置默认；显式字段覆盖默认）
//  3. 校验 MediaRoot 必须存在且为目录
//  4. 注册中间件 + 路由（中间件和扫描 handler 都从 Manager 读最新根目录）
//  5. 监听 host:port
//
// 不再支持环境变量或 --comic-root / --host / --port 等覆盖；
// 所有运行时配置集中在 config.yaml（参考 backend/config.example.yaml），
// 也可通过 /api/config 在网页设置页修改并自动持久化。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/handlers"
	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/services"
	"github.com/tianlongxiang/comic-reader/internal/store"
)

func main() {
	// ---- 1. 解析 flag（仅保留部署相关：配置文件路径 + 前端静态目录）----
	flagConfig := flag.String("config", config.DefaultConfigName, "配置文件路径（YAML，相对 CWD）")
	flagStaticDir := flag.String("static-dir", "", "前端静态资源目录（覆盖 config.yaml 中的 staticDir；不存在则跳过托管）")
	flag.Parse()

	// ---- 2. 加载 YAML 配置（通过 Manager，handler 可热更新）----
	mgr, err := config.NewManager(*flagConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "加载配置失败 %s: %v\n", *flagConfig, err)
		os.Exit(2)
	}
	cfg := mgr.Get()

	// ---- 3. --static-dir 覆盖 YAML 中的同名字段（部署灵活）----
	staticDir := cfg.StaticDir
	if *flagStaticDir != "" {
		staticDir = *flagStaticDir
		// 同步写回 config（让网页配置与启动 flag 一致）
		_, _ = mgr.Update(config.ConfigPatch{
			StaticDir:    staticDir,
			StaticDirSet: true,
		})
	}

	// ---- 4. 校验 ----
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "配置校验失败: %v\n", err)
		fmt.Fprintf(os.Stderr, "提示：在 config.yaml 中设置 mediaRoot 指向图像根目录\n")
		os.Exit(2)
	}

	log.Printf("comic-reader 后端启动中...")
	roots := cfg.Roots()
	if len(roots) == 1 {
		log.Printf("  MediaRoot: %s", roots[0])
	} else {
		log.Printf("  MediaRoots (%d):", len(roots))
		for _, r := range roots {
			log.Printf("    - %s", r)
		}
	}
	log.Printf("  CacheDir:  %s", cfg.CacheDir)
	log.Printf("  Thumbnail: %dx%d", cfg.ThumbSizeW, cfg.ThumbSizeH)
	log.Printf("  Listen:    %s", cfg.Addr())

	// ---- 5. 创建并启动 Fiber App ----
	app := fiber.New(fiber.Config{
		AppName:               "comic-reader",
		DisableStartupMessage: true,
		// BodyLimit 提到 6 MiB：默认 4 MiB 不够 /api/thumbs/cover 上传
		// 4K canvas JPEG 封面（典型 2-4 MB）。
		BodyLimit: 6 * 1024 * 1024,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			if fe, ok := err.(*fiber.Error); ok {
				return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		},
	})

	app.Use(middleware.Logger())
	app.Use(middleware.Recover())

	// 路径安全中间件：根集合从 Manager 动态读取，运行中可热更新
	safetyMw, safetyState := middleware.PathSafetyMiddleware(cfg.Roots())
	app.Use(safetyMw)
	mgr.OnChange("path_safety", func(snapshot *config.Config) {
		safetyState.SetRoots(snapshot.Roots())
	})

	// ---- 路由 ----
	scanner := services.NewScanner()
	thumbs, err := services.NewThumbnailService(services.ThumbnailOptions{
		CacheDir:   cfg.CacheDir,
		Width:      cfg.ThumbSizeW,
		Height:     cfg.ThumbSizeH,
		MaxAgeDays: cfg.CacheMaxAgeDays,
		LRUSize:    cfg.ThumbCacheSize,
	})
	if err != nil {
		log.Fatalf("初始化缩略图服务失败: %v", err)
	}
	cacheStats := services.NewCacheStatsService(30 * time.Second)
	runner := services.NewAsyncScanRunner()
	prefs := store.NewPrefsStore(filepath.Join(cfg.CacheDir, "web_settings.json"))

	// 扫描结果缓存（启动时从磁盘加载，供前端免扫描查看）
	scanCache := services.NewScanResultCache(filepath.Join(cfg.CacheDir, "scan_cache.json"))
	if err := scanCache.Load(); err != nil {
		log.Printf("警告：加载扫描缓存失败 %v", err)
	}
	runner.SetCache(scanCache)
	if r := scanCache.Get(); r != nil {
		log.Printf("  已加载上次扫描结果：%d 相册，扫描于 %s", r.AlbumCount, r.ScannedAt.Format("2006-01-02 15:04:05"))
	}

	// 缩略图参数 / 缓存目录变更：热更新 ThumbnailService
	mgr.OnChange("thumbnail", func(snapshot *config.Config) {
		if err := thumbs.UpdateOptions(services.ThumbnailOptions{
			CacheDir:   snapshot.CacheDir,
			Width:      snapshot.ThumbSizeW,
			Height:     snapshot.ThumbSizeH,
			MaxAgeDays: snapshot.CacheMaxAgeDays,
			LRUSize:    snapshot.ThumbCacheSize,
		}); err != nil {
			log.Printf("警告：缩略图服务热更新失败: %v", err)
		}
	})

	// 当 MediaRoots 变更：清空扫描缓存，扫描器/handler 已通过 mgr.Roots() 读最新值
	onConfigUpdate := func(newCfg *config.Config, mediaRootsChanged bool) error {
		if mediaRootsChanged {
			if err := scanCache.Clear(); err != nil {
				return fmt.Errorf("clear scan cache: %w", err)
			}
			roots := newCfg.Roots()
			if len(roots) == 1 {
				log.Printf("  MediaRoot 变更为 %s，已清空扫描缓存", roots[0])
			} else {
				log.Printf("  MediaRoots 变更为 %d 个目录，已清空扫描缓存", len(roots))
			}
		}
		return nil
	}

	api := app.Group("/api")
	api.Get("/health", handlers.HealthHandler(mgr))
	api.Post("/scan", handlers.ScanHandler(scanner, mgr))
	api.Post("/scan/start", handlers.AsyncScanStartHandler(runner, mgr))
	api.Get("/scan/:id/events", handlers.AsyncScanEventsHandler(runner))
	api.Get("/scan/:id/result", handlers.AsyncScanResultHandler(runner))
	api.Delete("/scan/:id", handlers.AsyncScanCancelHandler(runner))
	api.Get("/scan/latest", handlers.LatestScanHandler(scanCache))
	api.Get("/albums", handlers.AlbumDetailHandler(scanCache))
	// /api/folders 是 /api/albums 的语义化别名（图像浏览器用 "folder" 更准确）；
	// 老客户端/历史链接仍可继续访问 /api/albums。
	api.Get("/folders", handlers.AlbumDetailHandler(scanCache))
	api.Get("/search", handlers.SearchHandler(scanCache))
	// 标签聚合的语义化路由；"smart:<tag>" 仍能访问。
	api.Get("/tags", handlers.AlbumDetailHandler(scanCache))
	api.Get("/thumbs", handlers.ThumbHandler(thumbs))
	api.Get("/thumbs/stats", handlers.ThumbStatsHandler(thumbs))
	api.Post("/thumbs/cleanup", handlers.ThumbCleanupHandlerWithCacheStats(thumbs, cacheStats))
	api.Get("/cache/stats", handlers.CacheStatsHandler(mgr, cacheStats))
	api.Get("/images", handlers.ImageHandler())
	api.Get("/images/info", handlers.ImageInfoHandler())
	// 视频流 + 元信息（前端 <video> 元素 / HoverPreview / 时长显示使用）
	api.Get("/videos", handlers.VideoHandler())
	api.Get("/videos/info", handlers.VideoInfoHandler())
	// 视频封面回填：前端浏览器抽帧后 POST 原始字节
	api.Post("/thumbs/cover", handlers.ThumbCoverHandler(thumbs))
	api.Get("/fs/open", handlers.FsOpenHandler(mgr))

	// 配置读写
	api.Get("/config", handlers.ConfigGetHandler(mgr))
	api.Put("/config", handlers.ConfigUpdateHandler(mgr, onConfigUpdate))

	// 偏好 / 收藏 / 历史
	api.Get("/prefs", handlers.PrefsGetHandler(prefs))
	api.Patch("/prefs", handlers.PrefsPatchHandler(prefs))
	api.Get("/favorites", handlers.FavoritesListHandler(prefs))
	api.Post("/favorites", handlers.FavoriteAddHandler(prefs))
	api.Delete("/favorites", handlers.FavoriteRemoveHandler(prefs))
	api.Post("/favorites/prune", handlers.FavoritesPruneHandler(prefs))
	api.Get("/history", handlers.HistoryListHandler(prefs))
	api.Post("/history", handlers.HistoryAddHandler(prefs))
	api.Delete("/history", handlers.HistoryClearHandler(prefs))
	api.Post("/progress", handlers.ProgressSetHandler(prefs))
	api.Get("/progress", handlers.ProgressGetHandler(prefs))
	api.Post("/progress/batch", handlers.ProgressBatchGetHandler(prefs))

	// ---- 静态资源托管（生产模式：同端口托管前端） ----
	if staticDir != "" {
		if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
			indexPath, _ := filepath.Abs(filepath.Join(staticDir, "index.html"))
			// SPA fallback：先注册通配兜底（只对 GET/HEAD，且非 /api/，且静态文件不存在）
			// 放到 Static 之前，避免 Static 内部对 404 也保留 200 状态码导致误判
			app.Use(func(c *fiber.Ctx) error {
				if c.Method() != fiber.MethodGet && c.Method() != fiber.MethodHead {
					return c.Next()
				}
				p := c.Path()
				if len(p) >= 5 && p[:5] == "/api/" {
					return c.Next()
				}
				// 已经是 index.html 或根路径：交给 Static
				rel := strings.TrimPrefix(p, "/")
				if rel == "" {
					return c.Next()
				}
				// 静态文件实际存在则交给 Static
				filePath := filepath.Join(staticDir, filepath.FromSlash(rel))
				if info, err := os.Stat(filePath); err == nil && !info.IsDir() {
					return c.Next()
				}
				// 否则回退到 SPA index.html
				c.Set("Content-Type", "text/html; charset=utf-8")
				return c.SendFile(indexPath)
			})
			app.Static("/", staticDir)
			log.Printf("  StaticDir: %s (已托管前端 + SPA fallback)", staticDir)
		} else {
			log.Printf("  StaticDir: %s 不存在或不是目录，跳过静态托管", staticDir)
		}
	} else {
		log.Printf("  StaticDir: <未配置>，跳过静态托管")
	}

	// ---- 启动 ----
	if err := app.Listen(cfg.Addr()); err != nil {
		log.Fatalf("监听失败: %v", err)
	}
}
