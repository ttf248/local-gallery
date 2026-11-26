import { expect, test, type APIRequestContext } from "@playwright/test";
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
 * 旧书签仍然打得开、页签是一次普通导航、深链打开后返回逐级往上。
 */

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});

/** 某个目录下的直属子项（相册与集合）。 */
async function childrenOf(
  request: APIRequestContext,
  parentId: string,
): Promise<Array<{ id: string; name: string; kind: string }>> {
  const response = await request.get(
    `/api/library/${encodeURIComponent(parentId)}/children?limit=200&kind=photo`,
  );
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    page: { items: Array<{ id: string; name: string; kind: string }> };
  };
  return body.page.items;
}

test("照片与漫画两侧的导航各自成套", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo");
  const sidebar = page.locator('aside[aria-label="主导航"]');
  await expect(sidebar.getByRole("link", { name: "相册" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "发现" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "书架" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "未读" })).toHaveCount(0);

  await setWorkbenchMode(request, "comic");
  await page.goto("/comic");
  await expect(sidebar.getByRole("link", { name: "书架" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "未读" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "相册" })).toHaveCount(0);
  await expect(sidebar.getByRole("link", { name: "发现" })).toHaveCount(0);
});

test("漫画工作台用暖铜赭强调色，照片工作台用炭黑强调色", async ({
  page,
  request,
}) => {
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo");
  const photoAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
  );
  expect(photoAccent.toLowerCase()).toBe("#18181b");

  await setWorkbenchMode(request, "comic");
  await page.goto("/comic");
  const comicAccent = await page.evaluate(() =>
    getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim(),
  );
  expect(comicAccent.toLowerCase()).toBe("#8a4f2d");
});

test("旧书签仍然打得开：它们重定向到新入口", async ({ page }) => {
  for (const [oldPath, newPath] of [
    ["/photo/recents", "/photo/me/recents"],
    ["/photo/favorites", "/photo/me/favorites"],
    ["/photo/picks", "/photo/me/picks"],
    ["/comic/recents", "/comic/me/recents"],
    ["/comic/favorites", "/comic/me/favorites"],
  ]) {
    await page.goto(oldPath + "?q=a%2Bb#item");
    await expect(page).toHaveURL((url) =>
      url.pathname === newPath && url.search === "?q=a%2Bb" && url.hash === "#item",
    );
  }
});

test("我的漫画子页签显示对应的浏览器标题", async ({ page, request }) => {
  await setWorkbenchMode(request, "comic");
  await page.goto("/comic/me/reading");
  await expect(page).toHaveTitle("我的漫画 · Local Gallery");
});

test("「我的」用页签承载精选、收藏与最近浏览", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo/me");
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
  for (const label of ["精选照片", "收藏", "最近浏览"]) {
    await expect(page.getByRole("link", { name: label, exact:true })).toBeVisible();
  }
  // 页签切换是一次普通导航：地址跟着变，后退能退回去。
  await page.getByRole("link", { name: "收藏" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/favorites/);
  await page.goBack();
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
});

test("切换「我的」页签后保留已访问的面板", async ({ page, request }) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");
  await page.goto("/photo/me/picks");
  await expect(page.locator("#me-panel-picks")).toBeVisible();

  await page.getByRole("link", { name: "收藏" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/favorites/);
  await expect(page.locator("#me-panel-favorites")).toBeVisible();

  await page.getByRole("link", { name: "精选照片" }).click();
  await expect(page).toHaveURL(/\/photo\/me\/picks/);
  await expect(page.locator("#me-panel-favorites")).toBeAttached();
  await expect(page.locator("#me-panel-favorites")).toBeHidden();
});

/**
 * 深链打开相册后返回要逐级往上。
 *
 * 直接打开一个相册的链接时没有上一页可退：返回要落回它所属的集合，
 * 再上一级是集合的集合，再上一级回到相册页。回落是「替换」而不是
 * 「追加」——追加的话返回一次到上级、再返回一次又回到这一页，
 * 用户在两页之间打转。
 */
test("深链打开相册后返回逐级往上，不在两页之间打转", async ({
  page,
  request,
}) => {
  await liveRoots(request);
  await setWorkbenchMode(request, "photo");

  const manifest = (await (
    await request.get("/api/library/manifest")
  ).json()) as {
    manifest: { roots: Array<{ id: string; contentKind?: string }> };
  };
  const root = manifest.manifest.roots.find(
    (item) => item.contentKind === "photo",
  );
  expect(root, "临时库里应有照片根").toBeTruthy();

  // 临时库的层级：zz-library-hierarchy / outer / inner（inner 是相册）。
  const level1 = (await childrenOf(request, root!.id)).find(
    (node) => node.name === "zz-library-hierarchy",
  );
  expect(level1, "临时库里应有嵌套集合").toBeTruthy();
  const level2 = (await childrenOf(request, level1!.id)).find(
    (node) => node.name === "outer",
  );
  expect(level2, "临时库里应有第二层集合").toBeTruthy();
  const album = (await childrenOf(request, level2!.id)).find(
    (node) => node.name === "inner",
  );
  expect(album, "临时库里应有嵌套相册").toBeTruthy();

  // 深链直接打开这一本：地址栏里没有上一页可退。
  await page.goto(`/photo/albums/${album!.id}`);
  await expect(
    page.getByRole("button", { name: "返回" }).first(),
  ).toBeVisible();

  await page.getByRole("button", { name: "返回" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/photo/albums/${level2!.id}$`));

  // 再按一次返回：往上再走一级，而不是退回刚才那本相册。
  await page.getByRole("button", { name: "返回" }).first().click();
  await expect(page).toHaveURL(new RegExp(`/photo/albums/${level1!.id}$`));

  // 顶层集合没有上级了：落回相册页。
  await page.getByRole("button", { name: "返回" }).first().click();
  await expect(page).toHaveURL(/\/photo\/library$/);
});
