package handlers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/jpeg"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/models"
	"github.com/tianlongxiang/local-gallery/internal/services"
)

type peopleHandlerAnalyzer struct{}

func (peopleHandlerAnalyzer) Type() string    { return services.AIJobTypeFace }
func (peopleHandlerAnalyzer) Version() string { return services.FaceAnalyzerVersion }
func (peopleHandlerAnalyzer) Analyze(context.Context, io.ReadSeeker) (services.AIAnalysisOutput, error) {
	return peopleHandlerOutput(0), nil
}
func (peopleHandlerAnalyzer) AnalyzeBatch(_ context.Context, inputs []services.AIAnalysisInput) ([]services.AIAnalysisOutput, error) {
	outputs := make([]services.AIAnalysisOutput, len(inputs))
	for index, input := range inputs {
		axis := 0
		if strings.HasPrefix(filepath.Base(input.Path), "other") {
			axis = 1
		}
		outputs[index] = peopleHandlerOutput(axis)
	}
	return outputs, nil
}

func peopleHandlerOutput(axis int) services.AIAnalysisOutput {
	return peopleHandlerOutputWithAxes([]int{axis})
}

func peopleHandlerOutputWithAxes(axes []int) services.AIAnalysisOutput {
	type faceOutput struct {
		Box       []float32 `json:"box"`
		Score     float32   `json:"score"`
		Embedding []float32 `json:"embedding"`
	}
	faces := make([]faceOutput, len(axes))
	for index, axis := range axes {
		vector := make([]float32, 128)
		vector[axis] = 1
		faces[index] = faceOutput{
			Box: []float32{0.1, 0.1, 40, 50}, Score: 0.99, Embedding: vector,
		}
	}
	data, _ := json.Marshal(struct {
		Faces []faceOutput `json:"faces"`
	}{Faces: faces})
	return services.AIAnalysisOutput{Status: "faces_found", Data: data, Fields: []string{services.AIFieldFaces}}
}

