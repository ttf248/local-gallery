import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { Card } from "./Card";
import { MemoryRouter } from "react-router-dom";
it("封面链接与收藏分开聚焦，选择模式支持范围操作", () => {
  const select = vi.fn();
  const props = {
    title: "相册",
    media: <img alt="封面" />,
    overlay: <button>收藏</button>,
    stacked: true,
  };
  const { rerender, container } = render(
    <MemoryRouter>
      <Card {...props} to="/photo" />
    </MemoryRouter>,
  );
  expect(screen.getByRole("link", { name: "相册" })).toHaveAttribute(
    "href",
    "/photo",
  );
  expect(screen.getByRole("button", { name: "收藏" }).closest("a")).toBeNull();
  expect(container.querySelector("[data-stacked]")).not.toBeNull();
  rerender(<Card {...props} selecting selected onSelect={select} />);
  const option = screen.getByRole("option", { name: "相册" });
  expect(option).toHaveAttribute("aria-selected", "true");
  fireEvent.click(option, { shiftKey: true });
  expect(select).toHaveBeenCalledWith(true);
});
