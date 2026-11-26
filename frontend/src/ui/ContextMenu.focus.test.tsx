import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContextMenu } from "./ContextMenu";

describe("ContextMenu", () => {
  it("打开后聚焦第一个可用菜单项，并暴露菜单语义", () => {
    render(
      <ContextMenu
        x={20}
        y={20}
        items={[
          {
            onSelect: vi.fn(),
            id: "disabled",
            label: "不可用",
            disabled: true,
          },
          { onSelect: vi.fn(), id: "open", label: "打开" },
        ]}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("menu", { name: "上下文菜单" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "打开" })).toHaveFocus();
  });

  it("关闭后恢复来源焦点", () => {
    const view = (open: boolean) => (
      <>
        <button type="button">来源</button>
        {open && (
          <ContextMenu
            x={20}
            y={20}
            items={[{ onSelect: vi.fn(), id: "properties", label: "属性" }]}
            onClose={vi.fn()}
          />
        )}
      </>
    );
    const { rerender } = render(view(false));
    const source = screen.getByRole("button", { name: "来源" });
    source.focus();
    rerender(view(true));
    expect(screen.getByRole("menuitem", { name: "属性" })).toHaveFocus();
    rerender(view(false));
    expect(source).toHaveFocus();
  });

  it("忽略打开前已经发生的滚动，在来源下一次滚动时关闭", () => {
    const close = vi.fn();
    const view = (open: boolean) => (
      <main data-testid="scroller">
        <button>相册</button>
        {open && <ContextMenu x={20} y={20} items={[]} onClose={close} />}
      </main>
    );
    const { rerender } = render(view(false));
    const main = screen.getByTestId("scroller");
    main.scrollTop = 32;
    screen.getByRole("button").focus();
    rerender(view(true));
    fireEvent.scroll(main);
    expect(close).not.toHaveBeenCalled();
    main.scrollTop += 24;
    fireEvent.scroll(main);
    expect(close).toHaveBeenCalledOnce();
  });

  it("StrictMode 的假卸载不会抢回焦点，菜单因此不会被自己的 onBlur 关掉", async () => {
    const onClose = vi.fn();
    const view = (open: boolean) => (
      <>
        <button type="button">来源</button>
        {open && (
          <ContextMenu
            x={20}
            y={20}
            items={[{ onSelect: vi.fn(), id: "properties", label: "属性" }]}
            onClose={onClose}
          />
        )}
      </>
    );

    // 复现真实场景：右键卡片（卡片链接已获得焦点）后菜单挂载，
    // React 18 StrictMode 会对菜单做一次"挂载 → 卸载 → 再挂载"。
    const { rerender } = render(<StrictMode>{view(false)}</StrictMode>);
    screen.getByRole("button", { name: "来源" }).focus();
    rerender(<StrictMode>{view(true)}</StrictMode>);

    // 等 StrictMode 的"挂载 → 卸载 → 再挂载"以及推迟的焦点归还跑完。
    await waitFor(() => {
      expect(screen.getByRole("menuitem", { name: "属性" })).toHaveFocus();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("关闭时不抢走已经移到外部的焦点", () => {
    const view = (open: boolean) => (
      <>
        <button type="button">来源</button>
        <input aria-label="外部输入" />
        {open && (
          <ContextMenu
            x={20}
            y={20}
            items={[{ onSelect: vi.fn(), id: "properties", label: "属性" }]}
            onClose={vi.fn()}
          />
        )}
      </>
    );
    const { rerender } = render(view(false));
    screen.getByRole("button", { name: "来源" }).focus();
    rerender(view(true));
    const outside = screen.getByRole("textbox", { name: "外部输入" });
    outside.focus();
    rerender(view(false));
    expect(outside).toHaveFocus();
  });

  it("贴着视口下缘与右缘打开时，菜单整块留在视口里", () => {
    // jsdom 不做布局，实测尺寸恒为 0；这里按真实菜单尺寸打桩，
    // 夹紧逻辑才能被验证。
    const width = vi
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockReturnValue(200);
    const height = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(250);
    Object.defineProperty(window, "innerWidth", {
      value: 1024,
      configurable: true,
    });
    Object.defineProperty(window, "innerHeight", {
      value: 800,
      configurable: true,
    });

    const { unmount } = render(
      <ContextMenu
        x={1000}
        y={700}
        items={[{ onSelect: vi.fn(), id: "properties", label: "属性" }]}
        onClose={vi.fn()}
      />,
    );

    const menu = screen.getByRole("menu");
    // 右缘：1024 - 8 - 200
    expect(parseInt(menu.style.left) + 200).toBeLessThanOrEqual(1024);
    // 下缘：800 - 8 - 250
    expect(parseInt(menu.style.top) + 250).toBeLessThanOrEqual(800);

    unmount();
    width.mockRestore();
    height.mockRestore();
  });
});
