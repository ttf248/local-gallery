import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ToastViewport from "./Toast";
import { useUIStore } from "../../store/uiStore";

// 恒定深色的沉浸场景（漫画阅读器、照片墙的大图预览）里，沿用应用主题
// 的浅色 toast 会变成"黑底里浮一块白板"，与场景里的其它浮层自相矛盾。
describe("ToastViewport", () => {
  beforeEach(() => {
    useUIStore.setState({ toasts: [] });
  });

  function renderAt(path: string) {
    render(
      <MemoryRouter initialEntries={[path]}>
        <ToastViewport />
      </MemoryRouter>,
    );
    return screen.getByText("测试消息").parentElement as HTMLElement;
  }

  it("普通页面下 toast 使用反色底", () => {
    useUIStore.setState({
      toasts: [{ id: "t1", kind: "info", message: "测试消息", ttl: 0 }],
    });
    const card = renderAt("/");
    expect(card).toHaveClass("bg-inverse-bg");
    expect(card).toHaveAttribute("data-tone", "inverse");
  });

  it("漫画阅读器路由下 toast 走反色底", () => {
    useUIStore.setState({
      toasts: [{ id: "t1", kind: "info", message: "测试消息", ttl: 0 }],
    });
    const card = renderAt("/comic/read/abc");
    expect(card).toHaveClass("bg-inverse-bg");
    expect(card).toHaveAttribute("data-tone", "inverse");
  });

  // 照片墙的大图预览也是深色浮层，路径却不是阅读器 —— 早先按路径前缀
  // 判断时，在预览里弹出的 toast 是一块浅色板。
  it("照片墙的大图预览打开时 toast 也走反色底", () => {
    useUIStore.setState({
      toasts: [{ id: "t1", kind: "info", message: "测试消息", ttl: 0 }],
      immersiveOverlay: true,
    });
    const card = renderAt("/photo/albums/a_1");
    expect(card).toHaveClass("bg-inverse-bg");
    expect(card).toHaveAttribute("data-tone", "inverse");
    useUIStore.setState({ immersiveOverlay: false });
  });

  it("带撤销的提示会给出撤销按钮，执行后淡出", async () => {
    const undone = vi.fn();
    useUIStore.setState({
      toasts: [
        {
          id: "t1",
          kind: "success",
          message: "已把这一组标记为已处理",
          ttl: 0,
          action: { label: "撤销", onClick: undone },
        },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <ToastViewport />
      </MemoryRouter>,
    );
    const undo = screen.getByRole("button", { name: "撤销" });
    fireEvent.click(undo);
    expect(undone).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "撤销" })).toBeNull();
    await waitFor(() =>
      expect(screen.queryByText("已把这一组标记为已处理")).toBeNull(),
    );
  });
});
