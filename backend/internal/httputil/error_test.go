package httputil

import (
	"encoding/json"
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestErrorUsesCurrentFlatSchema(t *testing.T) {
	app := fiber.New()
	app.Get("/", func(c *fiber.Ctx) error {
		return Error(c, fiber.StatusBadRequest, "invalid_request", "request is invalid", fiber.Map{"field": "name"})
	})

	resp, err := app.Test(httptest.NewRequest("GET", "/", nil))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != fiber.StatusBadRequest {
		t.Fatalf("status=%d, want %d", resp.StatusCode, fiber.StatusBadRequest)
	}
	var body map[string]json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		t.Fatal(err)
	}
	if _, exists := body["error"]; exists {
		t.Fatalf("legacy error alias must not be emitted: %s", body["error"])
	}
	for _, key := range []string{"code", "message", "details"} {
		if _, exists := body[key]; !exists {
			t.Errorf("missing %s in response: %#v", key, body)
		}
	}
}
