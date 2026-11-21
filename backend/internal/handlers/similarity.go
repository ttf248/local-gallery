package handlers

import (
	"errors"
	"strconv"
	"strings"

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
// resourceId=…、limit、offset。
//
// resourceId 给出时只返回含有这张照片的分组：照片墙上展开一组时，
// 用它把那一组的成员名单读回来。
func SimilarityGroupsHandler(service *services.SimilarityService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		filter := services.SimilarityGroupFilter{
			Kind:       services.NormalizeSimilarityKind(c.Query("kind")),
			Folder:     c.Query("folder"),
			Status:     services.NormalizeSimilarityStatus(c.Query("status")),
			ResourceID: strings.TrimSpace(c.Query("resourceId")),
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
// Body: {"status": "reviewed"} 或 {"representative": "f_..."}
// 或旧式的 {"reviewed": true} / {"ignored": true}。
//
// status 直接设定三档状态（pending / reviewed / ignored），
// 返回里带上操作前后的状态 —— 撤销要靠 previousStatus 恢复回去。
// expectedStatus 是并发保护：只有当前状态等于它才写入，状态对不上
// 返回 409（撤销过期时就是这种情况）。
func SimilarityGroupUpdateHandler(service *services.SimilarityService) fiber.Handler {
	type request struct {
		Representative string `json:"representative,omitempty"`
		Reviewed       *bool  `json:"reviewed,omitempty"`
		Ignored        *bool  `json:"ignored,omitempty"`
		// Status 直接设定状态（三档）。
		Status string `json:"status,omitempty"`
		// ExpectedStatus 只有当前状态等于它才写入。
		ExpectedStatus string `json:"expectedStatus,omitempty"`
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
		response := fiber.Map{"ok": true}
		if input.Status != "" {
			result, err := service.SetStatusIfCurrent(groupID, input.ExpectedStatus, input.Status)
			if err != nil {
				if errors.Is(err, services.ErrSimilarityStatusConflict) {
					return httputil.Conflict(c, "similarity_status_conflict", "this group has changed since the action was made")
				}
				return writeSimilarityError(c, err)
			}
			response["status"] = result.Current
			response["previousStatus"] = result.Previous
			response["changed"] = result.Changed
		}
		if input.Reviewed != nil {
			status := services.SimilarityStatusPending
			if *input.Reviewed {
				status = services.SimilarityStatusReviewed
			}
			result, err := service.SetStatus(groupID, status)
			if err != nil {
				return writeSimilarityError(c, err)
			}
			response["status"] = result.Current
			response["previousStatus"] = result.Previous
			response["changed"] = result.Changed
		}
		if input.Ignored != nil {
			status := services.SimilarityStatusPending
			if *input.Ignored {
				status = services.SimilarityStatusIgnored
			}
			result, err := service.SetStatus(groupID, status)
			if err != nil {
				return writeSimilarityError(c, err)
			}
			response["status"] = result.Current
			response["previousStatus"] = result.Previous
			response["changed"] = result.Changed
		}
		if input.Representative != "" {
			if err := service.SetRepresentative(groupID, input.Representative); err != nil {
				return writeSimilarityError(c, err)
			}
		}
		if input.Status == "" && input.Reviewed == nil && input.Ignored == nil && input.Representative == "" {
			return httputil.BadRequest(c, "invalid_similarity_request", "no action was requested")
		}
		return c.JSON(response)
	}
}

// SimilarityBatchHandler POST /api/similarity/batch
//
// Body: {"action": "review"|"unreview"|"ignore"|"unignore"|"pick", "groupIds": [...]}
//
// 或 {"action": "restore", "restores": [{"groupId": "...", "from": "...", "to": "..."}]}：
// 撤销用后者，每一组各自回到自己的原状态。
//
// pick 把每组的代表照片加入现有的照片级精选。
func SimilarityBatchHandler(service *services.SimilarityService) fiber.Handler {
	type request struct {
		Action   string   `json:"action"`
		GroupIDs []string `json:"groupIds"`
		Restores []services.SimilarityStatusChange `json:"restores"`
	}
	return func(c *fiber.Ctx) error {
		if service == nil {
			return httputil.Internal(c, "similarity_unavailable", "the similarity service is unavailable")
		}
		var input request
		if err := c.BodyParser(&input); err != nil {
			return httputil.BadRequest(c, "invalid_similarity_request", "request body is not valid JSON")
		}
		if input.Action == services.SimilarityBatchRestore {
			if len(input.Restores) == 0 || len(input.Restores) > maxSelectionBatch {
				return httputil.BadRequest(c, "invalid_similarity_batch", "invalid similarity batch")
			}
			result, err := service.ApplyBatchRestore(input.Restores)
			if err != nil {
				return httputil.BadRequest(c, "invalid_similarity_batch", "the similarity action could not be applied")
			}
			return c.JSON(fiber.Map{
				"ok":        true,
				"changed":   result.Changed,
				"previous":  result.Previous,
				"current":   result.Current,
				"conflicts": result.Conflicts,
			})
		}
		if len(input.GroupIDs) == 0 || len(input.GroupIDs) > maxSelectionBatch {
			return httputil.BadRequest(c, "invalid_similarity_batch", "invalid similarity batch")
		}
		result, err := service.ApplyBatch(input.Action, input.GroupIDs)
		if err != nil {
			if errors.Is(err, services.ErrSimilarityGroupNotFound) {
				return httputil.NotFound(c, "similarity_group_not_found", "the similarity group no longer exists")
			}
			return httputil.BadRequest(c, "invalid_similarity_batch", "the similarity action could not be applied")
		}
		return c.JSON(fiber.Map{
			"ok":        true,
			"changed":   result.Changed,
			"previous":  result.Previous,
			"current":   result.Current,
			"conflicts": result.Conflicts,
		})
	}
}

// writeSimilarityError 把服务层的错误映射成可以公开的错误码。
func writeSimilarityError(c *fiber.Ctx, err error) error {
	if errors.Is(err, services.ErrSimilarityGroupNotFound) {
		return httputil.NotFound(c, "similarity_group_not_found", "the similarity group no longer exists")
	}
	return httputil.BadRequest(c, "invalid_similarity_request", "the similarity request could not be applied")
}
