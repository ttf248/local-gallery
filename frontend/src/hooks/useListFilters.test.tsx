import { act, renderHook } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, expect, it } from "vitest";
import { useListFilters } from "./useListFilters";
import { useSortPreference } from "../store/sortPreference";

function LocationProbe({ onChange }: { onChange: (search: string) => void }) {
  const location = useLocation();
  onChange(location.search);
  return null;
}

function setup(entry = "/photo/favorites") {
  let search = "";
  const wrapper = ({ children }: { children: ReactNode }) => (
    <MemoryRouter initialEntries={[entry]}>
      {children}
      <LocationProbe onChange={(value) => (search = value)} />
    </MemoryRouter>
  );
  const view = renderHook(() => useListFilters(), { wrapper });
  return { ...view, getSearch: () => search };
}

beforeEach(() => {
  useSortPreference.setState({ sortBy: "name", sortTouched: false });
});

it("筛选从地址里读：关键词、排序、最少图数", () => {
  const { result } = setup("/photo/favorites?q=旅行&sort=count&min=5");
  expect(result.current.query).toBe("旅行");
  expect(result.current.sortBy).toBe("count");
  expect(result.current.minImageCount).toBe(5);
});

it("地址里没有排序时用这一页的天然顺序", () => {
  const { result } = setup("/photo/favorites");
  expect(result.current.sortBy).toBe("name");
});

it("用户亲手选过排序时，地址里没有排序就用他挑的那个", () => {
  useSortPreference.getState().setSortBy("viewed");
  const { result } = setup("/photo/favorites");
  expect(result.current.sortBy).toBe("viewed");
});

it("地址里的排序优先于用户的偏好", () => {
  useSortPreference.getState().setSortBy("viewed");
  const { result } = setup("/photo/favorites?sort=count");
  expect(result.current.sortBy).toBe("count");
});

it("改关键词写回地址", () => {
  const { result, getSearch } = setup();
  act(() => result.current.setQuery("旅行"));
  expect(result.current.query).toBe("旅行");
  expect(getSearch()).toContain("q=%E6%97%85%E8%A1%8C");
});

it("清空关键词就把这一项从地址里去掉", () => {
  const { result, getSearch } = setup("/photo/favorites?q=旅行");
  act(() => result.current.setQuery(""));
  expect(result.current.query).toBe("");
  expect(getSearch()).not.toContain("q=");
});

it("换排序写进地址，也记住为跨页偏好", () => {
  const { result, getSearch } = setup();
  act(() => result.current.setSortBy("viewed"));
  expect(result.current.sortBy).toBe("viewed");
  expect(getSearch()).toContain("sort=viewed");
  expect(useSortPreference.getState().sortBy).toBe("viewed");
  expect(useSortPreference.getState().sortTouched).toBe(true);
});

it("最少图数为 0 时不写进地址", () => {
  const { result, getSearch } = setup("/photo/favorites?min=5");
  act(() => result.current.setMinImageCount(0));
  expect(result.current.minImageCount).toBe(0);
  expect(getSearch()).not.toContain("min=");
});

it("视图与年份也在地址里", () => {
  const { result, getSearch } = setup();
  act(() => result.current.setView("album"));
  expect(result.current.view).toBe("album");
  expect(getSearch()).toContain("view=album");
  act(() => result.current.setYearFilter(2024));
  expect(result.current.yearFilter).toBe(2024);
  expect(getSearch()).toContain("year=2024");
});

it("再点一次同一年份就取消筛选", () => {
  const { result, getSearch } = setup("/photo?year=2024");
  expect(result.current.yearFilter).toBe(2024);
  act(() => result.current.toggleYearFilter(2024));
  expect(result.current.yearFilter).toBeNull();
  expect(getSearch()).not.toContain("year=");
});

it("清空筛选把地址里的筛选项都去掉", () => {
  const { result, getSearch } = setup("/photo?q=旅行&sort=count&min=5&view=album");
  act(() => result.current.reset());
  expect(result.current.query).toBe("");
  expect(result.current.sortBy).toBe("name");
  expect(result.current.minImageCount).toBe(0);
  expect(result.current.view).toBe("all");
  expect(getSearch()).toBe("");
});
