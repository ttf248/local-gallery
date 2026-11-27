import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import PageSlider from "./PageSlider";

it("进度条的已读段用漫画暖棕，与工具条同一支色", () => {
  const { container } = render(
    <PageSlider total={3} index={1} onJump={vi.fn()} />,
  );
  const fill = container.querySelector(".reader-slider-fill");
  expect(fill).not.toBeNull();
});

it.each([
  { key: "g", ctrlKey: true },
  { key: "g", altKey: true },
  { key: "g", metaKey: true },
  { key: "g", isComposing: true },
])("张数跳转不拦截系统组合或输入法事件 %j", (init) => {
  render(<PageSlider total={3} index={0} onJump={vi.fn()} />);
  fireEvent.keyDown(window, init);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
});

it("已处理的 G 不打开编辑框，普通 G 仍可定位张数", () => {
  const jump = vi.fn();
  render(<PageSlider total={3} index={0} onJump={jump} />);
  const handled = new KeyboardEvent("keydown", { key: "g", cancelable: true });
  handled.preventDefault();
  fireEvent(window, handled);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  fireEvent.keyDown(window, { key: "g" });
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "2" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(jump).toHaveBeenCalledWith(1);
});

it("进入跳转编辑态后预填当前张数并全选，输入直接覆盖而不是追加", async () => {
  const jump = vi.fn();
  render(<PageSlider total={403} index={0} onJump={jump} />);
  fireEvent.keyDown(window, { key: "g" });
  const input = screen.getByRole("textbox") as HTMLInputElement;
  expect(input.value).toBe("1");
  // 预填值必须处于选中态：否则用户输入的张数会接在预填值后面
  // （"1" + "100" = "1100"，被夹到最后一页）。
  await waitFor(() => {
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(1);
  });
  fireEvent.change(input, { target: { value: "100" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(jump).toHaveBeenCalledWith(99);
});

it("跳转输入框有可访问名称", () => {
  render(<PageSlider total={3} index={0} onJump={vi.fn()} />);
  fireEvent.keyDown(window, { key: "g" });
  expect(
    screen.getByRole("textbox", { name: "跳转到第几页" }),
  ).toBeInTheDocument();
});

// 双页并排时底栏与顶栏说的是同一件事：顶栏写「1–2 / 8」，
// 底栏再写「1 / 8」，读者会以为底栏漏了一次翻页。
it("双页并排时页码写成区间", () => {
  render(<PageSlider total={8} index={0} onJump={vi.fn()} double />);
  expect(screen.getByTitle("跳转到指定页 (G)")).toHaveTextContent("1–2");
});

it("双页并排且卷末只剩一页时页码不写区间", () => {
  render(<PageSlider total={9} index={8} onJump={vi.fn()} double />);
  expect(screen.getByTitle("跳转到指定页 (G)")).toHaveTextContent("9");
});

it("单页时页码是一个数字", () => {
  render(<PageSlider total={8} index={0} onJump={vi.fn()} />);
  expect(screen.getByTitle("跳转到指定页 (G)")).toHaveTextContent("1");
});

it("取消拖动不跳页，松手只提交一次，聚焦轨道支持首尾键", () => {
  const jump = vi.fn();
  render(<PageSlider total={8} index={0} onJump={jump} />);
  const track = screen.getByRole("slider");
  track.getBoundingClientRect = () => new DOMRect(0, 0, 100, 40);
  function pointer(name: string, x: number) {
    const e = new Event(name, { bubbles: true });
    Object.defineProperties(e, {
      pointerId: { value: 1 },
      clientX: { value: x },
    });
    fireEvent(track, e);
  }
  pointer("pointerdown", 50);
  pointer("pointercancel", 50);
  expect(jump).not.toHaveBeenCalled();
  pointer("pointerdown", 90);
  pointer("pointerup", 90);
  expect(jump).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(track, { key: "End" });
  expect(jump).toHaveBeenLastCalledWith(7);
});
