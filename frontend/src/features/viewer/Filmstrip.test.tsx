import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import type { LibraryMediaItem } from "../../api/library";
import { Filmstrip } from "./Filmstrip";

const size = vi.hoisted(() => ({ ref: () => {}, width: 390 }));
vi.mock("../../hooks/useElementSize", () => ({ useElementSize: () => size }));

const items: LibraryMediaItem[] = Array.from({ length: 20 }, (_, index) => ({
  id: String(index),
  name: String(index),
  kind: "video",
  index,
  kindIndex: index,
}));

it("按容器宽度给每项保留触摸宽度，翻到末尾仍显示当前项", () => {
  const onChange = vi.fn();
  const { rerender } = render(
    <Filmstrip items={items} index={19} onChange={onChange} />,
  );
  expect(screen.getAllByRole("button")).toHaveLength(6);
  expect(screen.getByRole("button", { name: "跳到第 20 张" })).toHaveAttribute(
    "aria-current",
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "跳到第 19 张" }));
  expect(onChange).toHaveBeenCalledWith(18);
  size.width = 1200;
  rerender(<Filmstrip items={items} index={0} onChange={onChange} />);
  expect(screen.getAllByRole("button")).toHaveLength(9);
  expect(screen.getByRole("button", { name: "跳到第 1 张" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});
