import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import PageOverview from "./PageOverview";

// Virtuoso 在 jsdom 里量不出高度，网格不会渲染；这里把它摊平成普通列表。
interface VirtualizedProps {
  data: readonly unknown[];
  itemContent: (index: number, item: never) => ReactNode;
}

vi.mock("react-virtuoso", () => ({
  Virtuoso: ({ data, itemContent }: VirtualizedProps) => (
    <div data-testid="virtual-list">
      {data.map((row: unknown, index: number) => (
        <div key={index}>{itemContent(index, row as never)}</div>
      ))}
    </div>
  ),
}));

const thumbUrl = vi.hoisted(() => vi.fn((id: string) => `/thumb/${id}`));
const thumbSrcSet = vi.hoisted(() =>
  vi.fn((id: string) => `/thumb/${id} 320w`),
);

vi.mock("../../api/thumbs", () => ({ thumbUrl, thumbSrcSet }));

// 列数按视口宽度分档，测试里直接给宽度。
const viewport = vi.hoisted(() => ({ width: 390 }));
vi.mock("../../hooks/useMediaQuery", () => ({
  useMediaQuery: (query: string) => {
    const min = /min-width:\s*(\d+)px/.exec(query);
    return min ? viewport.width >= Number(min[1]) : false;
  },
}));

/** 目录网格的列数写在 grid-template-columns 上。 */
function gridColumns(container: HTMLElement): number {
  const grid = container.querySelector<HTMLElement>("[style*='grid-template-columns']");
  const value = grid?.style.gridTemplateColumns ?? "";
  return Number(value.match(/repeat\((\d+)/)?.[1] ?? 0);
}

function renderOverview(props: Partial<React.ComponentProps<typeof PageOverview>> = {}) {
  const onJump = vi.fn();
  const onClose = vi.fn();
  render(
    <PageOverview
      images={["f1", "f2", "f3"]}
      index={1}
      onJump={onJump}
      onClose={onClose}
      {...props}
    />,
  );
  return { onJump, onClose };
}

describe("PageOverview", () => {
  it("标出当前页并能跳到别的页", () => {
    const { onJump } = renderOverview({ index: 1 });

    const current = screen.getByRole("button", { name: "跳到第 2 页" });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "跳到第 1 页" }),
    ).not.toHaveAttribute("aria-current");

    fireEvent.click(screen.getByRole("button", { name: "跳到第 3 页" }));
    expect(onJump).toHaveBeenCalledWith(2);
  });

  it("缩略图取不到时留一块页形记号，不留空格子", () => {
    renderOverview();

    const failed = screen
      .getByRole("button", { name: "跳到第 1 页" })
      .querySelector("img");
    expect(failed).not.toBeNull();
    fireEvent.error(failed!);

    // 失败的缩略图撤掉，底下的页形记号接管。
    expect(
      screen.getByRole("button", { name: "跳到第 1 页" }).querySelector("img"),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "跳到第 2 页" }).querySelector("img"))
      .not.toBeNull();
  });

  it("页头写明页数与关闭方式", () => {
    renderOverview();

    expect(screen.getByText("共 3 页")).toBeInTheDocument();
    expect(screen.getByText("T / Esc 关闭")).toBeInTheDocument();
  });

  it("列数按视口宽度分档，且宽档不会被窄档抢走", () => {
    // 断点从宽往窄判：1024 以上是 7 列，640–1023 是 5 列。
    // 早先把 640 的判断排在 1024 前面，1024–1439 一直给 7 列，
    // 每列只剩一百四十几像素。
    viewport.width = 1280;
    renderOverview();
    expect(gridColumns(document.body)).toBe(7);
    cleanup();

    viewport.width = 900;
    renderOverview();
    expect(gridColumns(document.body)).toBe(5);
  });
});
