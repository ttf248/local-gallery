package handlers

import (
	"errors"
	"sort"
	"strconv"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

type personMediaPage struct {
	Revision   uint64                   `json:"revision"`
	Person     services.PersonGroup     `json:"person"`
	Items      []services.FeedMediaItem `json:"items"`
	Faces      []services.PersonFace    `json:"faces"`
	Total      int                      `json:"total"`
	NextCursor string                   `json:"nextCursor,omitempty"`
}

const peopleListLimit = 50
const peopleSearchLimit = 20
const peopleSortPhotos = "photos"
const peopleSortReview = "review"
const peopleListGroupPhotoFaceThreshold = 20

type peopleGroupPhotoCandidate struct {
	Person services.PersonGroup           `json:"person"`
	Stats  services.PersonGroupPhotoStats `json:"stats"`
}

func PeopleGroupPhotoCandidatesHandler(people *services.PeopleService, catalog *services.ResourceCatalog) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, offset, err := parsePeoplePage(c)
		if err != nil {
			return err
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return c.JSON(fiber.Map{
				"ok": true, "items": []peopleGroupPhotoCandidate{}, "total": 0,
				"offset": offset, "nextOffset": offset, "hasMore": false,
				"revision": snapshot.Revision(),
			})
		}
		includeHidden := c.Query("includeHidden") == "true"
		// 分两步：先算出合影分类挑出候选，再只给候选算人脸相对尺寸。
		// 相对尺寸要查原图尺寸（落盘校验路径），对全部分组都算一遍就是一秒多。
		classes := people.GroupPhotoClassifications(snapshot.IsPhotoImage, peopleListGroupPhotoFaceThreshold)
		groups, _ := people.TopGroups(0, includeHidden, snapshot.IsPhotoImage)
		candidateIDs := make(map[string]struct{})
		candidateGroups := make([]services.PersonGroup, 0)
		for _, group := range groups {
			groupClasses := classes[group.ID]
			if group.Confirmed || groupClasses.PhotoCount == 0 || groupClasses.LargeGroupPhotoCount != groupClasses.PhotoCount {
				continue
			}
			candidateIDs[group.ID] = struct{}{}
			candidateGroups = append(candidateGroups, group)
		}
		stats := people.GroupPhotoStatsForGroups(snapshot.IsPhotoImage, peopleListGroupPhotoFaceThreshold, candidateIDs)
		candidates := make([]peopleGroupPhotoCandidate, 0, len(candidateGroups))
		for _, group := range candidateGroups {
			candidates = append(candidates, peopleGroupPhotoCandidate{Person: group, Stats: stats[group.ID]})
		}
		sort.Slice(candidates, func(i, j int) bool {
			left, right := candidates[i], candidates[j]
			if left.Stats.PhotoCount != right.Stats.PhotoCount {
				return left.Stats.PhotoCount > right.Stats.PhotoCount
			}
			if left.Person.FaceCount != right.Person.FaceCount {
				return left.Person.FaceCount > right.Person.FaceCount
			}
			if left.Stats.RelativeFaceSizeP10 != right.Stats.RelativeFaceSizeP10 {
				return left.Stats.RelativeFaceSizeP10 > right.Stats.RelativeFaceSizeP10
			}
			if left.Stats.DetectionP10 != right.Stats.DetectionP10 {
				return left.Stats.DetectionP10 > right.Stats.DetectionP10
			}
			return left.Person.ID < right.Person.ID
		})
		end := min(offset+limit, len(candidates))
		items := []peopleGroupPhotoCandidate{}
		if offset < len(candidates) {
			items = candidates[offset:end]
		}
		return c.JSON(fiber.Map{
			"ok": true, "items": items, "total": len(candidates),
			"offset": offset, "nextOffset": end, "hasMore": end < len(candidates),
			"faceCountThreshold":        peopleListGroupPhotoFaceThreshold,
			"minimumFaceCount":          services.PeopleGroupPhotoMinimumFaces,
			"relativeFaceSizeThreshold": services.PeopleGroupPhotoRelativeFaceSizeThreshold,
			"revision":                  snapshot.Revision(),
		})
	}
}

