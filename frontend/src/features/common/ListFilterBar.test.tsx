import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { useState } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { ListFilterBar, type ListFilterBarProps } from "./ListFilterBar";
import type { SortKey } from "../../utils/listFilterParams";
import { useAppModeStore } from "../../store/appModeStore";

// 筛选状态在地址里（hooks/useListFilters），这条工具条只负责画出来、
// 改回去：它自己不再存一份，值与回调都由外面给。
function Harness({
  initialSort = "name",
  initialMin = 0,
  ...props
}: Partial<ListFilterBarProps> & {
  initialSort?: SortKey;
  initialMin?: number;
}) {
  const [sort, setSort] = useState<SortKey>(initialSort);
  const [min, setMin] = useState(initialMin);
  return (
    <ListFilterBar
      totalCount={10}
      sort={sort}
      onSortChange={setSort}
      minImageCount={min}
      onMinImageCountChange={setMin}
      {...props}
    />
  );
}

beforeEach(() => {
  useAppModeStore.setState({ preference: "photo" });
});

it("选择排序后恢复按钮焦点并更新排序", () => {
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "排序" });
  trigger.focus();
  fireEvent.click(trigger);
  const option = screen.getByRole("button", { name: "按最近看" });
  option.focus();
  fireEvent.click(option);
  expect(trigger).toHaveTextContent("按最近看");
  expect(trigger).toHaveFocus();
  expect(screen.queryByRole("button", { name: "按最近看" })).toBeNull();
});

it("Esc 取消后恢复按钮焦点并保留原排序", async () => {
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "排序" });
  trigger.focus();
  fireEvent.click(trigger);
  const option = screen.getByRole("button", { name: "按最近看" });
  option.focus();
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  fireEvent.keyDown(option, { key: "Escape" });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveTextContent("按名称");
  expect(screen.queryByRole("button", { name: "按最近看" })).toBeNull();
});

it("离开排序区域时收起选项，保留新目标焦点", () => {
  render(
    <>
      <Harness />
      <button type="button">外部操作</button>
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "排序" }));
  const option = screen.getByRole("button", { name: "按最近看" });
  option.focus();
  const outside = screen.getByRole("button", { name: "外部操作" });
  act(() => outside.focus());
  expect(screen.queryByRole("button", { name: "按最近看" })).toBeNull();
  expect(outside).toHaveFocus();
});

it("点击外部关闭选项且不恢复排序按钮焦点", async () => {
  render(
    <>
      <Harness />
      <input aria-label="外部输入" />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "排序" }));
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
  const outside = screen.getByRole("textbox", { name: "外部输入" });
  fireEvent.mouseDown(outside);
  outside.focus();
  expect(screen.queryByRole("button", { name: "按最近看" })).toBeNull();
  expect(outside).toHaveFocus();
});

it("公开展开状态及当前选中的排序项", () => {
  render(<Harness />);
  const trigger = screen.getByRole("button", { name: "排序" });
  expect(trigger).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(trigger);
  expect(trigger).toHaveAttribute("aria-expanded", "true");
  const options = screen.getByRole("group", { name: "排序选项" });
  expect(trigger).toHaveAttribute("aria-controls", options.id);
  expect(
    within(options).getByRole("button", { name: "按名称", pressed: true }),
  ).toBeInTheDocument();
  // 排序项：按名称 / 按张数 / 按最近改 / 按拍摄时间 / 按最近看。
  expect(
    within(options).getAllByRole("button", { pressed: false }),
  ).toHaveLength(4);
});

it("日期排序项跟着工作台说话：照片侧按拍摄时间，漫画侧按加入时间", () => {
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "排序" }));
  const photo = within(screen.getByRole("group", { name: "排序选项" }));
  expect(photo.getByRole("button", { name: "按拍摄时间" })).toHaveAttribute(
    "title",
    "按拍摄时间排序，没有拍摄时间的相册按文件修改时间",
  );
  expect(photo.queryByRole("button", { name: "按加入时间" })).toBeNull();

  // 换到漫画侧再摆一次：两次渲染各自独立，避免焦点跨实例漂移。
  cleanup();
  useAppModeStore.setState({ preference: "comic" });
  render(<Harness />);
  fireEvent.click(screen.getByRole("button", { name: "排序" }));
  const comic = within(screen.getByRole("group", { name: "排序选项" }));
  expect(comic.getByRole("button", { name: "按加入时间" })).toHaveAttribute(
    "title",
    "按目录日期排序，没有目录日期时按文件修改时间",
  );
  expect(comic.queryByRole("button", { name: "按拍摄时间" })).toBeNull();
});

it("刚展开就卸载时不留下待注册的监听任务", () => {
  vi.useFakeTimers();
  const { unmount } = render(<Harness />);
  try {
    fireEvent.click(screen.getByRole("button", { name: "排序" }));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    unmount();
    vi.useRealTimers();
  }
});

it("未启用时最少页数只留漏斗按钮，点开后才出现输入框", () => {
  render(<Harness />);
  // 0 本来就是「不过滤」，摆一个「≥ 0」在筛选条里读不出任何意思。
  expect(screen.queryByRole("spinbutton")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /最少/ }));
  const input = screen.getByRole("spinbutton");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "12" } });
  fireEvent.blur(input);
  expect(screen.getByRole("spinbutton")).toHaveValue(12);
});

it("启用后显示当前阈值并可一键清除", () => {
  render(<Harness initialMin={8} />);
  expect(screen.getByRole("spinbutton")).toHaveValue(8);
  fireEvent.click(screen.getByRole("button", { name: "清除最小图数" }));
  expect(screen.queryByRole("spinbutton")).toBeNull();
});

it("trailing 槽位的控件排在工具条右端，与排序同排", () => {
  render(
    <Harness trailing={<button type="button">选择</button>} />,
  );
  const bar = screen.getByRole("button", { name: "排序" }).closest(
    ".filter-strip",
  ) as HTMLElement;
  expect(bar).not.toBeNull();
  // 「选择」与排序、视图切换同在一条工具条里，不再单独占一行。
  expect(within(bar).getByRole("button", { name: "选择" })).toBeInTheDocument();
});
