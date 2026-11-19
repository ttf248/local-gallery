import { expect, test } from "@playwright/test";
import {
  liveRoots,
  resetNavItems,
  resetWorkbenchMode,
  setWorkbenchMode,
} from "./helpers/library";

/**
 * 导航的验收用例。
 *
 * 锁住的是「入口还在不在、到了能不能看见东西」：两侧工作台各自的菜单、
 * 旧书签仍然打得开、「我的」的页签是一次普通导航。
 */

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});


test("照片与漫画两侧的导航各自成套", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo");
  const sidebar = page.locator('aside[aria-label="主导航"]');
  await expect(sidebar.getByRole("link", { name: "图库" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "探索" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "书架" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "未读" })).toHaveCount(0);

  await setWorkbenchMode(request, "comic");
  await page.goto("/comic");
  await expect(sidebar.getByRole("link", { name: "书架" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "未读" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "图库" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "探索" })).toHaveCount(0);
});

test("旧书签仍然打得开：它们重定向到新入口", async ({ page }) => {
  for (const [oldPath, newPath] of [
    ["/photo/recents", "/photo/me/recents"],
    ["/photo/favorites", "/photo/me/favorites"],
    ["/photo/picks", "/photo/me/picks"],
    ["/comic/recents", "/comic/me/recents"],
    ["/comic/favorites", "/comic/me/favorites"],
  ]) {
    await page.goto(oldPath);
    await expect(page).toHaveURL(new RegExp(newPath.replace("/", "\\/")));
  }
});

test("「我的」用页签承载精选、收藏与最近浏览", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo/me");
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
  for (const label of ["精选照片", "收藏", "最近浏览"]) {
    await expect(page.getByRole("tab", { name: label })).toBeVisible();
  }
  // 页签切换是一次普通导航：地址跟着变，后退能退回去。
  await page.getByRole("tab", { name: "收藏" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/favorites/);
  await page.goBack();
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
});

test("切换「我的」页签后保留已访问的面板", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo/me/picks");
  await expect(page.locator("#me-panel-picks")).toBeVisible();

  await page.getByRole("tab", { name: "收藏" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/favorites/);
  await expect(page.locator("#me-panel-favorites")).toBeVisible();

  await page.getByRole("tab", { name: "精选照片" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
  await expect(page.locator("#me-panel-favorites")).toBeAttached();
  await expect(page.locator("#me-panel-favorites")).toBeHidden();
});
