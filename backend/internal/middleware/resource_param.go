package middleware

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
)

// ResourceParam 把路由中的 :id 解析为内部路径，按当前媒体根再次校验后写入 safePath。
func ResourceParam(resolver ResourceResolver, validators ...PathValidator) fiber.Handler {
	var validator PathValidator
	if len(validators) > 0 {
		validator = validators[0]
	}
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		if id == "" {
			return httputil.BadRequest(c, "missing_resource_id", "resource id is required")
		}
		path := ""
		ok := false
		if snapshotResolver, supportsSnapshot := resolver.(SnapshotResourceResolver); supportsSnapshot {
			var snapshot any
			path, snapshot, ok = snapshotResolver.ResolveWithSnapshot(id)
			if ok {
				c.Locals("resourceSnapshot", snapshot)
			}
		} else {
			path, ok = resolver.Resolve(id)
		}
		if !ok {
			return httputil.NotFound(c, "resource_not_found", "resource id is invalid or stale")
		}
		if validator != nil {
			path, err := validator.Validate(path)
			if err != nil {
				return httputil.NotFound(c, "resource_not_found", "resource id is invalid or stale")
			}
			c.Locals("safePath", path)
		}
		if validator == nil {
			c.Locals("safePath", path)
		}
		c.Locals("resourceID", id)
		return c.Next()
	}
}

// ResourceSnapshot 返回 ResourceParam 解析 ID 时固定的不可变快照。
func ResourceSnapshot(c *fiber.Ctx) any {
	return c.Locals("resourceSnapshot")
}

// ResourceID 返回当前请求的公开资源 ID。
func ResourceID(c *fiber.Ctx) string {
	if id, ok := c.Locals("resourceID").(string); ok {
		return id
	}
	return c.Query("path")
}
