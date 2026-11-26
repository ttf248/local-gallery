import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageHero } from "./PageHero";

it("可编辑标题仍然保留唯一的一级标题", () => {
  const { rerender } = render(<PageHero title="照片" meta="12 张" />);
  expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("照片");
  rerender(<PageHero title="人物" titleEditor={<input aria-label="名称" />} />);
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("textbox", { name: "名称" })).toBeVisible();
});
