// Command server 漫画阅读器后端入口。
//
// 启动流程：
//  1. 解析 flag：仅 --config（指定 YAML 路径）和 --static-dir（前端产物目录）
//  2. 加载 config.yaml（缺失则用内置默认；显式字段覆盖默认）
//  3. 校验 ComicRoot 必须存在且为目录
//  4. 注册中间件 + 路由
//  5. 监听 host:port
//
// 不再支持环境变量或 --comic-root / --host / --port 等覆盖；
// 所有运行时配置集中在 config.yaml（参考 backend/config.example.yaml）。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"

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

	// ---- 2. 加载 YAML 配置 ----
	cfg, err := config.LoadFile(*flagConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "加载配置失败 %s: %v\n", *flagConfig, err)
		os.Exit(2)
	}

	// ---- 3. --static-dir 覆盖 YAML 中的同名字段（部署灵活）----
	staticDir := cfg.StaticDir
	if *flagStaticDir != "" {
		staticDir = *flagStaticDir
	}

	// ---- 4. 校验 ----
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "配置校验失败: %v\n", err)
		fmt.Fprintf(os.Stderr, "提示：在 config.yaml 中设置 comicRoot 指向漫画根目录\n")
		os.Exit(2)
	}

	log.Printf("comic-reader 后端启动中...")
	log.Printf("  ComicRoot: %s", cfg.ComicRoot)
	log.Printf("  CacheDir:  %s", cfg.CacheDir)
	log.Printf("  Thumbnail: %dx%d", cfg.ThumbSizeW, cfg.ThumbSizeH)
	log.Printf("  Listen:    %s", cfg.Addr())

	// ---- 5. 创建并启动 Fiber App ----
	app := fiber.New(fiber.Config{
		AppName:               "comic-reader",
		DisableStartupMessage: true,
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			if fe, ok := err.(*fiber.Error); ok {
				return c.Status(fe.Code).JSON(fiber.Map{"error": fe.Message})
			}
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
		},
	})

	app.Use(middleware.Logger())
	app.Use(middleware.Recover())
	app.Use(middleware.PathSafetyMiddleware(cfg.ComicRoot))

	// ---- 路由 ----
	scanner := services.NewScanner()
	thumbs, err := services.NewThumbnailService(services.ThumbnailOptions{
		CacheDir:   cfg.CacheDir,
		Width:      cfg.ThumbSizeW,
		Height:     cfg.ThumbSizeH,
		MaxAgeDays: cfg.CacheMaxAgeDays,
	})
	if err != nil {
		log.Fatalf("初始化缩略图服务失败: %v", err)
	}
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

	api := app.Group("/api")
	api.Get("/health", handlers.HealthHandler(cfg))
	api.Post("/scan", handlers.ScanHandler(scanner, cfg.ComicRoot))
	api.Post("/scan/start", handlers.AsyncScanStartHandler(runner, cfg.ComicRoot))
	api.Get("/scan/:id/events", handlers.AsyncScanEventsHandler(runner))
	api.Get("/scan/:id/result", handlers.AsyncScanResultHandler(runner))
	api.Delete("/scan/:id", handlers.AsyncScanCancelHandler(runner))
	api.Get("/scan/latest", handlers.LatestScanHandler(scanCache))
	api.Get("/albums", handlers.AlbumDetailHandler(scanCache))
	api.Get("/search", handlers.SearchHandler(scanCache))
	api.Get("/thumbs", handlers.ThumbHandler(thumbs))
	api.Get("/thumbs/stats", handlers.ThumbStatsHandler(thumbs))
	api.Post("/thumbs/cleanup", handlers.ThumbCleanupHandler(thumbs))
	api.Get("/images", handlers.ImageHandler())
	api.Get("/images/info", handlers.ImageInfoHandler())
	api.Get("/fs/open", handlers.FsOpenHandler(cfg))

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

	// ---- 静态资源托管（生产模式：同端口托管前端） ----
	if staticDir != "" {
		if info, err := os.Stat(staticDir); err == nil && info.IsDir() {
			app.Static("/", staticDir)
			// SPA fallback：任何非 /api/* 的请求 → 找不到静态文件就回 index.html
			// 使用 app.Use 的 NotFound-style 行为：放到 Static 之后，未命中时接管
			indexPath, _ := filepath.Abs(filepath.Join(staticDir, "index.html"))
			app.Use(func(c *fiber.Ctx) error {
				// 只处理 GET/HEAD
				if c.Method() != fiber.MethodGet && c.Method() != fiber.MethodHead {
					return c.Next()
				}
				// API 路由不接管
				p := c.Path()
				if len(p) >= 5 && p[:5] == "/api/" {
					return c.Next()
				}
				// 已经在响应中写过（Static 命中文件）
				if c.Response().StatusCode() == fiber.StatusOK {
					return nil
				}
				// 回退到 SPA index.html
				c.Set("Content-Type", "text/html; charset=utf-8")
				return c.SendFile(indexPath)
			})
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