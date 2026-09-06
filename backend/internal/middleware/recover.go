package middleware

import (
	"log"
	"runtime/debug"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
)

// Recover 捕获 panic，返回 500 + 简短错误。
// 避免单个请求崩溃拖垮整个服务。
func Recover() fiber.Handler {
	return func(c *fiber.Ctx) (err error) {
		defer func() {
			if r := recover(); r != nil {
				log.Printf("PANIC: %v\n%s", r, debug.Stack())
				err = httputil.Internal(c, "internal_error", "internal server error")
			}
		}()
		return c.Next()
	}
}
