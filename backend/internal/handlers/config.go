// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
)

// ConfigResponse GET /api/config 的响应体。
type ConfigResponse struct {
	MediaRoot       string `json:"mediaRoot"`
	Host            string `json:"host"`
	Port            int    `json:"port"`
	CacheDir        string `json:"cacheDir"`
	ThumbSizeW      int    `json:"thumbSizeW"`
	ThumbSizeH      int    `json:"thumbSizeH"`
	ThumbCacheSize  int    `json:"thumbCacheSize"`
	CacheMaxAgeDays int    `json:"cacheMaxAgeDays"`
	AllowOsOpen     bool   `json:"allowOsOpen"`
	StaticDir       string `json:"staticDir"`
	ConfigPath      string `json:"configPath"`
}

// ConfigUpdateResponse PUT /api/config 的响应体。
type ConfigUpdateResponse struct {
	OK               bool     `json:"ok"`
	Config           ConfigResponse `json:"config"`
	RequiresRestart  []string `json:"requiresRestart,omitempty"`
	MediaRootChanged bool     `json:"mediaRootChanged"`
}

// ConfigGetHandler 返回 /api/config GET 处理函数。
func ConfigGetHandler(mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := mgr.Get()
		return c.JSON(ConfigResponse{
			MediaRoot:       cfg.MediaRoot,
			Host:            cfg.Host,
			Port:            cfg.Port,
			CacheDir:        cfg.CacheDir,
			ThumbSizeW:      cfg.ThumbSizeW,
			ThumbSizeH:      cfg.ThumbSizeH,
			ThumbCacheSize:  cfg.ThumbCacheSize,
			CacheMaxAgeDays: cfg.CacheMaxAgeDays,
			AllowOsOpen:     cfg.AllowOsOpen,
			StaticDir:       cfg.StaticDir,
			ConfigPath:      mgr.Path(),
		})
	}
}

// ConfigUpdateHandler 返回 /api/config PUT 处理函数。
//
// 行为：
//  1. 解析 PATCH
//  2. 委托给 Manager.Update（合并 → 校验 → 写盘 → 通知订阅者）
//  3. 报告 requiresRestart / mediaRootChanged
func ConfigUpdateHandler(mgr *config.Manager, onUpdate func(c *config.Config, mediaRootChanged bool) error) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var patch config.ConfigPatch
		if err := c.BodyParser(&patch); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid JSON body: " + err.Error(),
			})
		}

		prevRoot := mgr.Root()
		requiresRestart, err := mgr.Update(patch)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		newCfg := mgr.Get()
		mediaRootChanged := prevRoot != newCfg.Root()

		if onUpdate != nil {
			if err := onUpdate(newCfg, mediaRootChanged); err != nil {
				// 通知失败：内存已是新值但下游没跟上；返回 500 提示用户回滚或重启
				return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
					"error":   "config saved, but applying to running services failed: " + err.Error(),
					"applied": true,
				})
			}
		}

		return c.JSON(ConfigUpdateResponse{
			OK: true,
			Config: ConfigResponse{
				MediaRoot:       newCfg.MediaRoot,
				Host:            newCfg.Host,
				Port:            newCfg.Port,
				CacheDir:        newCfg.CacheDir,
				ThumbSizeW:      newCfg.ThumbSizeW,
				ThumbSizeH:      newCfg.ThumbSizeH,
				ThumbCacheSize:  newCfg.ThumbCacheSize,
				CacheMaxAgeDays: newCfg.CacheMaxAgeDays,
				AllowOsOpen:     newCfg.AllowOsOpen,
				StaticDir:       newCfg.StaticDir,
				ConfigPath:      mgr.Path(),
			},
			RequiresRestart:  requiresRestart,
			MediaRootChanged: mediaRootChanged,
		})
	}
}
