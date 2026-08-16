// Package handlers 提供 Fiber 路由处理函数。
package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/comic-reader/internal/config"
)

// ConfigResponse GET /api/config 的响应体。
//
// mediaRoots 数组是权威字段；mediaRoot 保留为 mediaRoots[0] 的别名，
// 老前端 / 健康检查 / 路径安全中间件回退逻辑继续可用。
type ConfigResponse struct {
	MediaRoots      []string `json:"mediaRoots"`
	MediaRoot       string   `json:"mediaRoot"` // 兼容：mediaRoots[0]
	Host            string   `json:"host"`
	Port            int      `json:"port"`
	CacheDir        string   `json:"cacheDir"`
	ThumbSizeW      int      `json:"thumbSizeW"`
	ThumbSizeH      int      `json:"thumbSizeH"`
	ThumbCacheSize  int      `json:"thumbCacheSize"`
	CacheMaxAgeDays int      `json:"cacheMaxAgeDays"`
	AllowOsOpen     bool     `json:"allowOsOpen"`
	StaticDir       string   `json:"staticDir"`
	ConfigPath      string   `json:"configPath"`
}

// ConfigUpdateResponse PUT /api/config 的响应体。
type ConfigUpdateResponse struct {
	OK                bool            `json:"ok"`
	Config            ConfigResponse  `json:"config"`
	RequiresRestart   []string        `json:"requiresRestart,omitempty"`
	MediaRootsChanged bool            `json:"mediaRootsChanged"` // 根集合是否变化（顺序无关）
}

// rootsEqual 规范化比较两个根列表（顺序无关）。
func rootsEqual(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	seen := make(map[string]int, len(a))
	for _, r := range a {
		seen[r]++
	}
	for _, r := range b {
		if seen[r] == 0 {
			return false
		}
		seen[r]--
	}
	return true
}

// ConfigGetHandler 返回 /api/config GET 处理函数。
func ConfigGetHandler(mgr *config.Manager) fiber.Handler {
	return func(c *fiber.Ctx) error {
		cfg := mgr.Get()
		roots := cfg.Roots()
		return c.JSON(ConfigResponse{
			MediaRoots:      roots,
			MediaRoot:       cfg.Root(),
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
//  3. 报告 requiresRestart / mediaRootsChanged
func ConfigUpdateHandler(mgr *config.Manager, onUpdate func(c *config.Config, mediaRootsChanged bool) error) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var patch config.ConfigPatch
		if err := c.BodyParser(&patch); err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "invalid JSON body: " + err.Error(),
			})
		}

		prevRoots := mgr.Roots()
		requiresRestart, err := mgr.Update(patch)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		newCfg := mgr.Get()
		newRoots := newCfg.Roots()
		mediaRootsChanged := !rootsEqual(prevRoots, newRoots)

		if onUpdate != nil {
			if err := onUpdate(newCfg, mediaRootsChanged); err != nil {
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
				MediaRoots:      newRoots,
				MediaRoot:       newCfg.Root(),
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
			RequiresRestart:   requiresRestart,
			MediaRootsChanged: mediaRootsChanged,
		})
	}
}
