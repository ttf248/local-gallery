// 多断点 / 明暗主题截图工具：用于设计迭代的前后对照。
//
// 用法：
//   node scripts/screenshot.mjs --out .smoke/round1
//   LG_BASE=http://127.0.0.1:5173 node scripts/screenshot.mjs --out .smoke/x
//   LG_VIEWPORTS=1440x900,390x844 node scripts/screenshot.mjs --out ...
//   LG_THEMES=light node scripts/screenshot.mjs --out ...
//   LG_PAGES=/,/unread node scripts/screenshot.mjs --out ...
//   LG_FULL=1 node scripts/screenshot.mjs --out ...      # 整页截图
//
// 产物写入 .smoke/（已被根 .gitignore 忽略，不入库）。
import { chromium } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import {
  buildRoute,
  resolveAlbumId,
  resolveMode,
} from "./lib/workbench-routes.mjs";
import {
  profileOptionsFromEnv,
  resolveProfiles,
} from "./lib/device-profile.mjs";

const BASE = process.env.LG_BASE ?? "http://127.0.0.1:5173";
const THEMES = (process.env.LG_THEMES ?? "light,dark").split(",").filter(Boolean);
// 页面清单：模式前缀由 buildRoute 补（审计脚本早就这么做了，截图脚本
// 此前直接拼 BASE + route，/recents 落在兜底路由、截出来的其实是首页）。
// 可以写伪路由 album / reader / tag：运行时现取真实相册与标签。
const PAGES = (process.env.LG_PAGES ?? "/,/recents,/favorites,/unread,/settings/interface,/settings/reading,/settings/data,/settings/server,/tasks/run,/tasks/plan,/tasks/history,/tasks/storage,/travels,/smart-albums,album,reader,tag")
  .split(",")
  .map((p) => p.trim())
  .filter(Boolean);
// 设备档位：视口 + 触摸 + 像素比 + 横竖屏（见 lib/device-profile.mjs）。
const PROFILES = resolveProfiles({
  viewports: (
    process.env.LG_VIEWPORTS ??
    "390x844,768x1024,1024x768,1440x900,1920x1080,2560x1440"
  )
    .split(",")
    .map((v) => {
      const [w, h] = v.split("x").map(Number);
      return { width: w, height: h };
    })
    .filter((v) => Number.isFinite(v.width)),
  ...profileOptionsFromEnv(),
});

const argv = process.argv.slice(2);
const outArg = argv.indexOf("--out");
const OUT = path.resolve(
  outArg >= 0 ? argv[outArg + 1] : ".smoke/shots",
);
const FULL = process.env.LG_FULL === "1";

const slug = (route) =>
  route === "/" ? "home" : route.replace(/^\//, "").replace(/[/?=&]/g, "-");

// 档位标签进文件名：触摸档与桌面档尺寸相同时会互相覆盖。
const profileSlug = (profile) => profile.label.replace(/x/, "-");

async function setTheme(page, theme) {
  await page.evaluate((t) => {
    const raw = localStorage.getItem("local-gallery-ui");
    const parsed = raw ? JSON.parse(raw) : { state: {} };
    parsed.state = { ...(parsed.state ?? {}), theme: t };
    localStorage.setItem("local-gallery-ui", JSON.stringify(parsed));
  }, theme);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  let count = 0;

  for (const theme of THEMES) {
    for (const profile of PROFILES) {
      const viewport = profile.viewport;
      const ctx = await browser.newContext({
        viewport,
        hasTouch: profile.hasTouch,
        deviceScaleFactor: profile.deviceScaleFactor,
        locale: "zh-CN",
        colorScheme: theme,
      });
      const page = await ctx.newPage();
      page.on("pageerror", (e) =>
        errors.push(`[${theme}/${viewport.width}] ${e.message}`),
      );
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      await setTheme(page, theme);
      // 工作台模式决定路由前缀：两侧的页面各在 /photo 与 /comic 下。
      const mode = await resolveMode(page);

      for (const route of PAGES) {
        // 伪路由：相册页与阅读器要现取一本真实相册。
        let target = route;
        if (route === "album" || route === "reader") {
          const albumId = await resolveAlbumId(page, mode);
          if (!albumId) continue;
          target =
            route === "album" ? `/albums/${albumId}` : `/read/${albumId}`;
        }
        // 不用 networkidle：页面里有 SSE 长连接，且 /api/previews 首次生成
        // 预览图可能耗时数秒，networkidle 会一直等不到而超时。
        await page.goto(BASE + buildRoute(target, mode), {
          waitUntil: "domcontentloaded",
          timeout: 60000,
        });
        await page
          .waitForFunction(
            () =>
              Array.from(document.images).every(
                (img) => !img.complete || img.naturalWidth > 0,
              ),
            undefined,
            { timeout: 20000 },
          )
          .catch(() => {});
        await page.waitForTimeout(1200);
        const name = `${theme}-${profileSlug(profile)}-${slug(route)}.png`;
        await page.screenshot({
          path: path.join(OUT, name),
          fullPage: FULL,
        });
        count++;
      }
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`${count} shots -> ${OUT}`);
  if (errors.length) {
    console.log("=== page errors ===");
    console.log([...new Set(errors)].join("\n"));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
