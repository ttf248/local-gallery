import { render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { expect, it, vi } from "vitest";
import AppRoutes from "./AppRoutes";

vi.mock("../shell/AppShell", () => ({
  default: function Destination() {
    const { pathname, search, hash } = useLocation();
    return <output>{pathname}{search}{hash}</output>;
  },
}));

it.each([
  ["/photo/me", "/photo/me/picks"], ["/comic/me", "/comic/me/favorites"],
  ["/photo/picks", "/photo/me/picks"], ["/photo/favorites", "/photo/me/favorites"],
  ["/photo/recents", "/photo/me/recents"], ["/comic/favorites", "/comic/me/favorites"],
  ["/comic/recents", "/comic/me/recents"], ["/tasks", "/settings/tasks"],
  ["/settings", "/settings/general"],
  ["/settings/interface", "/settings/general"],
  ["/settings/reading", "/settings/general"],
  ["/settings/data", "/settings/storage"],
  ["/tasks/run", "/settings/tasks"],
  ["/tasks/plan", "/settings/tasks"],
  ["/tasks/history", "/settings/tasks"],
  ["/tasks/storage", "/settings/storage"],
  ["/tasks/unknown", "/settings/tasks"],
])("%s 转到 %s 时保留查询串和片段", async (from,to) => {
  render(<MemoryRouter initialEntries={[from + "?q=a%2Bb#item"]}><AppRoutes /></MemoryRouter>);
  expect(await screen.findByRole("status")).toHaveTextContent(to + "?q=a%2Bb#item");
});

it.each([
  ["/tasks/history?job=j", "/settings/tasks?job=j#task-history"],
  ["/tasks/plan", "/settings/tasks#daily-plan"],
  ["/settings/reading", "/settings/general#reading"],
])("%s 补齐默认锚点", async (from, to) => {
  render(<MemoryRouter initialEntries={[from]}><AppRoutes /></MemoryRouter>);
  expect(await screen.findByRole("status")).toHaveTextContent(to);
});
