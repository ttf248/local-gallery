import {mkdir} from "node:fs/promises";
import { expect, test } from "@playwright/test";
import {
  geometryAlbum,readerUrl,
  resetWorkbenchMode,
  scannedNodes,
  setWorkbenchMode,
} from "./helpers/library";

// 窄屏专项用例：只在 mobile / mobile-landscape 两个 project 上跑
// （见 playwright.config.ts）。
//
// 桌面 Chromium 把视口缩窄不等于手机：触摸设备没有悬停、指针是粗的、
// 像素密度不是 1、横竖屏是两套版式。这些只有带触摸的 context 才算真。

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
});

test("抽屉开合：背景不滚、焦点不跑出去", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  await page.goto("/photo");

  const trigger = page.getByRole("button", { name: "更多", exact:true });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const nav = page.getByRole('dialog',{name:'更多'});
  await expect(nav).toBeVisible();

  // 焦点关在抽屉里：连按二十次 Tab 都不该跑到背景上去。
  let escaped = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const nav = document.querySelector('dialog[open][aria-label="更多"]');
      const active = document.activeElement;
      return Boolean(nav && active && nav.contains(active));
    });
    if (!inside) {
      escaped = true;
      break;
    }
  }
  const main = page.locator(".app-main");
  const locked =
    (await main.evaluate((el) => getComputedStyle(el).overflowY)) === "hidden";
  const inert = await page
    .getByTestId("top-bar")
    .evaluate(
      (el) => el.hasAttribute("inert") || Boolean(el.closest("[inert]")),
    );

  // 抽屉是模态：焦点关在里面、背景不可聚焦、正文不滚。
  expect(escaped, "焦点不该跑到抽屉外面").toBe(false);
  expect(locked, "抽屉打开时正文应当锁滚").toBe(true);
  expect(inert, "抽屉打开时背景应当 inert").toBe(true);

  await page.keyboard.press("Escape");
  await expect(nav).toBeHidden();

  // 关闭后焦点回到触发按钮，背景恢复可聚焦、可滚。
  await expect(trigger).toBeFocused();
  expect(
    await page
      .locator(".app-main")
      .evaluate((el) => getComputedStyle(el).overflowY),
  ).not.toBe("hidden");
});

test("主流程走得通：进相册、选照片、多选条在视口内", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.imageCount && item.imageCount > 2);
  expect(album).toBeDefined();

  await page.goto(`/photo/albums/${album!.id}`);
  // 照片墙上点一张进大图预览，再退出来。
  // 照片墙的可点元素是盖在图上的按钮（图只是它的底图）。
  const tile = page.getByRole("button", { name: /^查看 / }).first();
  await expect(tile).toBeVisible();
  await tile.click();
  await expect(page.locator('[role="dialog"]').first()).toBeVisible();
  await page.keyboard.press("Escape");

  // 横向不溢出：手机上溢出意味着内容被切掉。
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
});

test("页面在窄屏上没有横向溢出", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  for (const route of ["/photo", "/photo/smart-albums", "/photo/me/recents"]) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(600);
    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow, `${route} 横向溢出`).toBeLessThanOrEqual(1);
  }
});

test("漫画首页在窄屏上使用漫画标题与书架入口", async ({ page }) => {
  await scannedNodes(page.request, "comic");
  await setWorkbenchMode(page.request, "comic");

  await page.goto("/comic");
  await expect(page).toHaveTitle("漫画首页 · Local Gallery");
  const shelfAction = page.locator(".home-heading__actions").getByRole("link");
  await expect(shelfAction).toHaveAccessibleName("书架");
  await expect(shelfAction).toHaveAttribute("href", "/comic/library");

  const nav = page.getByRole("navigation",{name:"主导航",exact:true});
  await expect(nav.getByRole("link", { name: "书架" })).toBeVisible();
});

test("漫画内容存在但没有在读或未读时显示书架引导", async ({ page }) => {
  const comicAlbums = await scannedNodes(page.request, "comic");
  expect(comicAlbums.length).toBeGreaterThan(0);
  await setWorkbenchMode(page.request, "comic");
  await page.route("**/api/library/dashboard*", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("kind") !== "comic") {
      await route.continue();
      return;
    }
    await route.fulfill({
      json: {
        ok: true,
        dashboard: {
          revision: 1,
          albumCount: comicAlbums.length,
          unreadCount: 0,
          unread: [],
          inProgress: [],
        },
      },
    });
  });

  await page.goto("/comic");
  await expect(
    page.getByRole("heading", { name: "还没有开始阅读" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "去书架看看" })).toHaveAttribute(
    "href",
    "/comic/library",
  );
});

test("漫画侧没有内容时说明空工作台并提供照片库入口", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  await setWorkbenchMode(page.request, "comic");
  await page.route("**/api/library/manifest*", async (route) => {
    const response = await route.fetch();
    const manifest = (await response.json()) as {
      manifest: {
        statistics: { comicAlbumCount: number; photoAlbumCount: number };
      };
    };
    expect(manifest.manifest.statistics.photoAlbumCount).toBeGreaterThan(0);
    manifest.manifest.statistics.comicAlbumCount = 0;
    await route.fulfill({ json: manifest });
  });

  await page.goto("/comic");
  await expect(
    page.getByRole("heading", { name: "漫画这边还没有内容" }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "媒体目录都被设成了另一种内容属性。可以在设置里改属性，或者先去照片那边看看。",
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "去照片库看看" }),
  ).toHaveAttribute("href", "/photo");
});

