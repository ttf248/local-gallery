import type { AppMode } from "../api/library";
import {
  homeRoute,
  libraryRoute,
  exploreRoute,
  meRoute,
  unreadRoute,
  decodePathTail,
} from "../utils/path";
import { tabLabelFor } from "../utils/pageTabs";
import { workbenchCopy } from "../utils/workbench";
export function documentTitleFor(path: string, mode: AppMode): string {
  const titles: Record<string, string> = {
    [homeRoute(mode)]: mode === "comic" ? "漫画首页" : "照片库",
    [libraryRoute(mode)]: mode === "comic" ? "书架" : "相册",
    [exploreRoute()]: "发现",
    [meRoute(mode)]: mode === "comic" ? "我的漫画" : "珍藏",
    [unreadRoute()]: "未读",
    "/tasks": "任务中心",
    "/photo/travels": "足迹",
    "/photo/people": "人物相册",
    "/photo/similarity": "相似照片与连拍",
    "/photo/semantic": "智能搜索",
    "/photo/smart-albums": "智能相册",
    "/settings": "设置",
  };
  let base = titles[path];
  if (base === undefined) {
    if (path.includes("/tags/")) {
      // 标签段只解码一次：路径里可能是字面 %xx。
      const raw = decodePathTail(path, "/tags/");
      base = raw || "标签";
    } else if (path.startsWith("/photo/travels/place/")) {
      base = "足迹";
    } else if (path.startsWith("/photo/people/")) {
      base = "人物相册";
    } else {
      // 设置页与任务中心的页签按首段查表，「我的」页签要看工作台之后的
      // 第二段；否则标题会掉进工作台的兜底文案。其余页面仍走兜底。
      const [section, subpage] = path.split("/").filter(Boolean);
      if (section === "settings" || section === "tasks") {
        base = titles[`/${section}`];
      }
      if ((section === "photo" || section === "comic") && subpage === "me") {
        base = titles[meRoute(mode)];
      }
      if (subpage === "search") {
        base = "搜索结果";
      }
      if (base === undefined) base = workbenchCopy(mode).albumTypeLabel;
    }
  }
  const tab = tabLabelFor(path);
  return `${base}${tab ? ` · ${tab}` : ""} · Local Gallery`;
}
