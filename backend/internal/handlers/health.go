// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"runtime"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
)

// HealthResponse 健康检查响应。
type HealthResponse struct {
	Status     string `json:"status"`
	ComicRoot  string `json:"comicRoot"`
	Version    string `json:"version"`
	GoVersion  string `json:"goVersion"`
	Goroutines int    `json:"goroutines"`
}

// HealthHandler 返回 /api/health 处理函数。
func HealthHandler(cfg *config.Config) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(HealthResponse{
			Status:     "ok",
			ComicRoot:  cfg.ComicRoot,
			Version:    config.Version,
			GoVersion:  runtime.Version(),
			Goroutines: runtime.NumGoroutine(),
		})
	}
}