test("可交互控件的命中区够手指点", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  await page.goto("/photo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  // 与设计契约和布局审计共用触屏档门槛，同时检查伪元素扩展的点击区域。
  const minTarget = 40;
  const small = await page.evaluate((minSize) => {
    const reach = minSize / 2;
    const problems: string[] = [];
    for (const el of document.querySelectorAll(
      "button, a[href], [role='button']",
    )) {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      if (rect.top > window.innerHeight || rect.bottom < 0) continue;
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const points = [
        [-reach, -reach],
        [reach, -reach],
        [-reach, reach],
        [reach, reach],
        [0, 0],
      ];
      // 本体就够大的控件不用查（照片墙的瓦片是 342 见方，角被邻居压住
      // 也不影响点得到）。
      if (rect.width >= minSize && rect.height >= minSize) continue;
      const ok = points.every(([dx, dy]) => {
        const hit = document.elementFromPoint(cx + dx, cy + dy);
        return hit === el || (hit !== null && el.contains(hit));
      });
      if (!ok) {
        problems.push(
          `${el.getAttribute("aria-label") || el.textContent?.trim().slice(0, 20) || "(无文字)"} ${Math.round(rect.width)}×${Math.round(rect.height)}`,
        );
      }
    }
    return problems;
  }, minTarget);

  expect(
    small,
    `命中区不足 ${minTarget}×${minTarget} 的控件：${small.join("，")}`,
  ).toHaveLength(0);
});

for (const theme of ["light", "dark"] as const)
  test("漫画触摸设置、菜单和翻页可达 " + theme, async ({ page }, info) => {
    const album = await geometryAlbum(page.request, 8);
    await page.addInitScript(
      (t) =>
        localStorage.setItem(
          "local-gallery-ui",
          JSON.stringify({ version: 0, state: { theme: t } }),
        ),
      theme,
    );
    await page.goto(readerUrl(album, "?index=1"));
    const toolbar = page.getByRole("toolbar", { name: "阅读控制" });
    await expect(toolbar).toBeVisible();
    const landscape = info.project.name === "mobile-landscape";
    const sizes = landscape
      ? [[844, 390]]
      : [
          [390, 844],
          [360, 800],
          [320, 640],
        ];
    for (const [width, height] of sizes) {
      await page.setViewportSize({ width, height });
      if (width === 320)
        await page.evaluate(
          () => (document.documentElement.style.fontSize = "200%"),
        );
      const bounds = await toolbar
        .locator("button:visible,[role=slider]:visible")
        .evaluateAll((els) =>
          els.map((el) => {
            const r = el.getBoundingClientRect();
            return [r.left, r.right, r.width, r.height];
          }),
        );
      for (const [left, right, w, h] of bounds) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(right).toBeLessThanOrEqual(width);
        expect(w).toBeGreaterThanOrEqual(40);
        expect(h).toBeGreaterThanOrEqual(40);
      }
    }
    await page.evaluate(() =>
      document.documentElement.style.removeProperty("font-size"),
    );
    const [w, h] = sizes[0];
    await page.setViewportSize({ width: w, height: h });
    if (!landscape) {
      await page.touchscreen.tap(45, 300);
      await expect(page.getByTitle("跳转到指定页 (G)")).toHaveText("3");
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: 80, y: 310 }],
      });
      for (const x of [120, 180, 240])
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [{ x, y: 311 }],
        });
      await cdp.send("Input.dispatchTouchEvent", {
        type: "touchEnd",
        touchPoints: [],
      });
      await expect(page.getByTitle("跳转到指定页 (G)")).toHaveText("4");
      await page.waitForFunction(() =>
        document
          .querySelector('[data-reader-page="3"] img')
          ?.matches(":not([hidden])"),
      );
    }
    const dir = ".smoke/comic-plan-b-after";
    await mkdir(dir, { recursive: true });
    await toolbar.getByRole("button", { name: "设置", exact: true }).tap();
    const settings = page.getByRole("dialog", { name: "阅读设置" });
    await expect(settings).toBeVisible();
    await settings.getByRole("radio", { name: "按高" }).tap();
    await page.screenshot({
      animations: "disabled",
      path: `${dir}/${theme}-${w}x${h}-settings.png`,
    });
    await settings.getByRole("button", { name: "关闭阅读设置" }).tap();
    await page.getByRole("button", { name: "更多", exact: true }).tap();
    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const box = (await menu.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(7);
    expect(box.y + box.height).toBeLessThanOrEqual(h - 7);
    const last = menu.getByRole("menuitem", { name: /最后一页/ });
    await last.scrollIntoViewIfNeeded();
    await page.screenshot({
      animations: "disabled",
      path: `${dir}/${theme}-${w}x${h}-menu.png`,
    });
    await last.tap();
    await expect(page.getByTitle("跳转到指定页 (G)")).toHaveText("8");
  });
