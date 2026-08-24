// Command server 本地画廊后端入口。
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

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/handlers"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
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
		fmt.Fprintf(os.Stderr, "提示：在 config.yaml 中设置 mediaRoots 指向媒体根目录\n")
		os.Exit(2)
	}

	log.Printf("local-gallery 后端启动中...")
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
		AppName:               "local-gallery",
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

	// 服务端 ffmpeg 抽帧器(可选):ffmpeg 不在/坏掉时 Available()=false,
	// ThumbnailService 会自动回退到原"客户端抽帧 + 上传"流程。
	videoCover := services.NewVideoCoverExtractor(services.VideoCoverOptions{
		FFmpegPath: cfg.FFmpegPath,
		Width:      cfg.ThumbSizeW,
		Height:     cfg.ThumbSizeH,
		Quality:    85,
		Timeout:    10 * time.Second,
	})
	if videoCover.Available() {
		log.Printf("  FFmpeg:    %s (服务端视频封面已启用)", videoCover.FFmpegPath())
	} else {
		log.Printf("  FFmpeg:    <不可用 / 未配置> → 视频封面回退到客户端浏览器抽帧")
	}

	// ffprobe 元数据服务(可选)
	videoInfo := services.NewVideoInfoService(services.VideoInfoOptions{
		FFmpegPath: cfg.FFmpegPath,
		Timeout:    5 * time.Second,
	})
	if videoInfo.Available() {
		log.Printf("  FFprobe:   %s (视频元数据已启用)", videoInfo.FFprobePath())
	}

	// 视频 faststart 化服务(可选):把 moov 移到 mdat 前面,解决
	// "非 faststart MP4 在浏览器里无法边下边播"问题。ffmpeg 不可用
	// 时 VideoHandler 静默回退到原文件,不阻断播放。
	//
	// 注意:这里传 cfg.CacheDir(让 service 内部自己拼 video-faststart
	// 子目录),不要在 main.go 里再加一层 —— 否则会出现
	// cacheDir/video-faststart/video-faststart/<hash>.mp4 的双层嵌套。
	faststart := services.NewVideoFaststartService(services.FaststartOptions{
		CacheDir: cfg.CacheDir,
		FFmpeg:   cfg.FFmpegPath,
	})
	if faststart.Available() {
		log.Printf("  VideoFaststart: %s (非 faststart MP4 自动重封装 + 缓存)", faststart.FFmpegPath())
	} else {
		log.Printf("  VideoFaststart: <不可用> → 非 faststart MP4 仍按原文件发送(浏览器可能播不了)")
	}

	// 视频转码服务(可选):把 AV1/HEVC/ProRes 等浏览器播不了的编码
	// 转成 H.264 + AAC 缓存。ffmpeg 不可用时静默回退到 faststart / 原文件。
	transcode := services.NewTranscodeService(services.TranscodeOptions{
		CacheDir: cfg.CacheDir,
		FFmpeg:   cfg.FFmpegPath,
		Info:     videoInfo,
		// timeout / concurrency 用默认(30m / NumCPU/2)
	})
	if transcode.Available() {
		log.Printf("  VideoTranscode: %s profile=%s concurrency=%d (冷门编码 → H.264+AAC 自动转码 + 缓存)",
			transcode.CacheDir(), transcode.Profile().Name, transcode.Concurrency())
	} else {
		log.Printf("  VideoTranscode: <不可用> → 冷门编码仍按原文件发送")
	}

	thumbs, err := services.NewThumbnailService(services.ThumbnailOptions{
		CacheDir:   cfg.CacheDir,
		Width:      cfg.ThumbSizeW,
		Height:     cfg.ThumbSizeH,
		MaxAgeDays: cfg.CacheMaxAgeDays,
		LRUSize:    cfg.ThumbCacheSize,
		VideoCover: videoCover,
	})
	if err != nil {
		log.Fatalf("初始化缩略图服务失败: %v", err)
	}
	cacheStats := services.NewCacheStatsService(30 * time.Second)
	runner := services.NewAsyncScanRunner()
	prefs := store.NewPrefsStore(filepath.Join(cfg.CacheDir, "web_settings.json"))

	// 扫描结果缓存（启动时从磁盘加载，供前端免扫描查看）。
	//
	// 启动时校验：缓存文件里记录的 mediaRoots 必须与当前 cfg.Roots() 一致；
	// 不一致时直接清空（删除磁盘文件）并触发一次自动扫描，避免重启后
	// 前端拉到上一个 mediaRoot 下的扫描结果（参见 services.LoadWithRoots）。
	scanCache := services.NewScanResultCache(filepath.Join(cfg.CacheDir, "scan_cache.json"))
	currentRoots := cfg.Roots()
	mismatch, err := scanCache.LoadWithRoots(currentRoots)
	if err != nil {
		log.Printf("警告：加载扫描缓存失败 %v", err)
	}
	runner.SetCache(scanCache)
	if r := scanCache.Get(); r != nil {
		log.Printf("  已加载上次扫描结果：%d 相册，扫描于 %s", r.AlbumCount, r.ScannedAt.Format("2006-01-02 15:04:05"))
	} else if mismatch {
		log.Printf("  缓存的根目录与当前 mediaRoots 不一致，已清空旧缓存")
	}

	// 启动时若缓存为空（首次启动 / 缓存根目录不匹配被清空 / 磁盘无缓存），
	// 自动跑一次扫描，避免前端打开时看到 404 或空数据。
	// 用 goroutine 异步执行，不阻塞服务启动；扫描进度通过 /api/scan/:id/events
	// 暴露给前端。
	if scanCache.Get() == nil && len(currentRoots) > 0 {
		go func() {
			id, _, startErr := runner.Start(services.ScanOptions{
				Roots:    currentRoots,
				MaxDepth: 2,
			})
			if startErr != nil {
				log.Printf("启动自动扫描失败: %v", startErr)
				return
			}
			log.Printf("  已自动启动扫描 id=%s，等待结果…", id)
		}()
	}

	// 缩略图参数 / 缓存目录 / ffmpeg 路径变更：热更新 ThumbnailService
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
		// ffmpeg 路径变了：重新构造抽帧器 + 元数据服务
		newCover := services.NewVideoCoverExtractor(services.VideoCoverOptions{
			FFmpegPath: snapshot.FFmpegPath,
			Width:      snapshot.ThumbSizeW,
			Height:     snapshot.ThumbSizeH,
			Quality:    85,
			Timeout:    10 * time.Second,
		})
		thumbs.SetVideoCover(newCover)
		newInfo := services.NewVideoInfoService(services.VideoInfoOptions{
			FFmpegPath: snapshot.FFmpegPath,
			Timeout:    5 * time.Second,
		})
		videoInfo = newInfo
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
	// 清空扫描结果缓存（不立即扫描；前端调用后引导用户点"重新扫描"）。
	api.Post("/scan/cache/clear", handlers.ScanCacheClearHandler(scanCache))
	api.Get("/albums", handlers.AlbumDetailHandler(scanCache))
	// /api/folders 是 /api/albums 的语义化别名（本地画廊用 "folder" 更准确）；
	// 老客户端/历史链接仍可继续访问 /api/albums。
	api.Get("/folders", handlers.AlbumDetailHandler(scanCache))
	api.Get("/search", handlers.SearchHandler(scanCache))
	// 标签聚合的语义化路由；"smart:<tag>" 仍能访问。
	api.Get("/tags", handlers.AlbumDetailHandler(scanCache))
	api.Get("/thumbs", handlers.ThumbHandler(thumbs))
	api.Get("/thumbs/stats", handlers.ThumbStatsHandler(thumbs))
	api.Post("/thumbs/cleanup", handlers.ThumbCleanupHandlerWithCacheStats(thumbs, cacheStats))
	// 清空全部缩略图缓存（不只是过期）。前端设置页"缓存占用"行的"清空"按钮调用。
	api.Post("/thumbs/clear", handlers.ThumbClearAllHandlerWithCacheStats(thumbs, cacheStats))
	api.Get("/cache/stats", handlers.CacheStatsHandler(mgr, cacheStats))
	api.Get("/images", handlers.ImageHandler())
	api.Get("/images/info", handlers.ImageInfoHandler())
	// 视频流 + 元信息（前端 <video> 元素 / HoverPreview / 时长显示使用）
	api.Get("/videos", handlers.VideoHandler(transcode, faststart))
	api.Get("/videos/info", handlers.VideoInfoHandler(videoInfo, transcode))
	// 转码进度（轮询；SSE）
	api.Get("/videos/transcode/status", handlers.TranscodeStatusHandler(transcode))
	api.Get("/videos/transcode/events", handlers.TranscodeEventsHandler(transcode))
	api.Post("/videos/transcode/cancel", handlers.TranscodeCancelHandler(transcode))
	// 转码缓存管理（V1：admin 手动;V2:加 maxBytes 配置自动触发）
	api.Get("/videos/transcode/cache/stats", handlers.TranscodeCacheStatsHandler(transcode))
	api.Post("/videos/transcode/cache/clear", handlers.TranscodeCacheClearHandler(transcode))
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
