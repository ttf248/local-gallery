package middleware

import (
	"net/http/httptest"
	"testing"

	"github.com/gofiber/fiber/v2"
)

func TestLoopbackOnly(t *testing.T) {
	app := fiber.New()
	app.Get("/admin", LoopbackOnly(), func(c *fiber.Ctx) error { return c.SendStatus(204) })
	req := httptest.NewRequest("GET", "http://127.0.0.1/admin", nil)
	res, err := app.Test(req)
	if err != nil {
		t.Fatal(err)
	}
	if res.StatusCode != fiber.StatusNoContent {
		t.Fatalf("status=%d", res.StatusCode)
	}
}

func TestIsLocalIPRejectsRemoteAddress(t *testing.T) {
	if isLocalIP([]byte{203, 0, 113, 5}) {
		t.Fatal("remote address should be rejected")
	}
}
