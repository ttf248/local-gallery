package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
)

func writeError(c *fiber.Ctx, status int, code, message string, details ...map[string]any) error {
	return httputil.Error(c, status, code, message, details...)
}
