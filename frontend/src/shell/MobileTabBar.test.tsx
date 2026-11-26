import { MemoryRouter } from "react-router-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi, it, expect } from "vitest";
import { MobileTabBar } from "./MobileTabBar";
let hidden = "";
vi.mock("../hooks/useAppMode", () => ({
  useAppMode: () => ({ mode: "photo" }),
}));
vi.mock("../hooks/useNavVisibility", () => ({
  useNavVisibility: () => ({ isVisible: (key: string) => key !== hidden }),
}));
it("四个底栏入口与更多，隐藏项后自然缩减，沉浸时移除", () => {
  const more = vi.fn(),
    view = (immersive: boolean) => (
      <MemoryRouter initialEntries={["/photo"]}>
        <MobileTabBar onMore={more} immersive={immersive} />
      </MemoryRouter>
    );
  const { rerender } = render(view(false));
  expect(screen.getAllByRole("link")).toHaveLength(4);
  expect(screen.getByRole("link", { name: "照片" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "更多" }));
  expect(more).toHaveBeenCalledOnce();
  hidden = "photo.library";
  rerender(view(false));
  expect(screen.getAllByRole("link")).toHaveLength(3);
  rerender(view(true));
  expect(screen.queryByRole("navigation")).toBeNull();
});