func parsePeoplePage(c *fiber.Ctx) (int, int, error) {
	limit := 20
	if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
		parsed, err := strconv.Atoi(rawLimit)
		if err != nil || parsed < 1 || parsed > 50 {
			return 0, 0, writeError(c, fiber.StatusBadRequest, "invalid_people_limit", "limit must be between 1 and 50")
		}
		limit = parsed
	}
	offset := 0
	if rawOffset := strings.TrimSpace(c.Query("offset")); rawOffset != "" {
		parsed, err := strconv.Atoi(rawOffset)
		if err != nil || parsed < 0 || parsed > 1_000_000 {
			return 0, 0, writeError(c, fiber.StatusBadRequest, "invalid_people_offset", "offset must be a non-negative integer")
		}
		offset = parsed
	}
	return limit, offset, nil
}

func PeopleMatchSuggestionsHandler(people *services.PeopleService, catalog *services.ResourceCatalog) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit := 20
		if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
			parsed, err := strconv.Atoi(rawLimit)
			if err != nil || parsed < 1 || parsed > 50 {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_limit", "limit must be between 1 and 50")
			}
			limit = parsed
		}
		offset := 0
		if rawOffset := strings.TrimSpace(c.Query("offset")); rawOffset != "" {
			parsed, err := strconv.Atoi(rawOffset)
			if err != nil || parsed < 0 || parsed > 1_000_000 {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_offset", "offset must be a non-negative integer")
			}
			offset = parsed
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return c.JSON(fiber.Map{
				"ok": true, "items": []services.PersonMatchSuggestion{}, "totalSources": 0,
				"offset": offset, "nextOffset": offset, "checkedSources": 0, "hasMore": false,
				"revision": snapshot.Revision(),
			})
		}
		includeHidden := c.Query("includeHidden") == "true"
		// 匹配建议只要知道哪些分组只出现在合照里，不需要人脸相对尺寸的分位数：
		// 那一档要落盘查原图尺寸，几千张脸就是一秒多。
		photoClasses := people.GroupPhotoClassifications(snapshot.IsPhotoImage, peopleListGroupPhotoFaceThreshold)
		groupPhotoOnly := make(map[string]bool)
		for id, classes := range photoClasses {
			if classes.PhotoCount > 0 && classes.LargeGroupPhotoCount == classes.PhotoCount {
				groupPhotoOnly[id] = true
			}
		}
		page := people.MatchSuggestionsExcluding(offset, limit, includeHidden, snapshot.IsPhotoImage, groupPhotoOnly)
		return c.JSON(fiber.Map{
			"ok": true, "items": page.Items, "totalSources": page.TotalSources,
			"offset": page.Offset, "nextOffset": page.NextOffset,
			"checkedSources": page.CheckedSources, "hasMore": page.HasMore,
			"revision": snapshot.Revision(),
		})
	}
}

func PeopleMatchExclusionHandler(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			SourceID string `json:"sourceId"`
			TargetID string `json:"targetId"`
		}
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "sourceId and targetId are required")
		}
		if err := people.ExcludeMatch(body.SourceID, body.TargetID); err != nil {
			return personChangeError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "excluded": true})
	}
}

func PeopleMatchRetentionHandler(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			PersonID string `json:"personId"`
		}
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "personId is required")
		}
		if err := people.RetainGroup(body.PersonID); err != nil {
			return personChangeError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "retained": true})
	}
}

