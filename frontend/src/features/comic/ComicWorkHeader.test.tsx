import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { expect, it, vi } from "vitest";
import ComicWorkHeader from "./ComicWorkHeader";
import type { LibraryNodeSummary } from "../../api/library";
vi.mock("../../hooks/useComicMeta", () => ({
  useComicMeta: () => ({
    data: {
      meta: {
        cleanTitle: "星海",
        fullSynopsis: "一段故事。".repeat(60),
        firstEpisodeId: "a_1",
        firstEpisodeLabel: "第 1 话",
        metaSource: "local_file",
      },
    },
  }),
  useRefreshComicMeta: () => ({}),
}));
vi.mock("../../hooks/useFavorites", () => ({
  useFavorites: () => ({ favorites: [] }),
}));
vi.mock("../../hooks/useLibrary", () => ({
  useMultiRoot: () => false,
  useLibraryDashboard: () => ({ data: { dashboard: { inProgress: [] } } }),
}));
vi.mock("./ComicMetaEditDialog", () => ({
  default: () => <div role="dialog" />,
}));
it("显示作品卷页数、完整简介及首个正篇入口，支持键盘编辑", () => {
  const node = {
    id: "c_1",
    kind: "collection",
    contentKind: "comic",
    albumCount: 4,
    imageCount: 81,
  } as LibraryNodeSummary;
  render(
    <MemoryRouter>
      <ComicWorkHeader node={node} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("heading", { name: "星海" })).toBeVisible();
  expect(screen.getByText("4 卷 · 81 页")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开全文" }));
  expect(screen.getByRole("button", { name: "收起" })).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  expect(
    screen.getByRole("link", { name: "开始阅读 · 第 1 话" }),
  ).toHaveAttribute("href", "/comic/read/a_1");
  fireEvent.click(screen.getByRole("button", {name:"更多"}));
  expect(screen.getByRole("menu")).toBeVisible();
  fireEvent.keyDown(screen.getByRole("menu"), {key:"Escape"});
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "编辑信息" }));
  expect(screen.getByRole("dialog")).toBeVisible();
});
