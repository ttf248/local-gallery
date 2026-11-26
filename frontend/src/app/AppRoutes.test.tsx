import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import AppRoutes from "./AppRoutes";

vi.mock("../shell/AppFrame", () => ({
  default: function Destination() {
    const { pathname, search, hash } = useLocation();
    return <output>{pathname}{search}{hash}</output>;
  },
}));

it.each([
  ["/photo/me", "/photo/me/picks"], ["/comic/me", "/comic/me/favorites"],
  ["/photo/picks", "/photo/me/picks"], ["/photo/favorites", "/photo/me/favorites"],
  ["/photo/recents", "/photo/me/recents"], ["/comic/favorites", "/comic/me/favorites"],
  ["/comic/recents", "/comic/me/recents"], ["/tasks", "/tasks/run"],
  ["/settings", "/settings/interface"],
])("%s 转到 %s 时保留查询串和片段", async (from,to) => {
  render(<MemoryRouter initialEntries={[from + "?q=a%2Bb#item"]}><AppRoutes /></MemoryRouter>);
  expect(await screen.findByRole("status")).toHaveTextContent(to + "?q=a%2Bb#item");
});
