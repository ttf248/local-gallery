package handlers

import (
	"context"
	"errors"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"github.com/tianlongxiang/local-gallery/internal/store"
)

const smartAlbumRequestTimeout = 2 * time.Minute

type smartAlbumOverrideRequest struct {
	Name   *string `json:"name"`
	Hidden *bool   `json:"hidden"`
}

// SmartAlbumDirectoryHandler aggregates existing folder-scoped groups for the
// photo library without creating summaries for folders that have none yet.
func SmartAlbumDirectoryHandler(service *services.SmartAlbumService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		limit, ok := parseLibraryPageLimit(c)
		if !ok {
			return nil
		}
		ctx, cancel := context.WithTimeout(c.UserContext(), smartAlbumRequestTimeout)
		defer cancel()
		page, err := service.DirectoryPage(ctx, c.Query("dimension", services.SmartAlbumDimensionAll), c.Query("cursor"), limit)
		if err != nil {
			return writeSmartAlbumError(c, err)
		}
		setLibraryRevisionETag(c, page.Revision)
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

// SmartAlbumGroupsHandler returns folder-scoped group summaries and analysis coverage.
func SmartAlbumGroupsHandler(service *services.SmartAlbumService, force bool) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		ctx, cancel := context.WithTimeout(c.UserContext(), smartAlbumRequestTimeout)
		defer cancel()
		summary, err := service.Groups(ctx, c.Params("id"), c.Query("dimension"), force)
		if err != nil {
			return writeSmartAlbumError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "summary": summary})
	}
}

// SmartAlbumOverrideHandler persists a user name or visibility choice for one group.
func SmartAlbumOverrideHandler(service *services.SmartAlbumService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		var body smartAlbumOverrideRequest
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_smart_group_override", "request body is not valid")
		}
		ctx, cancel := context.WithTimeout(c.UserContext(), smartAlbumRequestTimeout)
		defer cancel()
		summary, err := service.UpdateOverride(ctx, c.Params("id"), c.Query("dimension"), c.Params("groupId"), body.Name, body.Hidden)
		if err != nil {
			return writeSmartAlbumError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "summary": summary})
	}
}

// SmartAlbumGroupMediaHandler pages only the selected group. Each file is
// revalidated against the current album snapshot before a media DTO is sent.
func SmartAlbumGroupMediaHandler(
	service *services.SmartAlbumService,
	catalog *services.ResourceCatalog,
	dimensions *services.MediaDimensionService,
	picks *store.PickStore,
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return writeError(c, fiber.StatusServiceUnavailable, "smart_albums_unavailable", "smart album service is unavailable")
		}
		limit, ok := parseLibraryPageLimit(c)
		if !ok {
			return nil
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		ctx, cancel := context.WithTimeout(c.UserContext(), smartAlbumRequestTimeout)
		defer cancel()
		page, err := service.PageGroupMedia(
			ctx, snapshot, c.Params("id"), c.Query("dimension"), c.Params("groupId"),
			c.Query("snapshot"), c.Query("cursor"), limit,
		)
		if err != nil {
			return writeSmartAlbumError(c, err)
		}
		enrichMediaDimensions(snapshot, page.Items, dimensions)
		markPicks(picks, page.Items)
		setLibraryRevisionETag(c, snapshot.Revision())
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

func writeSmartAlbumError(c *fiber.Ctx, err error) error {
	switch {
	case errors.Is(err, services.ErrLibraryNotReady):
		return writeError(c, fiber.StatusServiceUnavailable, "library_not_ready", "media library is not ready")
	case errors.Is(err, services.ErrLibraryResourceNotFound):
		return writeError(c, fiber.StatusNotFound, "resource_not_found", "album was not found")
	case errors.Is(err, services.ErrLibraryResourceWrongKind):
		return writeError(c, fiber.StatusBadRequest, "invalid_album", "resource is not a photo album")
	case errors.Is(err, services.ErrSmartAlbumDimension):
		return writeError(c, fiber.StatusBadRequest, "invalid_group_dimension", "dimension must be time, place, people, or scene")
	case errors.Is(err, services.ErrSmartAlbumNotFound):
		return writeError(c, fiber.StatusNotFound, "smart_group_not_found", "smart album group was not found")
	case errors.Is(err, services.ErrSmartAlbumOverride):
		return writeError(c, fiber.StatusBadRequest, "invalid_smart_group_override", "name or hidden state is invalid")
	case errors.Is(err, services.ErrInvalidPageCursor):
		return writeError(c, fiber.StatusBadRequest, "invalid_cursor", "cursor does not match this smart album view")
	case errors.Is(err, services.ErrStalePageCursor):
		return writeError(c, fiber.StatusConflict, "stale_cursor", "smart album summaries changed; restart pagination")
	case errors.Is(err, context.DeadlineExceeded):
		return writeError(c, fiber.StatusGatewayTimeout, "smart_album_timeout", "smart album grouping took too long")
	case errors.Is(err, context.Canceled):
		return writeError(c, fiber.StatusRequestTimeout, "smart_album_cancelled", "smart album request was cancelled")
	default:
		return writeError(c, fiber.StatusInternalServerError, "smart_album_failed", "smart album data could not be prepared")
	}
}
