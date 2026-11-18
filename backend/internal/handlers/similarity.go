package handlers

import (
	"errors"
	"strconv"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/httputil"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

// 相似照片整理的 HTTP 接口。
//
// 这一组接口只做「读分组、改人工决定」两件事：
// 分组本身由后台分析任务算出，这里不做任何重活；
// 任何写操作都只落在用户自己的状态文件和精选集合上，
// 绝不碰原始媒体。

// SimilarityStatusHandler GET /api/similarity/status
//
// 返回整理模块的整体状态：分析覆盖、是否有语义向量可用、
// 分组是否过期。
func SimilarityStatusHandler(service *services.SimilarityService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		return c.JSON(fiber.Map{"ok": true, "status": service.Status()})
	}
}

// SimilarityGroupsHandler GET /api/similarity/groups
//
// Query: kind=exact|near|burst、folder=…、status=pending|reviewed|ignored、
// limit、offset。
func SimilarityGroupsHandler(service *services.SimilarityService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		filter := services.SimilarityGroupFilter{
			Kind:   services.NormalizeSimilarityKind(c.Query("kind")),
			Folder: c.Query("folder"),
			Status: services.NormalizeSimilarityStatus(c.Query("status")),
		}
		if raw := c.Query("limit"); raw != "" {
			limit, err := strconv.Atoi(raw)
			if err != nil || limit < 0 {
				return httputil.BadRequest(c, "invalid_similarity_query", "invalid similarity query")
			}
			filter.Limit = limit
		}
		if raw := c.Query("offset"); raw != "" {
			offset, err := strconv.Atoi(raw)
			if err != nil || offset < 0 {
				return httputil.BadRequest(c, "invalid_similarity_query", "invalid similarity query")
			}
			filter.Offset = offset
		}
		page := service.Groups(filter)
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

// SimilarityRebuildHandler POST /api/similarity/rebuild
//
// 重算分组。特征已经变了但还没重建时用它，不必再跑一遍分析任务。
func SimilarityRebuildHandler(service *services.SimilarityService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		summary, err := service.RebuildNow()
		if err != nil {
			if errors.Is(err, services.ErrLibraryNotReady) {
				return httputil.BadRequest(c, "library_not_ready", "the media library is not ready")
			}
			return httputil.Internal(c, "similarity_rebuild_failed", "the similarity groups could not be rebuilt")
		}
		return c.JSON(fiber.Map{"ok": true, "summary": summary})
	}
}

// SimilarityGroupUpdateHandler PUT /api/similarity/groups/:id
//
// Body: {"representative": "f_..."} 或 {"reviewed": true} 或 {"ignored": true}。
//
// 三种动作可以一次只给一个；representative 指定的照片必须在这组里。
func SimilarityGroupUpdateHandler(service *services.SimilarityService) fiber.Handler {
	type request struct {
		Representative string `json:"representative,omitempty"`
		Reviewed       *bool  `json:"reviewed,omitempty"`
		Ignored        *bool  `json:"ignored,omitempty"`
	}
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		var input request
		if err := c.BodyParser(&input); err != nil {
			return httputil.BadRequest(c, "invalid_similarity_request", "request body is not valid JSON")
		}
		groupID := c.Params("id")
		if input.Reviewed != nil {
			if err := service.SetReviewed(groupID, *input.Reviewed); err != nil {
				return writeSimilarityError(c, err)
			}
		}
		if input.Ignored != nil {
			if err := service.SetIgnored(groupID, *input.Ignored); err != nil {
				return writeSimilarityError(c, err)
			}
		}
		if input.Representative != "" {
			if err := service.SetRepresentative(groupID, input.Representative); err != nil {
				return writeSimilarityError(c, err)
			}
		}
		if input.Reviewed == nil && input.Ignored == nil && input.Representative == "" {
			return httputil.BadRequest(c, "invalid_similarity_request", "no action was requested")
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

// SimilarityBatchHandler POST /api/similarity/batch
//
// Body: {"action": "review"|"unreview"|"ignore"|"unignore"|"pick", "groupIds": [...]}
//
// pick 把每组的代表照片加入现有的照片级精选。
func SimilarityBatchHandler(service *services.SimilarityService) fiber.Handler {
	type request struct {
		Action   string   `json:"action"`
		GroupIDs []string `json:"groupIds"`
	}
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		var input request
		if err := c.BodyParser(&input); err != nil {
			return httputil.BadRequest(c, "invalid_similarity_request", "request body is not valid JSON")
		}
		if len(input.GroupIDs) == 0 || len(input.GroupIDs) > maxSelectionBatch {
			return httputil.BadRequest(c, "invalid_similarity_batch", "invalid similarity batch")
		}
		changed, err := service.ApplyBatch(input.Action, input.GroupIDs)
		if err != nil {
			if errors.Is(err, services.ErrSimilarityGroupNotFound) {
				return httputil.NotFound(c, "similarity_group_not_found", "the similarity group no longer exists")
			}
			return httputil.BadRequest(c, "invalid_similarity_batch", "the similarity action could not be applied")
		}
		return c.JSON(fiber.Map{"ok": true, "changed": changed})
	}
}

// writeSimilarityError 把服务层的错误映射成可以公开的错误码。
func writeSimilarityError(c *fiber.Ctx, err error) error {
	if errors.Is(err, services.ErrSimilarityGroupNotFound) {
		return httputil.NotFound(c, "similarity_group_not_found", "the similarity group no longer exists")
	}
	return httputil.BadRequest(c, "invalid_similarity_request", "the similarity request could not be applied")
}
