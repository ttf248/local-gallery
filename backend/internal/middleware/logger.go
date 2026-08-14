// Package middleware 提供 Fiber 中间件。
package middleware

import (
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
)

// Logger 输出简洁的访问日志。
// 格式：METHOD path -> status (duration)
func Logger() fiber.Handler {
	return func(c *fiber.Ctx) error {
		start := time.Now()

		err := c.Next()

		duration := time.Since(start)
		status := c.Response().StatusCode()
		log.Printf("%s %s -> %d (%s)",
			c.Method(), c.Path(), status, duration)

		return err
	}
}
