// Command server 漫画阅读器后端入口。
//
// 启动流程：
//  1. 解析 flag（CLI 覆盖）
//  2. 加载 config.json（文件覆盖默认）
//  3. 应用环境变量（env 覆盖文件）
//  4. 校验 ComicRoot 必须存在且为目录
//  5. 注册中间件 + 路由
//  6. 监听 host:port
//
// T2 阶段仅暴露 /api/health；后续任务逐步扩展。
package main

import (
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
	"github.com/tianlongxiang/comic-reader/internal/handlers"
	"github.com/tianlongxiang/comic-reader/internal/middleware"
	"github.com/tianlongxiang/comic-reader/internal/services"
)

const defaultConfigPath = "config.json"

func main() {
	// ---- 1. 解析 flag ----
	flagComicRoot := flag.String("comic-root", "", "漫画根目录（覆盖 env 和文件）")
	flagHost := flag.String("host", "", "监听地址")
	flagPort := flag.Int("port", 0, "监听端口")
	flagConfig := flag.String("config", defaultConfigPath, "配置文件路径")
	flag.Parse()

	// ---- 2. 加载文件 ----
	cfg, err := config.LoadFile(*flagConfig)
	if err != nil {
		fmt.Fprintf(os.Stderr, "加载配置失败 %s: %v\n", *flagConfig, err)
		os.Exit(2)
	}

	// ---- 3. 应用环境变量 ----
	config.ApplyEnv(cfg)

	// ---- 4. CLI 覆盖 ----
	if *flagComicRoot != "" {
		cfg.ComicRoot = *flagComicRoot
	}
	if *flagHost != "" {
		cfg.Host = *flagHost
	}
	if *flagPort > 0 {
		cfg.Port = *flagPort
	}

	// ---- 5. 校验 ----
	if err := cfg.Validate(); err != nil {
		fmt.Fprintf(os.Stderr, "配置校验失败: %v\n", err)
		fmt.Fprintf(os.Stderr, "提示：使用 --comic-root 或 COMIC_ROOT 指定漫画目录\n")
		os.Exit(2)
	}

	log.Printf("comic-reader 后端启动中...")
	log.Printf("  ComicRoot: %s", cfg.ComicRoot)
	log.Printf("  CacheDir:  %s", cfg.CacheDir)
	log.Printf("  Thumbnail: %dx%d", cfg.ThumbSizeW, cfg.ThumbSizeH)
	log.Printf("  Listen:    %s", cfg.Addr())

	// ---- 6. 创建并启动 Fiber App ----
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

	api := app.Group("/api")
	api.Get("/health", handlers.HealthHandler(cfg))
	api.Post("/scan", handlers.ScanHandler(scanner, cfg.ComicRoot))
	api.Get("/thumbs", handlers.ThumbHandler(thumbs))
	api.Get("/thumbs/stats", handlers.ThumbStatsHandler(thumbs))
	api.Post("/thumbs/cleanup", handlers.ThumbCleanupHandler(thumbs))

	// ---- 启动 ----
	if err := app.Listen(cfg.Addr()); err != nil {
		log.Fatalf("监听失败: %v", err)
	}
}
