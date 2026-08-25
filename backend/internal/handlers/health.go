// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"runtime"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/config"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// HealthResponse 健康检查响应。MediaRoots 仅包含不可逆的根资源 ID。
type HealthResponse struct {
	Status     string   `json:"status"`
	MediaRoots []string `json:"mediaRoots"`
	Version    string   `json:"version"`
	GoVersion  string   `json:"goVersion"`
	Goroutines int      `json:"goroutines"`
	// 能力位：让前端在启动时知道哪些服务端能力可用，
	// 避免硬编码 false 导致"在系统文件管理器中打开"按钮永远 disabled。
	AllowOsOpen bool `json:"allowOsOpen"`
}

// HealthHandler 返回 /api/health 处理函数。
func HealthHandler(mgr *config.Manager, catalogs ...*services.ResourceCatalog) fiber.Handler {
	catalog := optionalCatalog(catalogs)
	return func(c *fiber.Ctx) error {
		roots := mgr.Roots()
		if catalog != nil {
			publicRoots := make([]string, 0, len(roots))
			for _, root := range roots {
				if id := catalog.ExternalID(root, services.ResourceRoot); id != "" {
					publicRoots = append(publicRoots, id)
				}
			}
			roots = publicRoots
		}
		cfg := mgr.Get()
		return c.JSON(HealthResponse{
			Status:      "ok",
			MediaRoots:  roots,
			Version:     config.Version,
			GoVersion:   runtime.Version(),
			Goroutines:  runtime.NumGoroutine(),
			AllowOsOpen: cfg.AllowOsOpen,
		})
	}
}
