import { describe, expect, it } from "vitest";
import {
  MODE_PREFIX,
  MODE_ROUTE_PATHS,
  albumRoute,
  counterpartRoute,
  decodeFavPath,
  decodePathTail,
  favoritesRoute,
  homeRoute,
  isReaderPath,
  modeFromPath,
  pageBoundaryKey,
  recentsRoute,
  readerRoute,
  tagRoute,
  unreadRoute,
} from "./path";

describe("modeFromPath", () => {
  it("按首段判断工作台", () => {
    expect(modeFromPath("/photo")).toBe("photo");
    expect(modeFromPath("/photo/recents")).toBe("photo");
    expect(modeFromPath("/photo/albums/a_1")).toBe("photo");
    expect(modeFromPath("/comic")).toBe("comic");
    expect(modeFromPath("/comic/unread")).toBe("comic");
    expect(modeFromPath("/comic/read/a_1")).toBe("comic");
  });

  it("不在任何一侧时返回 null", () => {
    expect(modeFromPath("/")).toBeNull();
    expect(modeFromPath("/settings")).toBeNull();
    // 前缀相同但不是同一段：/photographs 不是照片工作台。
    expect(modeFromPath("/photographs")).toBeNull();
    expect(modeFromPath("/comics")).toBeNull();
  });
});

describe("路由构造", () => {
  it("每个入口落在自己那一侧", () => {
    expect(homeRoute("photo")).toBe("/photo");
    expect(homeRoute("comic")).toBe("/comic");
    expect(recentsRoute("photo")).toBe("/photo/me/recents");
    expect(recentsRoute("comic")).toBe("/comic/me/recents");
    expect(favoritesRoute("photo")).toBe("/photo/me/favorites");
    expect(favoritesRoute("comic")).toBe("/comic/me/favorites");
    expect(albumRoute("photo", "a_1")).toBe("/photo/albums/a_1");
    expect(albumRoute("comic", "a_1")).toBe("/comic/albums/a_1");
    expect(tagRoute("comic", "共同")).toBe("/comic/tags/%E5%85%B1%E5%90%8C");
  });

  it("未读与阅读器只属于漫画侧", () => {
    expect(unreadRoute()).toBe("/comic/unread");
    expect(readerRoute("a_1")).toBe("/comic/read/a_1");
    expect(readerRoute("a_1", 3)).toBe("/comic/read/a_1?index=3");
    expect(isReaderPath("/comic/read/a_1")).toBe(true);
    expect(isReaderPath("/comic/albums/a_1")).toBe(false);
  });
});

describe("counterpartRoute", () => {
  // 切换语义只有一张表：同名页一一对应，只属于一侧的页面回落到对侧首页。
  const cases: Array<[string, string]> = [
    ["/photo", "/comic"],
    ["/comic", "/photo"],
    // 「我的」的页签按名字搬：两侧都有 favorites / recents。
    ["/photo/me/recents", "/comic/me/recents"],
    ["/comic/me/recents", "/photo/me/recents"],
    ["/photo/me/favorites", "/comic/me/favorites"],
    ["/comic/me/favorites", "/photo/me/favorites"],
    // 图库与搜索两侧同名：照片侧叫图库，漫画侧叫书架。
    ["/photo/library", "/comic/library"],
    ["/comic/library", "/photo/library"],
    ["/photo/search", "/comic/search"],
    // 精选只属于照片侧：在读只属于漫画侧 —— 对不上就回落到对侧首页。
    ["/photo/me/picks", "/comic"],
    ["/comic/me/reading", "/photo"],
    ["/photo/tags/%E5%85%B1%E5%90%8C", "/comic/tags/%E5%85%B1%E5%90%8C"],
    ["/comic/tags/%E5%85%B1%E5%90%8C", "/photo/tags/%E5%85%B1%E5%90%8C"],
    // 相册只属于一侧：回落到对侧首页。
    ["/photo/albums/a_1", "/comic"],
    ["/comic/albums/a_1", "/photo"],
    // 阅读器与未读同理。
    ["/comic/read/a_1", "/photo"],
    ["/comic/unread", "/photo"],
  ];

  it.each(cases)("%s 切到另一侧是 %s", (from, to) => {
    expect(counterpartRoute(from, "photo")).toBe(
      from.startsWith("/photo") ? from : to,
    );
    expect(counterpartRoute(from, "comic")).toBe(
      from.startsWith("/comic") ? from : to,
    );
  });

  it("与模式无关的页面落到目标侧首页", () => {
    expect(counterpartRoute("/settings", "comic")).toBe("/comic");
    expect(counterpartRoute("/settings", "photo")).toBe("/photo");
  });
});

