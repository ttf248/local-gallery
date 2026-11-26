import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { Button } from "./Button";
it("忙碌和禁用按钮阻止点击并保留变体", () => {
  const click = vi.fn();
  const { rerender } = render(
    <Button loading onClick={click}>
      保存
    </Button>,
  );
  const button = screen.getByRole("button");
  expect(button).toHaveAttribute("aria-busy", "true");
  fireEvent.click(button);
  rerender(
    <Button variant="secondary" disabled onClick={click}>
      保存
    </Button>,
  );
  expect(button).toHaveClass("border-line-strong");
  fireEvent.click(button);
  expect(click).not.toHaveBeenCalled();
});

it("asChild 保留链接与按钮变体", () => {
  render(
    <Button asChild variant="accent">
      <a href="/photo">照片</a>
    </Button>,
  );
  expect(screen.getByRole("link", { name: "照片" })).toHaveClass("bg-accent");
  expect(screen.getByRole("link")).toHaveAttribute("href", "/photo");
});
