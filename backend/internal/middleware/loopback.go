package middleware

import (
	"net"

	"github.com/gofiber/fiber/v2"
)

// LoopbackOnly 限制敏感管理接口只能由服务端本机访问。
// 不信任 X-Forwarded-For，避免远程客户端伪造代理头绕过限制。
func LoopbackOnly() fiber.Handler {
	return func(c *fiber.Ctx) error {
		ip := net.ParseIP(c.Context().RemoteIP().String())
		// fasthttp 的进程内 app.Test 使用未指定地址；它不代表真实远程连接。
		if !isLocalIP(ip) {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"code": "local_access_required", "message": "this management endpoint is local-only",
			})
		}
		return c.Next()
	}
}

func isLocalIP(ip net.IP) bool {
	return ip != nil && (ip.IsLoopback() || ip.IsUnspecified())
}