func TestPeopleHTTPGroupingCorrectionsAndClear(t *testing.T) {
	root := t.TempDir()
	firstAlbumPath := filepath.Join(root, "event-a")
	secondAlbumPath := filepath.Join(root, "event-b")
	for _, albumPath := range []string{firstAlbumPath, secondAlbumPath} {
		if err := os.MkdirAll(albumPath, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	files := []string{
		filepath.Join(firstAlbumPath, "first.jpg"),
		filepath.Join(firstAlbumPath, "first-2.jpg"),
		filepath.Join(firstAlbumPath, "first-3.jpg"),
		filepath.Join(secondAlbumPath, "second.jpg"),
		filepath.Join(secondAlbumPath, "second-2.jpg"),
		filepath.Join(secondAlbumPath, "second-3.jpg"),
		filepath.Join(firstAlbumPath, "other.jpg"),
		filepath.Join(firstAlbumPath, "other-2.jpg"),
		filepath.Join(firstAlbumPath, "other-3.jpg"),
		filepath.Join(secondAlbumPath, "other-copy.jpg"),
		filepath.Join(secondAlbumPath, "other-copy-2.jpg"),
		filepath.Join(secondAlbumPath, "other-copy-3.jpg"),
	}
	var encodedImage bytes.Buffer
	if err := jpeg.Encode(&encodedImage, image.NewRGBA(image.Rect(0, 0, 640, 480)), nil); err != nil {
		t.Fatal(err)
	}
	for _, path := range files {
		if err := os.WriteFile(path, encodedImage.Bytes(), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := services.NewResourceCatalog()
	catalog.Publish(&models.ScanResult{
		Roots: []string{root},
		Albums: []models.Album{
			{
				Type: "album", Name: "人物测试 A", Path: firstAlbumPath, SourceRoot: root,
				ContentKind: string(models.ContentKindPhoto), ImageFiles: []string{files[0], files[1], files[2], files[6], files[7], files[8]}, CoverImage: files[0],
			},
			{
				Type: "album", Name: "人物测试 B", Path: secondAlbumPath, SourceRoot: root,
				ContentKind: string(models.ContentKindPhoto), ImageFiles: []string{files[3], files[4], files[5], files[9], files[10], files[11]}, CoverImage: files[3],
			},
		},
	}, []string{root})
	safety, safetyState := middleware.PathSafetyMiddleware([]string{root}, catalog)
	people, err := services.OpenPeopleService(filepath.Join(t.TempDir(), "state", "people.json"), filepath.Join(t.TempDir(), "derived", "people-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(nil); err != nil {
		t.Fatal(err)
	}
	jobs, err := services.NewAIJobService(services.AIJobServiceOptions{
		StatePath:    filepath.Join(t.TempDir(), "state", "ai_jobs.json"),
		MetadataDir:  filepath.Join(t.TempDir(), "derived", "ai"),
		Catalog:      catalog,
		ValidatePath: safetyState.Validate,
		Analyzers:    []services.AIAnalyzer{services.MetadataAnalyzer{}, peopleHandlerAnalyzer{}},
		OnRecordsCommitted: func(records []services.AIAnalysisRecord) {
			if err := people.ApplyRecords(records); err != nil {
				t.Errorf("apply face records: %v", err)
			}
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	dimensions, err := services.NewMediaDimensionService(filepath.Join(t.TempDir(), "dimensions.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := dimensions.Close(); err != nil {
			t.Errorf("close media dimensions: %v", err)
		}
	})
	if _, err := jobs.SetGPUEnabled(false); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := jobs.Shutdown(ctx); err != nil {
			t.Errorf("AI job shutdown: %v", err)
		}
	})
	if _, err := jobs.SetPeopleEnabled(true); err != nil {
		t.Fatal(err)
	}
	job, _, err := jobs.Start(services.AIJobTypeFace, services.AIJobModeFull)
	if err != nil {
		t.Fatal(err)
	}
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		current, exists := jobs.Get(job.ID)
		if exists && (current.Status == services.AIJobStatusCompleted || current.Status == services.AIJobStatusFailed) {
			if current.Status != services.AIJobStatusCompleted {
				t.Fatalf("face job failed: %+v", current)
			}
			break
		}
		time.Sleep(10 * time.Millisecond)
	}
	if current, _ := jobs.Get(job.ID); current.Status != services.AIJobStatusCompleted {
		t.Fatalf("face job did not complete: %+v", current)
	}

	app := fiber.New()
	api := app.Group("/api")
	api.Use(safety)
	api.Get("/people", PeopleHandler(people, jobs, catalog, safetyState.Validate))
	api.Delete("/people", PeopleHandler(people, jobs, catalog, safetyState.Validate))
	api.Get("/people/:id/media", PersonMediaHandler(people, jobs, catalog, dimensions, safetyState.Validate))
	api.Put("/people/:id", PersonHandler(people))
	api.Post("/people/merge", PeopleMergeHandler(people))
	api.Post("/people/split", PeopleSplitHandler(people))

	list := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people", "")
	var listBody struct {
		People []services.PersonGroup `json:"people"`
	}
	decodePeopleBody(t, list, &listBody)
	if len(listBody.People) != 2 {
		t.Fatalf("people groups = %+v, want two groups", listBody.People)
	}
	var repeated *services.PersonGroup
	for index := range listBody.People {
		if listBody.People[index].FaceCount == 6 {
			repeated = &listBody.People[index]
		}
	}
	if repeated == nil {
		t.Fatalf("similar faces were not grouped: %+v", listBody.People)
	}

	mediaPath := "/api/people/" + repeated.ID + "/media"
	media := peopleHandlerRequest(t, app, fiber.MethodGet, mediaPath, "")
	mediaData, err := io.ReadAll(media.Body)
	media.Body.Close()
	if err != nil {
		t.Fatal(err)
	}
	if media.StatusCode != fiber.StatusOK || strings.Contains(string(mediaData), root) || strings.Contains(string(mediaData), "embedding") {
		t.Fatalf("person media response leaks local data or failed: %s", mediaData)
	}
	var mediaBody struct {
		Page struct {
			Faces []services.PersonFace    `json:"faces"`
			Items []services.FeedMediaItem `json:"items"`
			Total int                      `json:"total"`
		} `json:"page"`
	}
	if err := json.Unmarshal(mediaData, &mediaBody); err != nil {
		t.Fatal(err)
	}
	if mediaBody.Page.Total != 6 || len(mediaBody.Page.Faces) != 6 {
		t.Fatalf("person media page = %+v", mediaBody.Page)
	}
	if len(mediaBody.Page.Items) != 6 || mediaBody.Page.Items[0].Width != 640 || mediaBody.Page.Items[0].Height != 480 {
		t.Fatalf("person media dimensions = %+v, want 640x480", mediaBody.Page.Items)
	}

	nameBody, _ := json.Marshal(map[string]string{"name": "旅行同伴"})
	updated := peopleHandlerRequest(t, app, fiber.MethodPut, "/api/people/"+repeated.ID, string(nameBody))
	if updated.StatusCode != fiber.StatusOK {
		t.Fatalf("rename status = %d", updated.StatusCode)
	}
	updated.Body.Close()

	faceKey := mediaBody.Page.Faces[0].Key
	splitBody, _ := json.Marshal(map[string]any{"personId": repeated.ID, "faceKeys": []string{faceKey}})
	split := peopleHandlerRequest(t, app, fiber.MethodPost, "/api/people/split", string(splitBody))
	var splitResult struct {
		PersonID string `json:"personId"`
	}
	decodePeopleBody(t, split, &splitResult)
	if splitResult.PersonID == "" {
		t.Fatal("split did not return a new person ID")
	}
	mergeBody, _ := json.Marshal(map[string]string{"sourceId": splitResult.PersonID, "targetId": repeated.ID})
	merge := peopleHandlerRequest(t, app, fiber.MethodPost, "/api/people/merge", string(mergeBody))
	if merge.StatusCode != fiber.StatusOK {
		t.Fatalf("merge status = %d", merge.StatusCode)
	}
	merge.Body.Close()

	hideBody, _ := json.Marshal(map[string]bool{"hidden": true})
	hide := peopleHandlerRequest(t, app, fiber.MethodPut, "/api/people/"+repeated.ID, string(hideBody))
	if hide.StatusCode != fiber.StatusOK {
		t.Fatalf("hide status = %d", hide.StatusCode)
	}
	hide.Body.Close()
	visible := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people", "")
	var visibleBody struct {
		People []services.PersonGroup `json:"people"`
	}
	decodePeopleBody(t, visible, &visibleBody)
	if len(visibleBody.People) != 1 {
		t.Fatalf("hidden group remained visible: %+v", visibleBody.People)
	}

	cleared := peopleHandlerRequest(t, app, fiber.MethodDelete, "/api/people", "")
	if cleared.StatusCode != fiber.StatusOK || jobs.PeopleEnabled() || len(jobs.Records(services.AIJobTypeFace)) != 0 || len(people.AllFaces()) != 0 {
		t.Fatalf("clear did not remove face data and opt-in: status=%d enabled=%v records=%d", cleared.StatusCode, jobs.PeopleEnabled(), len(jobs.Records(services.AIJobTypeFace)))
	}
	cleared.Body.Close()
}

func TestPeopleHTTPListReturnsTop50ByPhotoCount(t *testing.T) {
	const groupCount = 70
	const singleFolderGroupCount = 10
	const sparseFolderGroupIndex = 10
	const sameTopLevelFolderGroupIndex = 11
	const lowShareGroupIndex = 30
	root := t.TempDir()
	folderPathsByName := map[string]string{
		"folder-a":         filepath.Join("2015", "event-a"),
		"folder-a-sibling": filepath.Join("2015", "event-b"),
		"folder-b":         filepath.Join("2016", "event-a"),
		"single-folder":    filepath.Join("2015", "single-folder"),
	}
	folderNames := []string{"folder-a", "folder-a-sibling", "folder-b", "single-folder"}
	folderPaths := make(map[string]string, len(folderNames))
	folderFiles := make(map[string][]string, len(folderNames))
	for _, name := range folderNames {
		path := filepath.Join(root, folderPathsByName[name])
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
		folderPaths[name] = path
	}
	catalog := services.NewResourceCatalog()
	filesByGroup := make([][]string, groupCount)
	records := make([]services.AIAnalysisRecord, 0)
	for groupIndex := 0; groupIndex < groupCount; groupIndex++ {
		for photoIndex := 0; photoIndex <= groupIndex; photoIndex++ {
			folderName := "folder-a"
			if groupIndex < singleFolderGroupCount {
				folderName = "single-folder"
			} else if groupIndex == sparseFolderGroupIndex {
				if photoIndex >= groupIndex {
					folderName = "folder-b"
				}
			} else if groupIndex == sameTopLevelFolderGroupIndex {
				if photoIndex >= groupIndex/2+1 {
					folderName = "folder-a-sibling"
				}
			} else if groupIndex == lowShareGroupIndex {
				if photoIndex >= groupIndex-2 {
					folderName = "folder-b"
				}
			} else if photoIndex%2 == 1 {
				folderName = "folder-b"
			}
			path := filepath.Join(folderPaths[folderName], fmt.Sprintf("photo-%02d-%03d.jpg", groupIndex, photoIndex))
			if err := os.WriteFile(path, []byte("temporary test image"), 0o600); err != nil {
				t.Fatal(err)
			}
			filesByGroup[groupIndex] = append(filesByGroup[groupIndex], path)
			folderFiles[folderName] = append(folderFiles[folderName], path)
		}
	}
	albums := make([]models.Album, 0, len(folderNames))
	for _, name := range folderNames {
		albums = append(albums, models.Album{
			Type: "album", Name: name, Path: folderPaths[name], SourceRoot: root,
			ContentKind: string(models.ContentKindPhoto), ImageFiles: folderFiles[name], CoverImage: folderFiles[name][0],
		})
	}
	catalog.Publish(&models.ScanResult{
		Roots:  []string{root},
		Albums: albums,
	}, []string{root})
	for groupIndex, groupFiles := range filesByGroup {
		output := peopleHandlerOutput(groupIndex)
		for _, path := range groupFiles {
			records = append(records, services.AIAnalysisRecord{
				Type: services.AIJobTypeFace, ResourceID: catalog.ExternalID(path, services.ResourceFile),
				Size: 100, MTimeNs: 200, ModuleVersion: services.FaceAnalyzerVersion,
				Status: "faces_found", Data: output.Data, Fields: output.Fields, UpdatedAt: time.Now(),
			})
		}
	}
	people, err := services.OpenPeopleService(filepath.Join(root, "state", "people.json"), filepath.Join(root, "derived", "people-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	safety, _ := middleware.PathSafetyMiddleware([]string{root}, catalog)
	app := fiber.New()
	app.Use(safety)
	app.Get("/api/people", PeopleHandler(people, nil, catalog, nil))

	list := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people", "")
	var listBody struct {
		People                  []services.PersonGroup `json:"people"`
		TotalGroups             int                    `json:"totalGroups"`
		FilteredGroups          int                    `json:"filteredGroups"`
		GroupPhotoFaceThreshold int                    `json:"groupPhotoFaceThreshold"`
		Limit                   int                    `json:"limit"`
		CentroidThreshold       float64                `json:"centroidThreshold"`
		AnchorThreshold         float64                `json:"anchorThreshold"`
		GroupingLimited         *bool                  `json:"groupingLimited"`
		Sort                    string                 `json:"sort"`
	}
	decodePeopleBody(t, list, &listBody)
	if len(listBody.People) != 50 || listBody.TotalGroups != groupCount || listBody.FilteredGroups != 0 ||
		listBody.GroupPhotoFaceThreshold != peopleListGroupPhotoFaceThreshold || listBody.Limit != 50 ||
		listBody.CentroidThreshold != services.PeopleGroupingCentroidThreshold ||
		listBody.AnchorThreshold != services.PeopleGroupingAnchorThreshold || listBody.GroupingLimited != nil || listBody.Sort != peopleSortPhotos {
		t.Fatalf("top people response = %d groups, total %d, filtered %d, limit %d", len(listBody.People), listBody.TotalGroups, listBody.FilteredGroups, listBody.Limit)
	}
	if listBody.People[0].PhotoCount != groupCount || listBody.People[49].PhotoCount != 21 {
		t.Fatalf("returned photo-count range = %d..%d", listBody.People[0].PhotoCount, listBody.People[49].PhotoCount)
	}

	var target services.PersonGroup
	for _, group := range people.Groups(true) {
		if group.PhotoCount == 1 {
			target = group
			break
		}
	}
	if target.ID == "" {
		t.Fatal("could not find a person outside the top 50")
	}
	search := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people?q="+target.ID, "")
	var searchBody struct {
		People []services.PersonGroup `json:"people"`
		Limit  int                    `json:"limit"`
	}
	decodePeopleBody(t, search, &searchBody)
	if len(searchBody.People) != 1 || searchBody.People[0].ID != target.ID || searchBody.Limit != 20 {
		t.Fatalf("bounded search response = %+v; want target %s", searchBody, target.ID)
	}

	review := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people?sort=review", "")
	var reviewBody struct {
		People []services.PersonGroup `json:"people"`
		Sort   string                 `json:"sort"`
	}
	decodePeopleBody(t, review, &reviewBody)
	if len(reviewBody.People) != 50 || reviewBody.Sort != peopleSortReview || reviewBody.People[0].Quality == nil {
		t.Fatalf("review response = %d groups, sort %q", len(reviewBody.People), reviewBody.Sort)
	}
	invalid := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people?sort=unknown", "")
	defer invalid.Body.Close()
	if invalid.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("invalid sort status = %d; want %d", invalid.StatusCode, fiber.StatusBadRequest)
	}
}

func TestPeopleHTTPListFiltersOnlyGroupsFoundExclusivelyInLargeGroupPhotos(t *testing.T) {
	root := t.TempDir()
	photoDir := filepath.Join(root, "photos")
	if err := os.MkdirAll(photoDir, 0o755); err != nil {
		t.Fatal(err)
	}
	paths := []string{
		filepath.Join(photoDir, "large-group.jpg"),
		filepath.Join(photoDir, "ordinary.jpg"),
		filepath.Join(photoDir, "twenty-faces.jpg"),
	}
	for _, path := range paths {
		if err := os.WriteFile(path, []byte("temporary test image"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	catalog := services.NewResourceCatalog()
	catalog.Publish(&models.ScanResult{
		Roots: []string{root},
		Albums: []models.Album{{
			Type: "album", Name: "photos", Path: photoDir, SourceRoot: root,
			ContentKind: string(models.ContentKindPhoto), ImageFiles: paths, CoverImage: paths[0],
		}},
	}, []string{root})
	resourceID := func(path string) string {
		return catalog.ExternalID(path, services.ResourceFile)
	}
	records := []services.AIAnalysisRecord{
		{
			Type: services.AIJobTypeFace, ResourceID: resourceID(paths[0]), Size: 100, MTimeNs: 200,
			ModuleVersion: services.FaceAnalyzerVersion, Status: "faces_found",
			Data: peopleHandlerOutputWithAxes(peopleTestSequence(0, 21)).Data, Fields: []string{services.AIFieldFaces},
		},
		{
			Type: services.AIJobTypeFace, ResourceID: resourceID(paths[1]), Size: 100, MTimeNs: 200,
			ModuleVersion: services.FaceAnalyzerVersion, Status: "faces_found",
			Data: peopleHandlerOutput(0).Data, Fields: []string{services.AIFieldFaces},
		},
		{
			Type: services.AIJobTypeFace, ResourceID: resourceID(paths[2]), Size: 100, MTimeNs: 200,
			ModuleVersion: services.FaceAnalyzerVersion, Status: "faces_found",
			Data: peopleHandlerOutputWithAxes(peopleTestSequence(21, 20)).Data, Fields: []string{services.AIFieldFaces},
		},
	}
	people, err := services.OpenPeopleService(filepath.Join(root, "state", "people.json"), filepath.Join(root, "derived", "people-index.json"))
	if err != nil {
		t.Fatal(err)
	}
	if err := people.Sync(records); err != nil {
		t.Fatal(err)
	}
	safety, _ := middleware.PathSafetyMiddleware([]string{root}, catalog)
	app := fiber.New()
	app.Use(safety)
	app.Get("/api/people", PeopleHandler(people, nil, catalog, nil))

	list := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people", "")
	var listBody struct {
		People                  []services.PersonGroup `json:"people"`
		TotalGroups             int                    `json:"totalGroups"`
		FilteredGroups          int                    `json:"filteredGroups"`
		GroupPhotoFaceThreshold int                    `json:"groupPhotoFaceThreshold"`
	}
	decodePeopleBody(t, list, &listBody)
	if len(listBody.People) != 21 || listBody.TotalGroups != 21 || listBody.FilteredGroups != 20 ||
		listBody.GroupPhotoFaceThreshold != 20 {
		t.Fatalf("large group filtering returned %d people, total %d, filtered %d, threshold %d", len(listBody.People), listBody.TotalGroups, listBody.FilteredGroups, listBody.GroupPhotoFaceThreshold)
	}
	var ordinaryPhotoGroup *services.PersonGroup
	for index := range listBody.People {
		if listBody.People[index].PhotoCount == 2 {
			ordinaryPhotoGroup = &listBody.People[index]
			break
		}
	}
	if ordinaryPhotoGroup == nil {
		t.Fatal("group with an ordinary photo was hidden along with large-group-only candidates")
	}

	var hiddenCandidate services.PersonGroup
	allGroups, _ := people.TopGroups(0, true, nil)
	for _, group := range allGroups {
		if group.PhotoCount == 1 {
			if _, exists := listBodyGroupByID(listBody.People, group.ID); !exists {
				hiddenCandidate = group
				break
			}
		}
	}
	if hiddenCandidate.ID == "" {
		t.Fatal("could not find a candidate that appears only in the 21-face group photo")
	}
	search := peopleHandlerRequest(t, app, fiber.MethodGet, "/api/people?q="+hiddenCandidate.ID, "")
	var searchBody struct {
		People []services.PersonGroup `json:"people"`
	}
	decodePeopleBody(t, search, &searchBody)
	if len(searchBody.People) != 1 || searchBody.People[0].ID != hiddenCandidate.ID {
		t.Fatalf("search did not retain access to hidden candidate %s", hiddenCandidate.ID)
	}
}

func peopleTestSequence(start, count int) []int {
	values := make([]int, count)
	for index := range values {
		values[index] = start + index
	}
	return values
}

func listBodyGroupByID(groups []services.PersonGroup, id string) (services.PersonGroup, bool) {
	for _, group := range groups {
		if group.ID == id {
			return group, true
		}
	}
	return services.PersonGroup{}, false
}

func peopleHandlerRequest(t *testing.T, app *fiber.App, method, path, body string) *http.Response {
	t.Helper()
	request := httptest.NewRequest(method, path, strings.NewReader(body))
	if body != "" {
		request.Header.Set(fiber.HeaderContentType, fiber.MIMEApplicationJSON)
	}
	response, err := app.Test(request, -1)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decodePeopleBody(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if response.StatusCode != fiber.StatusOK {
		data, _ := io.ReadAll(response.Body)
		t.Fatalf("people API status = %d: %s", response.StatusCode, data)
	}
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}
