import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import ComicWorkPreview from "./ComicWorkPreview";
import type { CardData } from "../library";
vi.mock("../../hooks/useLibrary", () => ({
  useAlbumMedia: () => ({
    data: {
      pages: [
        {
          items: [1, 2, 3, 4].map((id) => ({
            id: String(id),
            kind: "image",
            name: "页" + id,
          })),
        },
      ],
    },
  }),
}));
const renderPreview = (ui: React.ReactElement) => render(ui, {wrapper: MemoryRouter});
const card: CardData = {
  id: "c:one",
  title: "星海",
  variant: "collection",
  count: 3,
  coverPath: "f_1",
  contentKind: "comic",
  to: "/comic/albums/c_one",
};
it("右侧边缘翻转，展示五行故事并响应 Esc", () => {
  const r = new DOMRect(window.innerWidth - 30, 10, 20, 100);
  renderPreview(
    <ComicWorkPreview
      anchorRect={r}
      data={{
        ...card,
        comic: {
          cleanTitle: "星海",
          metaSource: "rule",
          synopsis: "故事".repeat(150),
        },
      }}
    />,
  );
  const el = screen.getByRole("region");
  expect(parseFloat(el.style.left)).toBeLessThan(r.left);
  expect(screen.getByText("故事".repeat(150))).toHaveClass("line-clamp-4");
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("region")).toBeNull();
});
it("缺少故事时展示卷数，单集仅显示前三页", () => {
  const r = new DOMRect(10, 10, 60, 100);
  const v = renderPreview(<ComicWorkPreview anchorRect={r} data={card} />);
  expect(screen.getByText("暂无故事大纲")).toBeVisible();
  expect(screen.getByText("3 卷")).toBeVisible();
  expect(screen.queryByText(/0 页/)).toBeNull();
  expect(screen.getByRole("link", {name:"查看全卷"})).toHaveAttribute("href",card.to);
  v.rerender(
    <ComicWorkPreview anchorRect={r} data={{ ...card, variant: "album" }} />,
  );
  expect(screen.getAllByRole("img")).toHaveLength(3);
});
