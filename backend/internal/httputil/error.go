// Package httputil 跨 handler 复用的 HTTP 工具。
//
// 主要负责统一错误响应格式,见 Error。
package httputil

import (
	"github.com/gofiber/fiber/v2"
)

// errorResponse 统一的错误响应结构。
//
// 新合约(自 v2.x 起):所有 4xx/5xx 响应都长这样:
//
//	{
//	  "code":    "snake_case_id",
//	  "message": "人可读的描述",
//	  "details": { ... }  // 可选,具体上下文
//	}
//
// 老字段 `error` 仍作为 message 的别名保留,前端不感知。
// 详见 docs/API.md。
type errorResponse struct {
	Code    string         `json:"code"`
	Message string         `json:"message"`
	Details map[string]any `json:"details,omitempty"`
}

// Error 写 4xx/5xx 响应,统一格式。
//
//   - status: HTTP 状态码(fiber.StatusBadRequest 等)
//   - code:    snake_case 短字符串,前端用此做 if 区分(error.code === 'video_cover_missing')
//   - message: 人可读描述
//   - details: 可选,附加上下文(字段名、resourceId 等)
//
// 调用方写 `return httputil.Error(c, fiber.StatusNotFound, "album_not_found", "...")` 即可。
func Error(c *fiber.Ctx, status int, code, message string, details ...map[string]any) error {
	resp := errorResponse{Code: code, Message: message}
	if len(details) > 0 && details[0] != nil {
		resp.Details = details[0]
	}
	return c.Status(status).JSON(fiber.Map{
		"code":    resp.Code,
		"message": resp.Message,
		"error":   message, // 兼容老前端 + 后台脚本
		"details": resp.Details,
	})
}

// BadRequest 400 + code 快捷方式。
func BadRequest(c *fiber.Ctx, code, message string, details ...map[string]any) error {
	return Error(c, fiber.StatusBadRequest, code, message, details...)
}

// NotFound 404 + code。
func NotFound(c *fiber.Ctx, code, message string, details ...map[string]any) error {
	return Error(c, fiber.StatusNotFound, code, message, details...)
}

// Internal 500 + code。通用兜底,不应被业务 handler 频繁使用。
func Internal(c *fiber.Ctx, code, message string, details ...map[string]any) error {
	return Error(c, fiber.StatusInternalServerError, code, message, details...)
}
