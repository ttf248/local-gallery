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
  await expect(page.locator("[data-canvas]")).toBeVisible();
  const rail = page.getByRole("complementary", { name: "主导航" }),
    albums = rail.getByRole("link", { name: "相册" });
  await albums.click();
  await expect(page).toHaveURL(/\/photo\/library$/);
  await expect(albums).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Control+b");
  await expect(rail).toHaveCSS("width", "72px");
  const search = rail.getByRole("button", { name: "打开命令面板" });
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

test("预览翻页关闭后归还对应瓦片焦点，时间轨键盘提交年份", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/photo");
  const tiles = page.getByTestId("media-tile");
  await expect(tiles.nth(1)).toBeVisible();
  const nextId = await tiles.nth(1).getAttribute("data-media-id");
  await tiles.first().locator("[data-open]").click();
  const viewer = page.getByRole("dialog", { name: /大图预览/ });
  await expect(viewer).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText(/第 2 张/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(
    page.locator('[data-media-id="' + nextId + '"] [data-open]'),
  ).toBeFocused();
  const rail = page.getByRole("slider", { name: "时间轨" });
  await rail.focus();
  await rail.press("PageDown");
  await expect(page).toHaveURL(/\/photo$/);
  await rail.press("Enter");
  await expect(page).toHaveURL(/year=/);
});
test("密度步进后中心照片留在视口中", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() =>
    localStorage.setItem(
      "local-gallery-photos",
      JSON.stringify({
        state: { density: "compact", showInfo: false },
        version: 0,
      }),
    ),
  );
  await page.goto("/photo");
  const tiles = page.getByTestId("media-tile");
  await expect(tiles.first()).toBeVisible();
  const anchor = await page
    .locator("[data-virtuoso-scroller]")
    .evaluate((el) => {
      const r = el.getBoundingClientRect(),
        x = r.left + r.width / 2,
        y = r.top + r.height / 2;
      const candidates = Array.from(
        el.querySelectorAll<HTMLElement>("[data-media-id]"),
      );
      const distance = (tile: HTMLElement) => {
        const b = tile.getBoundingClientRect();
        return Math.hypot(x - b.left - b.width / 2, y - b.top - b.height / 2);
      };
      const item =
        document
          .elementFromPoint(x, y)
          ?.closest<HTMLElement>("[data-media-id]") ??
        candidates.sort((a, b) => distance(a) - distance(b))[0];
      return {
        id: item.dataset.mediaId,
        height: item.getBoundingClientRect().height,
      };
    });
  const tile = page.locator('[data-media-id="' + anchor.id + '"]');
  await page.keyboard.press("]");
  await page.keyboard.press("]");
  await expect(tile).toBeInViewport();
  await expect
    .poll(async () => (await tile.boundingBox())?.height ?? 0)
    .toBeGreaterThan(anchor.height);
});
