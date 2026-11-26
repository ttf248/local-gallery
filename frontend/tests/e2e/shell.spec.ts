import { expect, test } from "@playwright/test";
import {
  resetNavItems,
  setWorkbenchMode,
  scannedNodes,
} from "./helpers/library";
test.beforeEach(async ({ request }) => {
  await setWorkbenchMode(request, "photo");
  await resetNavItems(request);
});
test("桌面导航与命令面板可用键盘操作", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find((node) => node.name === "sample-album");
  expect(album).toBeDefined();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/photo");
  const rail = page.getByTestId("nav-rail"),
    albums = rail.getByRole("link", { name: "相册" });
  await albums.click();
  await expect(page).toHaveURL(/\/photo\/library$/);
  await expect(albums).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Control+b");
  await expect(rail).toHaveCSS("width", "72px");
  const search = page.getByRole("button", { name: "打开命令面板" });
  await search.click();
  const input = page.getByRole("combobox", { name: "搜索相册或标签" });
  await expect(input).toBeFocused();
  await input.fill(album!.name);
  await expect(
    page.getByRole("option", { name: /sample-album/ }).first(),
  ).toBeVisible();
  await input.press("Enter");
  await expect(page).toHaveURL(new RegExp("/photo/albums/" + album!.id + "$"));
  await search.click();
  await page.keyboard.press("Escape");
  await expect(search).toBeFocused();
});
test("手机底栏展开更多并归还焦点，时间线没有横向溢出", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/photo");
  const nav = page.getByRole("navigation", { name: "主导航", exact: true });
  await expect(nav.getByRole("link")).toHaveCount(4);
  const more = nav.getByRole("button", { name: "更多", exact: true });
  await more.click();
  await expect(
    page
      .getByRole("dialog", { name: "更多" })
      .getByRole("link", { name: "设置" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(0);
});
