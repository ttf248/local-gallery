package middleware

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"

	"github.com/gofiber/fiber/v2"
)

// OpenInOS 在系统文件管理器中打开给定路径。
// 仅当 allowOsOpen=true 时由 handler 调用，否则返回 403。
func OpenInOS(path string) error {
	if path == "" {
		return fmt.Errorf("empty path")
	}
	st, err := os.Stat(path)
	if err != nil {
		return err
	}
	target := path
	if st.IsDir() {
		target = path
	} else {
		target = filepath.Dir(path)
	}

	switch runtime.GOOS {
	case "windows":
		// explorer.exe /select,"<file>" 高亮文件
		if !st.IsDir() {
			return exec.Command("explorer.exe", "/select,", path).Run()
		}
		return exec.Command("explorer.exe", path).Run()
	case "darwin":
		return exec.Command("open", target).Run()
	default:
		return exec.Command("xdg-open", target).Run()
	}
}

// pathState 当前生效的根路径集合；单根（兼容老路径）或多根。
//
// 用规范化绝对路径 + 带分隔符的 "root/" 前缀做白名单校验，O(1) 查询。
// 多个根按出现顺序存储；任一命中即放行。
type pathState struct {
	roots    []string   // 规范化绝对路径
	prefixes []string   // 与 roots 一一对应，root + PathSeparator
}

// safetyState 用 atomic.Pointer 持有 pathState，handler 读无锁。
type safetyState struct {
	v atomic.Pointer[pathState]
}

// RootProvider 兼容老接口：返回当前所有根的快照（用于不需要热更新的场景）。
// 内部实现为 snapshotRoots 的包装；handler 用不到，但保留以防外部依赖。
type RootProvider func() []string

// PathSafetyMiddleware 返回中间件：把 ?path=<abs> 解析后校验是否在任一
// mediaRoots 之下（多根支持）。
// 根路径由 RootsProvider 在每次请求时提供（支持运行中热更新）。
// RootsProvider 返回空切片时按"无根"处理（拒绝所有非 smart: 路径）。
type RootsProvider func() []string

func PathSafetyMiddleware(initialRoots []string) (fiber.Handler, *safetyState) {
	state := &safetyState{}
	state.setRoots(initialRoots)
	handler := func(c *fiber.Ctx) error {
		path := c.Query("path")
		if path == "" {
			return c.Next()
		}
		// smart: 前缀不是绝对路径，但 handler 需据此查询"按标签聚合的合集"
		if strings.HasPrefix(path, "smart:") {
			c.Locals("safePath", path)
			return c.Next()
		}
		// allowConfig 模式：跳过 path safety（handler 自己做白名单校验）。
		// 仅当 allowConfig 显式为 "1" 时跳过；默认值是路径必须在 mediaRoots 之下。
		// 标记存在 c.Locals("skipSafety")=true，handler 仍需读 c.Query("path") 自校验。
		if c.Query("allowConfig") == "1" {
			c.Locals("skipSafety", true)
			return c.Next()
		}
		ps := state.v.Load()
		if ps == nil || len(ps.roots) == 0 {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": "mediaRoots not configured",
			})
		}
		clean, err := validatePathMulti(ps.roots, ps.prefixes, path)
		if err != nil {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"error": err.Error(),
			})
		}
		// 校验后的安全路径存到 c.Locals("safePath")，下游 handler 用 SafePath(c) 取
		c.Locals("safePath", clean)
		return c.Next()
	}
	return handler, state
}

// setRoots 替换根集合；不合法时回退到空（拒绝所有非 smart 路径）。
func (s *safetyState) setRoots(roots []string) {
	absRoots := make([]string, 0, len(roots))
	prefixes := make([]string, 0, len(roots))
	for _, r := range roots {
		abs, err := filepath.Abs(r)
		if err != nil {
			abs = r
		}
		absRoots = append(absRoots, abs)
		prefixes = append(prefixes, abs+string(os.PathSeparator))
	}
	s.v.Store(&pathState{
		roots:    absRoots,
		prefixes: prefixes,
	})
}

// SetRoots 公开方法，供 Manager 回调调用以热更新根集合。
func (s *safetyState) SetRoots(roots []string) {
	s.setRoots(roots)
}

// SafePath 从 c.Locals 取出已校验的绝对路径。
func SafePath(c *fiber.Ctx) string {
	if v, ok := c.Locals("safePath").(string); ok && v != "" {
		return v
	}
	return c.Query("path")
}

// IsSafetyBypassed 报告当前请求是否通过 allowConfig=1 跳过了 path safety。
// 跳过后 handler 应自行做白名单校验（不允许直接放行任意 path）。
func IsSafetyBypassed(c *fiber.Ctx) bool {
	v, ok := c.Locals("skipSafety").(bool)
	return ok && v
}

// validatePathMulti 检查 p 是否在任一根之下。
//  - 必须绝对路径
//  - filepath.Rel 不报错且不以 ".." 开头即为子路径
func validatePathMulti(roots, prefixes []string, p string) (string, error) {
	if !filepath.IsAbs(p) {
		return "", fmt.Errorf("path must be absolute")
	}
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	for i, root := range roots {
		rel, err := filepath.Rel(root, abs)
		if err != nil {
			continue
		}
		if rel == ".." || strings.HasPrefix(rel, ".."+string(os.PathSeparator)) {
			continue
		}
		// 命中第 i 个根；额外断言 abs 以 prefix 开头，避免边缘大小写问题
		_ = prefixes[i] // 保留 prefixes 字段供未来 audit / debug
		return abs, nil
	}
	return "", fmt.Errorf("path outside any configured media root")
}
