import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TimelineYear } from "../../api/library";
import ExploreTimePreview from "./ExploreTimePreview";

const feed = vi.hoisted(() => ({
  years: [] as TimelineYear[],
  isPending: false,
  isError: false,
  isLoading: false,
  isFetching: false,
  refetch: vi.fn(),
  query: null as unknown,
}));

vi.mock("../../hooks/useMediaFeed", () => ({
  useMediaFeed: (query: unknown) => {
    feed.query = query;
    return feed;
  },
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.search}</output>;
}

function renderPreview() {
  return render(
    <MemoryRouter>
      <ExploreTimePreview />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("发现页时间预览", () => {
  beforeEach(() => {
    feed.years = [{ year: 2024, count: 3, months: [] }];
    feed.isPending = false;
    feed.isError = false;
    feed.isLoading = false;
    feed.isFetching = false;
    feed.refetch.mockReset();
    feed.query = null;
  });

  it("按时间线年份统计，并进入同一日期证据范围", () => {
    renderPreview();

    expect(feed.query).toEqual({ kind: "photo", scope: "timeline" });
    const year = screen.getByRole("button", { name: /2024/ });
    expect(year).toHaveTextContent("3 张");
    fireEvent.click(year);
    expect(screen.getByTestId("location")).toHaveTextContent("?year=2024");
  });

  it("年份精度只显示年份入口，不生成月份", () => {
    feed.years = [{ year: 2024, count: 2, months: [] }];
    renderPreview();

    fireEvent.click(screen.getByRole("button", { name: /2024/ }));
    expect(screen.getByTestId("location")).toHaveTextContent("?year=2024");
    expect(screen.getByTestId("location")).not.toHaveTextContent("month=");
  });

  it("应用状态尚未就绪时保持加载态，不误报没有年份", () => {
    feed.years = [];
    feed.isPending = true;
    renderPreview();

    expect(screen.getByText("正在读取年份索引…")).toBeInTheDocument();
    expect(
      screen.queryByText(/目前没有带日期证据的年份/),
    ).not.toBeInTheDocument();
  });
});
