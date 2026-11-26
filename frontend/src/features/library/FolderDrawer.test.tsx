import { act, render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import FolderDrawer, { useFolderDrawer } from "./FolderDrawer";
import { useUIStore } from "../../store/uiStore";

let desktop = true;
vi.mock("../../hooks/useMediaQuery", () => ({
  SPLIT_LAYOUT_QUERY: "(min-width: 1280px)",
  useMediaQuery: () => desktop,
}));

function Example() {
  const drawer = useFolderDrawer();
  return (
    <main className="app-main">
      <button
        ref={drawer.triggerRef}
        aria-controls="library-tree"
        onClick={() => drawer.setOpen(!drawer.open)}
      >
        目录
      </button>
      <FolderDrawer {...drawer} onClose={() => drawer.setOpen(false)}>
        <button type="button">最后一项目录</button>
      </FolderDrawer>
    </main>
  );
}

describe("目录抽屉", () => {
  beforeEach(() => {
    desktop = true;
    useUIStore.getState().setFolderDrawerOpen(false);
  });

  it("默认收起，桌面按钮和快捷键更新持久化偏好", () => {
    render(<Example />);
    expect(screen.queryByRole("complementary")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目录" }));
    expect(
      screen.getByRole("complementary", { name: "目录抽屉" }),
    ).toBeInTheDocument();
    expect(useUIStore.getState().folderDrawerOpen).toBe(true);
    fireEvent.keyDown(window, { key: "\\", metaKey: true });
    expect(screen.queryByRole("complementary")).toBeNull();
    expect(useUIStore.getState().folderDrawerOpen).toBe(false);
  });

  it("从版本 1 迁移时保留浏览偏好，目录抽屉从收起开始", async () => {
    localStorage.setItem(
      "local-gallery-ui",
      JSON.stringify({
        version: 1,
        state: {
          sidebarCollapsed: true,
          theme: "dark",
          viewMode: "list",
          showPersonFaceBoxes: true,
        },
      }),
    );
    await act(async () => {
      await useUIStore.persist.rehydrate();
    });
    expect(useUIStore.getState()).toMatchObject({
      sidebar: "collapsed",
      theme: "dark",
      viewMode: "list",
      folderDrawerOpen: false,
    });
    act(() => useUIStore.getState().setCommandPaletteOpen(true));
    expect(
      JSON.parse(localStorage.getItem("local-gallery-ui") ?? "{}").state,
    ).not.toHaveProperty("commandPaletteOpen");
    act(() => useUIStore.getState().setCommandPaletteOpen(false));
  });

  it("手机不沿用桌面展开偏好，隔离背景并在 Esc 后恢复焦点", () => {
    desktop = false;
    useUIStore.getState().setFolderDrawerOpen(true);
    render(<Example />);
    const trigger = screen.getByRole("button", { name: "目录" });
    expect(screen.queryByRole("dialog")).toBeNull();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: "\\", ctrlKey: true });
    expect(screen.getByRole("main").closest("[inert]")).toBeTruthy();
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    const close = screen.getByRole("button", { name: "关闭目录抽屉" });
    const last = screen.getByRole("button", { name: "最后一项目录" });
    for (const button of [close, last])
      vi.spyOn(button, "offsetWidth", "get").mockReturnValue(44);
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(last, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("main").closest("[inert]")).toBeNull();
    expect(trigger).toHaveFocus();
    expect(useUIStore.getState().folderDrawerOpen).toBe(true);
  });
});
