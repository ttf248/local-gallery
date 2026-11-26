import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import MediaTile from "./MediaTile";
it("精选按钮独立聚焦，勾选状态可读取且视频标记常驻", () => {
  const onOpen = vi.fn(),
    onPick = vi.fn(),
    onSelect = vi.fn();
  const props = {
    item: {
      id: "f_1",
      index: 0,
      kindIndex: 0,
      name: "照片",
      kind: "image" as const,
    },
    width: 160,
    height: 100,
    selected: false,
    selecting: false,
    picked: false,
    onOpen,
    onPick,
    onSelect,
    onVideoFocus: vi.fn(),
  };
  const expand = vi.fn();
  const { rerender } = render(
    <MediaTile
      {...props}
      action={<button onClick={expand}>展开相似组</button>}
    />,
  );
  const action = screen.getByRole("button", { name: "展开相似组" });
  expect(action.parentElement).toBe(screen.getByTestId("media-tile"));
  fireEvent.click(action);
  expect(expand).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  const pick = screen.getByRole("button", { name: /加入精选/ });
  pick.focus();
  expect(pick).toHaveFocus();
  fireEvent.click(pick);
  expect(onPick).toHaveBeenCalledOnce();
  expect(onOpen).not.toHaveBeenCalled();
  rerender(
    <MediaTile
      {...props}
      selecting
      selected
      item={{ ...props.item, kind: "video" }}
      duration="0:45"
    />,
  );
  expect(screen.getByRole("gridcell")).toHaveAttribute("aria-selected", "true");
  expect(screen.getByText("0:45")).toBeVisible();
  fireEvent.click(screen.getByRole("checkbox"), { shiftKey: true });
  expect(onSelect).toHaveBeenCalledWith(true);
});
