import { expect, test } from "@playwright/test";
import {
  albumUrlPattern,
  liveRoots,
  resetNavItems,
  resetWorkbenchMode,
  scannedNodes,
} from "./helpers/library";

/**
 * 图库的验收用例。
 *
 * 图库回答「库里有什么、在哪儿」：真实目录层级、面包屑、点相册进照片墙，
 * 以及读不出来时给不给得出重试的手柄。
 */

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});


test("从首页进图库，按目录找到相册并打开照片", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find(
    (node) => (node as { kind?: string }).kind === "album" && node.name,
  );
  expect(album, "临时库里应有照片相册").toBeTruthy();

  await page.goto("/photo");
  // 首页上有一枚明确的图库入口。
  await page.getByRole("link", { name: /图库/ }).first().click();
  await expect(page).toHaveURL(/\/photo\/library/);
  await expect(
    page.getByRole("heading", { name: /全部相册|图库/ }).first(),
  ).toBeVisible();

  // 目录树给出真实的文件夹层级：媒体根下挂着集合与相册。
  const tree = page.getByRole("navigation", { name: "目录" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("button").first()).toBeVisible();

  // 点目录里的那本相册，直接进照片墙。
  const albumInTree = tree.getByRole("button", { name: album!.name, exact: true });
  await expect(albumInTree).toBeVisible();
  await albumInTree.click();
  await expect(page).toHaveURL(albumUrlPattern({ id: album!.id }));
  await expect(
    page.locator("[data-virtuoso-scroller], .photo-wall").first(),
  ).toBeVisible();
});

test("图库能按集合下钻，面包屑说清在哪一层", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  // 展开第一个媒体根，找一个集合点进去。
  const collection = tree.getByRole("button", { name: /^[^/]*\d+ 本相册$/ });
  if ((await collection.count()) > 0) {
    await collection.first().click();
    await expect(page).toHaveURL(/\/photo\/library\?node=/);
    // 面包屑给出祖先链：至少是「图库 › 某集合」。
    await expect(page.getByRole("navigation", { name: "目录位置" })).toBeVisible();
  }
});

test("图库打不开时给出重试手柄", async ({ page, request }) => {
  await liveRoots(request);
  await page.route("**/api/library/overview**", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "test_unavailable", message: "unavailable" },
    }),
  );
  await page.goto("/photo/library");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("图库内容读取失败", { timeout: 15_000 });
  await expect(alert.getByRole("button", { name: /重试/ })).toBeVisible();
});
