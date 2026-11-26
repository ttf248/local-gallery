import { expect, it } from "vitest";
import { matchRouteMeta, documentTitle } from "./routeMeta";
import { ROUTE_MANIFEST, ROUTE_REDIRECTS } from "./routeManifest";
import { PHOTO_NAV, COMIC_NAV, MACHINE_GROUP } from "../utils/navEntries";
function documentTitleFor(path: string, mode: "photo" | "comic") {
  const match = matchRouteMeta(path);
  return documentTitle(match?.meta ?? null, match?.params ?? {}, mode);
}
it.each([
  ["/photo", "照片"],
  ["/comic", "漫画首页"],
  ["/photo/library", "相册"],
  ["/comic/library", "书架"],
  ["/photo/explore", "发现"],
  ["/photo/me/picks", "珍藏"],
  ["/comic/unread", "未读"],
  ["/tasks/run", "任务中心 · 运行"],
  ["/settings/data", "设置 · 数据"],
  ["/photo/people/p", "人物相册"],
  ["/photo/travels/place/id", "足迹"],
  ["/photo/tags/C%2B%25xx%2520", "C+%xx%20"],
  ["/photo/search", "搜索结果"],
  ["/photo/semantic", "智能搜索"],
  ["/photo/smart-albums", "智能相册"],
  ["/photo/similarity", "相似照片"],
])("%s 标题包含页面、分区与品牌", (path, title) => {
  expect(
    documentTitleFor(path, path.startsWith("/comic") ? "comic" : "photo"),
  ).toBe(title + " · Local Gallery");
});

it("每条内容路由均有唯一标识和有效的页面归属", () => {
  expect(ROUTE_MANIFEST).toHaveLength(27);
  expect(new Set(ROUTE_MANIFEST.map((meta) => meta.id)).size).toBe(27);
  const keys = [...PHOTO_NAV, ...COMIC_NAV, ...MACHINE_GROUP.entries].map(
    (e) => e.key,
  );
  for (const meta of ROUTE_MANIFEST) {
    const path = meta.path.replace(/:\w+|\*/g, "test");
    expect(matchRouteMeta(path)?.meta).toBe(meta);
    if (meta.navKey) expect(keys).toContain(meta.navKey);
  }
  expect(matchRouteMeta("/comic/explore")).toBeNull();
  expect(matchRouteMeta("/photo/people/annotate")?.meta.id).toBe(
    "photo.people.annotate",
  );
  expect(matchRouteMeta("/comic/read/example")?.meta.chrome.shell).toBe(
    "immersive",
  );
  expect(matchRouteMeta("/photo/albums/example")?.meta.help).toBe("photo");
  expect(matchRouteMeta("/comic/library")?.meta.help).toBe("library");
  expect(ROUTE_REDIRECTS).toHaveLength(9);
});

it("页面标题仅在提供额外信息时拼入", () => {
  const meta = matchRouteMeta("/photo/library")!.meta;
  expect(documentTitle(meta, {}, "photo", "相册")).toBe("相册 · Local Gallery");
  expect(documentTitle(meta, {}, "photo", "我的相片")).toBe(
    "我的相片 · 相册 · Local Gallery",
  );
});
