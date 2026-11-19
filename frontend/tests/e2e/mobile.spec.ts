import { expect, test } from "@playwright/test";
import { resetWorkbenchMode, scannedNodes } from "./helpers/library";

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

  const trigger = page.getByRole("button", { name: "打开导航" });
  await expect(trigger).toBeVisible();
  await trigger.click();

  const nav = page.locator('aside[aria-label="主导航"]');
  await expect(nav).toBeVisible();

  // 焦点关在抽屉里：连按二十次 Tab 都不该跑到背景上去。
  let escaped = false;
  for (let index = 0; index < 20; index += 1) {
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() => {
      const nav = document.querySelector('aside[aria-label="主导航"]');
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
    .locator(".app-toolbar")
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
  await expect
    .poll(() =>
      page.evaluate(() => document.activeElement?.getAttribute("aria-label")),
    )
    .toBe("打开导航");
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

test("可交互控件的命中区够手指点", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  await page.goto("/photo", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  // 有效命中区：控件中心画 44×44，四角与中心都要落在它自己身上。
  const small = await page.evaluate(() => {
    const reach = 22;
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
      if (rect.width >= 44 && rect.height >= 44) continue;
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
  });

  expect(small, `命中区不足 44×44 的控件：${small.join("，")}`).toHaveLength(0);
});
