import type { ReactNode } from "react";
import { MemoryRouter, Outlet, useLocation } from "react-router-dom";
import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import App from "./App";

vi.mock("./hooks/useAppMode", () => ({
  useAppMode: () => ({ mode: "photo", ready: true }),
  useAppModeHydration: () => {},
}));
vi.mock("./hooks/useLibrary", () => ({ useLibraryActivitySync: () => {} }));
vi.mock("./hooks/useTheme", () => ({ useTheme: () => {} }));
vi.mock("./store/selectionStore", () => ({ useSelectionScope: () => {} }));
vi.mock("./shell/AccessGate", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("./features/common/Toast", () => ({ default: () => null }));
vi.mock("./shell/AppFrame", () => ({
  default: () => (
    <>
      <nav aria-label="主导航" />
      <Outlet />
    </>
  ),
}));

// 页面数据由各领域测试覆盖，这里单独验证真实路由表选择的懒加载入口。
vi.mock("./routes/Home", () => ({ default: () => <h1>工作台首页</h1> }));
vi.mock("./routes/Library", () => ({ default: () => <h1>目录浏览</h1> }));
vi.mock("./routes/Explore", () => ({ default: () => <h1>发现</h1> }));
vi.mock("./routes/Me", () => ({ default: () => <h1>个人收藏</h1> }));
vi.mock("./routes/SearchResults", () => ({ default: () => <h1>搜索结果</h1> }));
vi.mock("./routes/YearPhotos", () => ({ default: () => <h1>年份照片</h1> }));
vi.mock("./routes/Unread", () => ({ default: () => <h1>未读</h1> }));
vi.mock("./routes/Album", () => ({ default: () => <h1>相册详情</h1> }));
vi.mock("./routes/Tag", () => ({ default: () => <h1>标签</h1> }));
vi.mock("./routes/Reader", () => ({ default: () => <h1>阅读器</h1> }));
vi.mock("./routes/Settings", () => ({ default: () => <h1>设置</h1> }));
vi.mock("./routes/TaskCenter", () => ({ default: () => <h1>任务中心</h1> }));
vi.mock("./routes/Travels", () => ({ default: () => <h1>足迹</h1> }));
vi.mock("./routes/TravelPlace", () => ({ default: () => <h1>地点详情</h1> }));
vi.mock("./routes/People", () => ({ default: () => <h1>人物</h1> }));
vi.mock("./routes/PeopleAnnotate", () => ({
  default: () => <h1>人物标注</h1>,
}));
vi.mock("./routes/SemanticSearch", () => ({
  default: () => <h1>智能搜索</h1>,
}));
vi.mock("./routes/RandomPhotos", () => ({ default: () => <h1>随手看看</h1> }));
vi.mock("./routes/SmartAlbums", () => ({ default: () => <h1>智能相册</h1> }));
vi.mock("./routes/Similarity", () => ({ default: () => <h1>相似整理</h1> }));

function Location() {
  return <output aria-label="地址">{useLocation().pathname}</output>;
}

const entries = [
  ["/photo", "工作台首页"],
  ["/photo/library", "目录浏览"],
  ["/photo/me/favorites", "个人收藏"],
  ["/photo/search", "搜索结果"],
  ["/photo/albums/a", "相册详情"],
  ["/photo/tags/旅行", "标签"],
  ["/comic", "工作台首页"],
  ["/comic/library", "目录浏览"],
  ["/comic/me/favorites", "个人收藏"],
  ["/comic/search", "搜索结果"],
  ["/comic/albums/a", "相册详情"],
  ["/comic/tags/旅行", "标签"],
  ["/photo/explore", "发现"],
  ["/photo/me/picks", "个人收藏"],
  ["/comic/me/reading", "个人收藏"],
  ["/comic/unread", "未读"],
  ["/photo/years/2024", "年份照片"],
  ["/photo/travels", "足迹"],
  ["/photo/travels/place/123", "地点详情"],
  ["/photo/semantic", "智能搜索"],
  ["/photo/people", "人物"],
  ["/photo/people/p", "人物"],
  ["/photo/people/annotate", "人物标注"],
  ["/photo/random", "随手看看"],
  ["/photo/smart-albums", "智能相册"],
  ["/photo/similarity", "相似整理"],
  ["/comic/read/a", "阅读器"],
  ["/tasks/run", "任务中心"],
  ["/tasks/plan", "任务中心"],
  ["/tasks/history", "任务中心"],
  ["/tasks/storage", "任务中心"],
  ["/settings/interface", "设置"],
  ["/settings/reading", "设置"],
  ["/settings/data", "设置"],
  ["/settings/server", "设置"],
] as const;

it.each(entries)("%s 挂载对应入口并选择导航外壳", async (path, title) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("heading", { name: title })).toBeVisible();
  expect(Boolean(screen.queryByRole("navigation", { name: "主导航" }))).toBe(
    !path.startsWith("/comic/read/"),
  );
});

it.each([
  ["/", "/photo"],
  ["/unknown", "/photo"],
  ["/photo/me", "/photo/me/picks"],
  ["/comic/me", "/comic/me/favorites"],
  ["/tasks", "/tasks/run"],
  ["/settings", "/settings/interface"],
  ["/photo/picks", "/photo/me/picks"],
  ["/photo/favorites", "/photo/me/favorites"],
  ["/photo/recents", "/photo/me/recents"],
  ["/comic/favorites", "/comic/me/favorites"],
  ["/comic/recents", "/comic/me/recents"],
])("%s 恢复到 %s", async (from, to) => {
  render(
    <MemoryRouter initialEntries={[from]}>
      <App />
      <Location />
    </MemoryRouter>,
  );
  await screen.findByRole("heading");
  expect(screen.getByLabelText("地址").textContent).toBe(to);
});
