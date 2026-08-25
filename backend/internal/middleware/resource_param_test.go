package middleware

import (
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
