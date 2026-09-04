package middleware

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/gofiber/fiber/v2"
)

type fixedResolver map[string]string

func (r fixedResolver) Resolve(id string) (string, bool) {
	path, ok := r[id]
	return path, ok
}

type snapshotResolver struct {
	path     string
	snapshot any
}

func (r snapshotResolver) Resolve(id string) (string, bool) {
	return r.path, id == "a_valid"
}

func (r snapshotResolver) ResolveWithSnapshot(id string) (string, any, bool) {
	return r.path, r.snapshot, id == "a_valid"
}

func TestResourceParamRevalidatesCurrentRoots(t *testing.T) {
	root := t.TempDir()
	inside := filepath.Join(root, "album", "page.jpg")
	out := filepath.Join(t.TempDir(), "secret.jpg")
	_, state := PathSafetyMiddleware([]string{root})

	app := fiber.New()
	app.Get("/:id", ResourceParam(fixedResolver{"inside": inside, "outside": out}, state), func(c *fiber.Ctx) error {
		return c.SendString(SafePath(c))
	})

	insideResponse, err := app.Test(httptest.NewRequest("GET", "/inside", nil))
	if err != nil || insideResponse.StatusCode != fiber.StatusOK {
		t.Fatalf("inside response=(%v,%v)", insideResponse, err)
	}
	outsideResponse, err := app.Test(httptest.NewRequest("GET", "/outside", nil))
	if err != nil {
		t.Fatal(err)
	}
	if outsideResponse.StatusCode != fiber.StatusNotFound {
		t.Fatalf("outside status=%d", outsideResponse.StatusCode)
	}
}

func TestResourceParamPinsResolverSnapshot(t *testing.T) {
	root := t.TempDir()
	marker := &struct{ revision int }{revision: 7}
	app := fiber.New()
	_, validator := PathSafetyMiddleware([]string{root})
	app.Get("/albums/:id", ResourceParam(snapshotResolver{
		path: filepath.Join(root, "album"), snapshot: marker,
	}, validator), func(c *fiber.Ctx) error {
		if ResourceSnapshot(c) != marker {
			return fiber.ErrInternalServerError
		}
		return c.SendStatus(fiber.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodGet, "/albums/a_valid", nil)
	resp, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if resp.StatusCode != fiber.StatusNoContent {
		t.Fatalf("status=%d", resp.StatusCode)
	}
}
