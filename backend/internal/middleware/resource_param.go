package middleware

import "github.com/gofiber/fiber/v2"

// ResourceParam 把路由中的 :id 解析为内部路径，按当前媒体根再次校验后写入 safePath。
func ResourceParam(resolver ResourceResolver, validators ...PathValidator) fiber.Handler {
	var validator PathValidator
	if len(validators) > 0 {
		validator = validators[0]
	}
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		if id == "" {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
				"code": "missing_resource_id", "message": "resource id is required",
			})
		}
		path, ok := resolver.Resolve(id)
		if !ok {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
				"code": "resource_not_found", "message": "resource id is invalid or stale",
			})
		}
		if validator != nil {
			path, err := validator.Validate(path)
			if err != nil {
				return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
					"code": "resource_not_found", "message": "resource id is invalid or stale",
				})
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

// ResourceID 返回当前请求的公开资源 ID。
func ResourceID(c *fiber.Ctx) string {
	if id, ok := c.Locals("resourceID").(string); ok {
		return id
	}
	return c.Query("path")
}
