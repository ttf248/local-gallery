import { expect, it } from "vitest";
import { documentTitleFor } from "./documentTitle";
it.each([
  ["/photo", "照片库"],
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
  ["/photo/similarity", "相似照片与连拍"],
])("%s 标题包含页面、分区与品牌", (path, title) => {
  expect(
    documentTitleFor(path, path.startsWith("/comic") ? "comic" : "photo"),
  ).toBe(title + " · Local Gallery");
});