// PeopleHandler lists current photo-only person albums and clears all face-derived data.
func PeopleHandler(people *services.PeopleService, jobs *services.AIJobService, catalog *services.ResourceCatalog, validatePath func(string) (string, error)) fiber.Handler {
	return func(c *fiber.Ctx) error {
		if c.Method() == fiber.MethodDelete {
			if _, err := jobs.SetPeopleEnabled(false); err != nil {
				if errors.Is(err, services.ErrAIJobActive) {
					return writeError(c, fiber.StatusConflict, "analysis_job_active", "stop face analysis before clearing people data")
				}
				return writeError(c, fiber.StatusInternalServerError, "people_clear_failed", "people analysis could not be disabled")
			}
			if err := jobs.ClearModuleRecords(services.AIJobTypeFace); err != nil {
				return writeError(c, fiber.StatusInternalServerError, "people_clear_failed", "face analysis data could not be cleared")
			}
			if err := people.Clear(); err != nil {
				return writeError(c, fiber.StatusInternalServerError, "people_clear_failed", "people corrections could not be cleared")
			}
			return c.JSON(fiber.Map{"ok": true, "cleared": true, "peopleEnabled": false})
		}
		query := strings.TrimSpace(c.Query("q"))
		sortOrder := strings.TrimSpace(c.Query("sort"))
		if sortOrder == "" {
			sortOrder = peopleSortPhotos
		}
		if sortOrder != peopleSortPhotos && sortOrder != peopleSortReview {
			return writeError(c, fiber.StatusBadRequest, "invalid_people_sort", "sort must be photos or review")
		}
		limit := peopleListLimit
		if query != "" {
			if len([]rune(query)) < 2 {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_query", "search with at least two characters")
			}
			limit = peopleSearchLimit
			if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
				parsed, err := strconv.Atoi(rawLimit)
				if err != nil || parsed < 1 || parsed > 50 {
					return writeError(c, fiber.StatusBadRequest, "invalid_people_limit", "limit must be between 1 and 50")
				}
				limit = parsed
			}
		} else if rawLimit := strings.TrimSpace(c.Query("limit")); rawLimit != "" {
			parsed, err := strconv.Atoi(rawLimit)
			if err != nil || parsed < 1 || parsed > peopleListLimit {
				return writeError(c, fiber.StatusBadRequest, "invalid_people_limit", "limit must be between 1 and 50")
			}
			limit = parsed
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		if !snapshot.Ready() {
			return c.JSON(fiber.Map{
				"ok": true, "people": []services.PersonGroup{}, "totalGroups": 0,
				"filteredGroups": 0, "groupPhotoFaceThreshold": peopleListGroupPhotoFaceThreshold,
				"limit": limit, "centroidThreshold": services.PeopleGroupingCentroidThreshold,
				"anchorThreshold": services.PeopleGroupingAnchorThreshold, "sort": sortOrder,
				"revision": snapshot.Revision(),
			})
		}
		includeHidden := c.Query("includeHidden") == "true"
		var groups []services.PersonGroup
		var total int
		response := fiber.Map{
			"ok": true, "limit": limit,
			"centroidThreshold": services.PeopleGroupingCentroidThreshold,
			"anchorThreshold":   services.PeopleGroupingAnchorThreshold, "sort": sortOrder,
			"revision": snapshot.Revision(),
		}
		if query != "" {
			if sortOrder == peopleSortReview {
				groups, total = people.SearchGroupsForReview(query, limit, includeHidden, snapshot.IsPhotoImage)
			} else {
				groups, total = people.SearchGroups(query, limit, includeHidden, snapshot.IsPhotoImage)
			}
			response["people"] = groups
			response["totalGroups"] = total
			return c.JSON(response)
		}

		// 人物列表只要合影分类，不要人脸相对尺寸的分位数：
		// 那一档要落盘查原图尺寸，几千张脸就是一秒多。
		photoClasses := people.GroupPhotoClassifications(snapshot.IsPhotoImage, peopleListGroupPhotoFaceThreshold)
		if sortOrder == peopleSortReview {
			groups, total = people.SearchGroupsForReview(query, len(photoClasses)+1, includeHidden, snapshot.IsPhotoImage)
		} else {
			groups, total = people.TopGroups(0, includeHidden, snapshot.IsPhotoImage)
		}

		visibleGroups := make([]services.PersonGroup, 0, min(limit, len(groups)))
		filteredGroups := 0
		visibleTotal := 0
		for _, group := range groups {
			groupPhotos := photoClasses[group.ID]
			if !group.Confirmed && group.PhotoCount > 0 && groupPhotos.PhotoCount == group.PhotoCount &&
				groupPhotos.LargeGroupPhotoCount == group.PhotoCount {
				filteredGroups++
				continue
			}
			if !group.IsCommon() || !group.Confirmed && groupPhotos.OrdinaryPhotoCount == 0 {
				continue
			}
			visibleTotal++
			if len(visibleGroups) < limit {
				visibleGroups = append(visibleGroups, group)
			}
		}
		if total > len(groups) {
			filteredGroups += total - len(groups)
		}
		response["people"] = visibleGroups
		response["totalGroups"] = visibleTotal
		response["filteredGroups"] = filteredGroups
		response["groupPhotoFaceThreshold"] = peopleListGroupPhotoFaceThreshold
		response["groupPhotoMinimumFaceCount"] = services.PeopleGroupPhotoMinimumFaces
		response["groupPhotoRelativeFaceSizeThreshold"] = services.PeopleGroupPhotoRelativeFaceSizeThreshold
		return c.JSON(response)
	}
}

