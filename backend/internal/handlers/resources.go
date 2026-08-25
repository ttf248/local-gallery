package handlers

import (
	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

func optionalCatalog(catalogs []*services.ResourceCatalog) *services.ResourceCatalog {
	if len(catalogs) == 0 {
		return nil
	}
	return catalogs[0]
}

func publicID(catalog *services.ResourceCatalog, path string, kind services.ResourceKind) string {
	if catalog == nil {
		return path
	}
	return catalog.ExternalID(path, kind)
}

func resolveResource(c *fiber.Ctx, catalog *services.ResourceCatalog, id string, kind services.ResourceKind) (string, bool) {
	if catalog == nil {
		return id, id != ""
	}
	ref, ok := catalog.Lookup(id)
	if !ok || ref.Kind != kind {
		_ = c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"code": "invalid_resource_id", "message": "resource id is invalid or has the wrong type",
		})
		return "", false
	}
	return ref.AbsolutePath, true
}
