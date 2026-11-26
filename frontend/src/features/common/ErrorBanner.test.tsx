import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ErrorBanner from "./ErrorBanner";

describe("ErrorBanner", () => {
  it("说清楚是什么坏了，并且是读屏器能听见的一条提示", () => {
    render(<ErrorBanner>收藏加载失败。</ErrorBanner>);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("收藏加载失败。");
  });

  it("没有重试手柄时不摆那个按钮", () => {
    render(<ErrorBanner>本机存储信息读取失败。</ErrorBanner>);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("给了手柄就能重试", () => {
    const onRetry = vi.fn();
    render(
      <ErrorBanner onRetry={onRetry}>
        足迹数据加载失败。
      </ErrorBanner>,
    );
    fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("重试中禁用按钮并换一句话", () => {
    render(
      <ErrorBanner onRetry={vi.fn()} retrying>
        足迹数据加载失败。
      </ErrorBanner>,
    );
    const button = screen.getByRole("button", { name: "正在重试…" });
    expect(button).toBeDisabled();
  });

  it("重试按钮的措辞可以换", () => {
    render(
      <ErrorBanner onRetry={vi.fn()} retryLabel="重新加载">
        足迹数据加载失败。
      </ErrorBanner>,
    );
    expect(screen.getByRole("button", { name: "重新加载" })).toBeTruthy();
  });

  it("重试手柄按控件的高度算，不是一行小字", () => {
    render(<ErrorBanner onRetry={vi.fn()}>足迹数据加载失败。</ErrorBanner>);
    // .btn-text 给它 28px 的高度（触摸档 44px）：它看着像一段文本，
    // 但它是能点的控件，命中区得按控件算。
    expect(screen.getByRole("button", { name: "重试加载" }).className).toContain(
      "min-h-8",
    );
  });

  it("还能用但有一件没成时用另一种语气", () => {
    const { container } = render(
      <ErrorBanner kind="warning">后续照片加载失败。</ErrorBanner>,
    );
    expect(container.querySelector('[role="alert"]')?.className).toContain(
      "warning",
    );
  });
});
