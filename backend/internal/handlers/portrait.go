package handlers

import (
	"github.com/gofiber/fiber/v2"
	"github.com/tianlongxiang/local-gallery/internal/middleware"
	"github.com/tianlongxiang/local-gallery/internal/services"
	"strconv"
)

func PortraitImage(people *services.PeopleService, thumbs *services.ThumbnailService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		idx, err := strconv.Atoi(c.Params("index"))
		size := c.Query("w", "160")
		if err != nil || (size != "160" && size != "320") {
			return c.SendStatus(400)
		}
		f, ok := people.PortraitSource(c.Params("person"), middleware.ResourceID(c), idx)
		if !ok {
			return c.SendStatus(404)
		}
		w, _ := strconv.Atoi(size)
		b, err := thumbs.Portrait(middleware.SafePath(c), f, w)
		if err != nil {
			return c.SendStatus(404)
		}
		c.Set("Cache-Control", "private, no-cache")
		c.Type("jpg")
		return c.Send(b)
	}
}
func PortraitChoices(people *services.PeopleService) fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Params("id")
		if c.Method() == "GET" {
			limit, offset, err := parsePeoplePage(c)
			if err != nil || limit == 0 {
				return err
			}
			choices := people.PortraitOptions(id)
			start := min(offset, len(choices))
			end := min(start+limit, len(choices))
			return c.JSON(fiber.Map{"choices": choices[start:end], "nextOffset": end, "hasMore": end < len(choices)})
		}
		var body struct {
			Key *string `json:"key"`
		}
		if c.BodyParser(&body) != nil || body.Key == nil {
			return c.SendStatus(400)
		}
		if err := people.SetPortrait(id, *body.Key); err != nil {
			return personChangeError(c, err)
		}
		return c.JSON(fiber.Map{"ok": true})
	}
}
