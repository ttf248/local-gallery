package handlers

import (
	"encoding/json"
	"errors"
	"strings"

	"github.com/gofiber/fiber/v2"

	"github.com/tianlongxiang/local-gallery/internal/services"
)

// 人物标注接口只在本机开放。
//
// 标注会导出包含本地文件路径的评测集，因此整组接口都挂在回环门禁后面，
// 与目录管理、状态导出这些本机管理接口同级。

// PeopleAnnotationSamplesHandler 返回待标注的样本清单。
func PeopleAnnotationSamplesHandler(
	annotations *services.PeopleAnnotationService,
	people *services.PeopleService,
	catalog *services.ResourceCatalog,
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := services.PeopleAnnotationSampleLimit
		if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
			parsed, err := parsePositiveInt(raw)
			if err != nil || parsed > services.PeopleAnnotationSampleLimit {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_limit", "limit must be a positive integer within the sample limit")
			}
			limit = parsed
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return c.JSON(fiber.Map{
				"ok": true, "items": []services.PeopleAnnotationSample{},
				"progress": services.PeopleAnnotationProgress{},
			})
		}
		items, err := annotations.Samples(people, snapshot.IsPhotoImage, limit, c.Query("refresh") == "true")
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, "people_annotation_failed", "annotation samples could not be prepared")
		}
		return c.JSON(fiber.Map{
			"ok": true, "items": items, "progress": annotations.Progress(),
			"scenarioTags": services.PeopleAnnotationScenarioTags,
			"revision":     snapshot.Revision(),
		})
	}
}

// PeopleAnnotationPhotoHandler 返回一张照片的检出人脸与已有标注。
func PeopleAnnotationPhotoHandler(
	annotations *services.PeopleAnnotationService,
	people *services.PeopleService,
	catalog *services.ResourceCatalog,
	dimensions *services.MediaDimensionService,
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return writeError(c, fiber.StatusServiceUnavailable, "library_not_ready", "library is not ready")
		}
		resourceID := c.Params("resourceId")
		if _, exists := snapshot.Lookup(resourceID); !exists {
			return writeError(c, fiber.StatusNotFound, "resource_not_found", "photo was not found")
		}
		var lookup func(string) services.MediaDimensions
		if dimensions != nil {
			lookup = func(resourceID string) services.MediaDimensions {
				ref, exists := snapshot.Lookup(resourceID)
				if !exists {
					return services.MediaDimensions{}
				}
				return dimensions.Dimensions(ref.AbsolutePath)
			}
		}
		detail, _ := annotations.Photo(people, resourceID, lookup)
		return c.JSON(fiber.Map{"ok": true, "photo": detail, "revision": snapshot.Revision()})
	}
}

// PeopleAnnotationSaveHandler 保存一张照片的标注。
func PeopleAnnotationSaveHandler(annotations *services.PeopleAnnotationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body services.PeopleAnnotationSave
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_people_annotation", "annotation body is invalid")
		}
		if err := annotations.SavePhoto(body); err != nil {
			if errors.Is(err, services.ErrInvalidAnnotation) {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_annotation", "annotation is invalid")
			}
			return writeError(c, fiber.StatusInternalServerError, "people_annotation_failed", "annotation could not be saved")
		}
		return c.JSON(fiber.Map{"ok": true, "progress": annotations.Progress()})
	}
}

// PeopleAnnotationIdentitiesHandler 列出或新建匿名身份。
func PeopleAnnotationIdentitiesHandler(annotations *services.PeopleAnnotationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Method() == fiber.MethodPost {
			var body struct {
				Label string `json:"label"`
			}
			if err := c.BodyParser(&body); err != nil {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_annotation", "identity body is invalid")
			}
			identity, err := annotations.CreateIdentity(body.Label)
			if err != nil {
				if errors.Is(err, services.ErrInvalidAnnotation) {
					return writeError(c, fiber.StatusBadRequest, "invalid_people_annotation", "identity label is invalid")
				}
				return writeError(c, fiber.StatusInternalServerError, "people_annotation_failed", "identity could not be created")
			}
			return c.JSON(fiber.Map{"ok": true, "identity": identity})
		}
		return c.JSON(fiber.Map{"ok": true, "items": annotations.Identities()})
	}
}

// PeopleAnnotationDatasetHandler 导出本机评测集。
//
// 导出文件带本地绝对路径，供 evaluate_people.py 直接读取；因此这个接口
// 与其它本机管理接口一样只允许回环访问。
func PeopleAnnotationDatasetHandler(
	annotations *services.PeopleAnnotationService,
	catalog *services.ResourceCatalog,
	validatePath func(string) (string, error),
) fiber.Handler {
	return func(c *fiber.Ctx) error {
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return writeError(c, fiber.StatusServiceUnavailable, "library_not_ready", "library is not ready")
		}
		dataset, err := annotations.Dataset(func(resourceID string) (string, bool) {
			ref, exists := snapshot.Lookup(resourceID)
			if !exists {
				return "", false
			}
			validated, validateErr := validatePath(ref.AbsolutePath)
			if validateErr != nil {
				return "", false
			}
			return validated, true
		})
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, "people_annotation_failed", "dataset could not be prepared")
		}
		if len(dataset.Photos) == 0 {
			return writeError(c, fiber.StatusBadRequest, "people_annotation_empty", "no annotated photo is available yet")
		}
		encoded, err := json.MarshalIndent(dataset, "", "  ")
		if err != nil {
			return writeError(c, fiber.StatusInternalServerError, "people_annotation_failed", "dataset could not be encoded")
		}
		c.Set(fiber.HeaderCacheControl, "no-store")
		c.Set(fiber.HeaderContentDisposition, `attachment; filename="people-annotations.json"`)
		c.Set(fiber.HeaderContentType, "application/json; charset=utf-8")
		return c.Send(encoded)
	}
}

func parsePositiveInt(raw string) (int, error) {
	value := 0
	for _, char := range raw {
		if char < '0' || char > '9' {
			return 0, errors.New("not a number")
		}
		value = value*10 + int(char-'0')
		if value > 1_000_000 {
			return 0, errors.New("too large")
		}
	}
	if value < 1 {
		return 0, errors.New("not positive")
	}
	return value, nil
}

// PeopleAnnotationProgressHandler 返回标注进度。
func PeopleAnnotationProgressHandler(annotations *services.PeopleAnnotationService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{"ok": true, "progress": annotations.Progress()})
	}
}
