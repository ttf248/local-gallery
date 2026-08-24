// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"runtime"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
)

// HealthResponse 健康检查响应。
//
// mediaRoots 是权威字段（数组）；mediaRoot / comicRoot 保留为 mediaRoots[0]
// 的别名以兼容老调用方。
type HealthResponse struct {
	Status     string   `json:"status"`
	MediaRoots []string `json:"mediaRoots"`
	MediaRoot  string   `json:"mediaRoot"` // 兼容：mediaRoots[0]
	ComicRoot  string   `json:"comicRoot"` // 旧字段保留为 mediaRoot 的别名
	Version    string   `json:"version"`
	GoVersion  string   `json:"goVersion"`
	Goroutines int      `json:"goroutines"`
	// 能力位：让前端在启动时知道哪些服务端能力可用，
	// 避免硬编码 false 导致"在系统文件管理器中打开"按钮永远 disabled。
	AllowOsOpen bool `json:"allowOsOpen"`
}

// HealthHandler 返回 /api/health 处理函数。
func HealthHandler(mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		roots := mgr.Roots()
		first := ""
		if len(roots) > 0 {
			first = roots[0]
		}
		cfg := mgr.Get()
		return c.JSON(HealthResponse{
			Status:      "ok",
			MediaRoots:  roots,
			MediaRoot:   first,
			ComicRoot:   first,
			Version:     config.Version,
			GoVersion:   runtime.Version(),
			Goroutines:  runtime.NumGoroutine(),
			AllowOsOpen: cfg.AllowOsOpen,
		})
	}
}