describe("decodeFavPath", () => {
  it("从任意一侧的相册路径里取出资源 ID", () => {
    expect(decodeFavPath("/photo/albums/a_1")).toBe("a_1");
    expect(decodeFavPath("/comic/albums/c_1")).toBe("c_1");
    expect(decodeFavPath("/albums/a_1")).toBe("a_1");
  });

  it("不是相册路径时原样返回", () => {
    expect(decodeFavPath("/photo/tags/x")).toBe("/photo/tags/x");
    expect(decodeFavPath("a_1")).toBe("a_1");
  });
});

describe("decodePathTail", () => {
  it("只解码一次", () => {
    // 字面 %2F 是一次编码后的斜杠：解码一次得到 "%2F"，
    // 解两次会变成真正的斜杠，标签名就变了。
    expect(decodePathTail("/photo/tags/%E4%B8%AD%E6%96%87", "/tags/")).toBe(
      "中文",
    );
    expect(decodePathTail("/photo/tags/%2F", "/tags/")).toBe("/");
  });

  it("标记不存在时返回空串", () => {
    expect(decodePathTail("/photo/albums/a_1", "/tags/")).toBe("");
  });
});

describe("MODE_PREFIX", () => {
  it("两侧前缀互不相同", () => {
    expect(MODE_PREFIX.photo).not.toBe(MODE_PREFIX.comic);
  });
});

describe("MODE_ROUTE_PATHS", () => {
  // 少了前导斜杠就会拼出 "/photoalbums/*" 这种匹配不上的路径：
  // 首页能开，点进相册却落回兜底路由。这条用例守住那个斜杠。
  it("照片侧与漫画侧各自成套", () => {
    expect(
      MODE_ROUTE_PATHS.photo.map((p) => `${MODE_PREFIX.photo}${p}`),
    ).toEqual([
      "/photo",
      "/photo/library",
      "/photo/explore",
      "/photo/me/:tab",
      "/photo/search",
      "/photo/albums/*",
      "/photo/tags/*",
    ]);
    expect(
      MODE_ROUTE_PATHS.comic.map((p) => `${MODE_PREFIX.comic}${p}`),
    ).toEqual([
      "/comic",
      "/comic/library",
      "/comic/me/:tab",
      "/comic/search",
      "/comic/albums/*",
      "/comic/tags/*",
    ]);
  });

  it("探索只属于照片侧", () => {
    expect(MODE_ROUTE_PATHS.photo).toContain("/explore");
    expect(MODE_ROUTE_PATHS.comic).not.toContain("/explore");
  });

  it("每条路径都能推出它所属的一侧", () => {
    for (const mode of ["photo", "comic"] as const) {
      for (const path of MODE_ROUTE_PATHS[mode]) {
        expect(modeFromPath(`${MODE_PREFIX[mode]}${path}`)).toBe(mode);
      }
    }
  });
});

describe("pageBoundaryKey", () => {
  // 设置页与任务中心的页签在路径里（/settings/data）。切页签不该重挂
  // 整页 —— 任务中心里已选的分析模块与没保存的每日计划草稿都在页面状态里。
  it("设置页与任务中心的各个页签共用一个键", () => {
    expect(pageBoundaryKey("/settings")).toBe("settings");
    expect(pageBoundaryKey("/settings/interface")).toBe("settings");
    expect(pageBoundaryKey("/settings/server")).toBe("settings");
    expect(pageBoundaryKey("/tasks")).toBe("tasks");
    expect(pageBoundaryKey("/tasks/storage")).toBe("tasks");
  });

  // 其余页面仍然逐页重挂：换相册就是换一份数据。
  it("其余路径一字不动", () => {
    expect(pageBoundaryKey("/photo")).toBe("/photo");
    expect(pageBoundaryKey("/photo/albums/a_1")).toBe("/photo/albums/a_1");
    expect(pageBoundaryKey("/comic/read/c_1")).toBe("/comic/read/c_1");
  });
});
