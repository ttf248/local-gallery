import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GalleryToolbar from "./GalleryToolbar";
import { useGalleryStore } from "../../store/galleryStore";

function renderToolbar(
  props: Partial<Parameters<typeof GalleryToolbar>[0]> = {},
) {
  const onPrev = vi.fn();
  const onNext = vi.fn();
  const utils = render(
    <GalleryToolbar onPrev={onPrev} onNext={onNext} {...props} />,
  );
  return { onPrev, onNext, ...utils };
}

describe("GalleryToolbar 阅读控制", () => {
  it("是一个有中文可访问名的工具条", () => {
    renderToolbar();
    expect(
      screen.getByRole("toolbar", { name: "阅读控制" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "上一页" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "下一页" })).toBeInTheDocument();
  });

  it("可以直接切换阅读模式", () => {
    useGalleryStore.setState({ mode: "single" });
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "连续" }));
    expect(useGalleryStore.getState().mode).toBe("continuous");
    fireEvent.click(screen.getByRole("button", { name: "双页" }));
    expect(useGalleryStore.getState().mode).toBe("double");
  });

  it("当前模式的那一档用漫画暖棕标出", () => {
    useGalleryStore.setState({ mode: "double" });
    renderToolbar();
    const active = screen.getByRole("button", { name: "双页" });
    expect(active).toHaveAttribute("aria-pressed", "true");
    // 选中态走阅读器自己的暖棕类：深色画布上一眼能认出「现在是哪一档」。
    expect(active.className).toContain("reader-tool-active");
    expect(
      screen.getByRole("button", { name: "单页" }).className,
    ).not.toContain("reader-tool-active");
  });

  it("适配按钮按 整页→按宽→按高→原始 循环", () => {
    useGalleryStore.setState({ fit: "fit" });
    renderToolbar();
    const fit = screen.getByRole("button", { name: "适配方式：整页" });
    fireEvent.click(fit);
    expect(useGalleryStore.getState().fit).toBe("width");
    expect(
      screen.getByRole("button", { name: "适配方式：按宽" }),
    ).toBeInTheDocument();
  });

  it("缩放与旋转直接作用于当前图片", () => {
    useGalleryStore.setState({ zoom: 1, rotation: 0 });
    renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "放大" }));
    expect(useGalleryStore.getState().zoom).toBeGreaterThan(1);
    fireEvent.click(screen.getByRole("button", { name: "缩小" }));
    expect(useGalleryStore.getState().zoom).toBeCloseTo(1, 5);
    fireEvent.click(screen.getByRole("button", { name: /旋转 90 度/ }));
    expect(useGalleryStore.getState().rotation).toBe(90);
  });

  it("首尾位置禁用翻页按钮", () => {
    const { onNext } = renderToolbar({ atStart: true, atEnd: false });
    expect(screen.getByRole("button", { name: "上一页" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "下一页" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onNext).toHaveBeenCalled();
  });

  it("卷末能跨卷时前进按钮标明下一卷", () => {
    const { onNext } = renderToolbar({ nextVolume: true });
    fireEvent.click(screen.getByRole("button", { name: "下一卷" }));
    expect(onNext).toHaveBeenCalledOnce();
  });
  it("窄屏设置入口与当前倍率复位都可操作", () => {
    const onSettings = vi.fn();
    renderToolbar({ onSettings });
    fireEvent.click(screen.getByRole("button", { name: "设置" }));
    expect(onSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: /重置当前倍率/ }));
    expect(useGalleryStore.getState().zoom).toBe(1);
  });
  it("翻页按钮把事件交给父组件", () => {
    const { onPrev, onNext } = renderToolbar();
    fireEvent.click(screen.getByRole("button", { name: "上一页" }));
    fireEvent.click(screen.getByRole("button", { name: "下一页" }));
    expect(onPrev).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1);
  });
});