// PersonMediaHandler returns a paged photo-wall feed for one current person group.
func PersonMediaHandler(people *services.PeopleService, jobs *services.AIJobService, catalog *services.ResourceCatalog, dimensions *services.MediaDimensionService, validatePath func(string) (string, error)) fiber.Handler {
	return func(c *fiber.Ctx) error {
		limit, ok := parseLibraryPageLimit(c)
		if !ok {
			return nil
		}
		snapshot := requestCatalogSnapshot(c, catalog)
		personID := c.Params("id")
		selected, faces, exists := people.GroupAndFaces(personID)
		if !exists {
			return writeError(c, fiber.StatusNotFound, "person_not_found", "person group was not found")
		}
		unique := map[string]struct{}{}
		items := make([]services.FeedMediaItem, 0)
		facesByResource := map[string][]services.PersonFace{}
		for _, face := range faces {
			facesByResource[face.ResourceID] = append(facesByResource[face.ResourceID], face)
			if _, exists := unique[face.ResourceID]; exists {
				continue
			}
			item, exists := services.LookupLibraryFeedItem(snapshot, face.ResourceID)
			if !exists || item.Kind != "image" {
				continue
			}
			album, exists := snapshot.LibraryNode(item.AlbumID)
			if !exists || album.ContentKind != "photo" {
				continue
			}
			unique[face.ResourceID] = struct{}{}
			items = append(items, item)
		}
		sort.Slice(items, func(i, j int) bool {
			if items[i].AlbumID == items[j].AlbumID {
				return items[i].Index < items[j].Index
			}
			return items[i].AlbumID < items[j].AlbumID
		})
		scope := "people:" + personID
		offset := 0
		var err error
		if cursor := c.Query("cursor"); cursor != "" {
			offset, err = services.DecodePageCursor(cursor, snapshot.Revision(), scope)
			if err != nil {
				return writeLibraryPageError(c, err, snapshot.Revision())
			}
		}
		start := min(offset, len(items))
		end := min(start+limit, len(items))
		var next string
		if end < len(items) {
			next, err = services.EncodePageCursor(snapshot.Revision(), scope, end)
			if err != nil {
				return writeError(c, fiber.StatusInternalServerError, "page_cursor_unavailable", "person album page could not be created")
			}
		}
		pageItems := make([]services.FeedMediaItem, 0, end-start)
		pageFaces := make([]services.PersonFace, 0)
		for _, item := range items[start:end] {
			if _, err := currentFaceRecord(jobs, snapshot, item.ID, validatePath); err != nil {
				continue
			}
			pageItems = append(pageItems, item)
			pageFaces = append(pageFaces, facesByResource[item.ID]...)
			if len(pageFaces) >= 500 {
				pageFaces = pageFaces[:500]
				break
			}
		}
		for i := range pageItems {
			enrichMediaDimension(snapshot, &pageItems[i].LibraryMediaItem, dimensions)
		}
		if dimensions != nil {
			dimensions.Flush()
		}
		page := personMediaPage{Revision: snapshot.Revision(), Person: selected, Items: pageItems, Faces: pageFaces, Total: len(items), NextCursor: next}
		return c.JSON(fiber.Map{"ok": true, "page": page})
	}
}

// PersonHandler renames or hides an automatically grouped candidate person.
func PersonHandler(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			Name   *string `json:"name"`
			Hidden *bool   `json:"hidden"`
		}
		if err := c.BodyParser(&body); err != nil || body.Name == nil && body.Hidden == nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "provide a name or hidden value")
		}
		if body.Name != nil {
			if err := people.Rename(c.Params("id"), *body.Name); err != nil {
				return personChangeError(c, err)
			}
		}
		if body.Hidden != nil {
			if err := people.SetHidden(c.Params("id"), *body.Hidden); err != nil {
				return personChangeError(c, err)
			}
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func PeopleMergeHandler(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			SourceID string `json:"sourceId"`
			TargetID string `json:"targetId"`
		}
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "sourceId and targetId are required")
		}
		if err := people.Merge(body.SourceID, body.TargetID); err != nil {
			return personChangeError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}

func PeopleSplitHandler(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		var body struct {
			PersonID string   `json:"personId"`
			FaceKeys []string `json:"faceKeys"`
		}
		if err := c.BodyParser(&body); err != nil {
			return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "personId and faceKeys are required")
		}
		personID, err := people.Split(body.PersonID, body.FaceKeys)
		if err != nil {
			return personChangeError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true, "personId": personID})
	}
}

func personChangeError(c *fiber.Ctx, err error) error {
	if errors.Is(err, services.ErrPersonNotFound) {
		return writeError(c, fiber.StatusNotFound, "person_not_found", "person group was not found")
	}
	if errors.Is(err, services.ErrInvalidPerson) {
		return writeError(c, fiber.StatusBadRequest, "invalid_person_change", "person correction is invalid")
	}
	return writeError(c, fiber.StatusInternalServerError, "person_change_failed", "person correction could not be saved")
}
