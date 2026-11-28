import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { geometryAlbum, readerUrl } from "./helpers/library";

async function jump(page: Page, n: number) {
  await page.keyboard.press("g");
  const input = page.getByRole("textbox", { name: "跳转到第几页" });
  await input.fill(String(n));
  await input.press("Enter");
}
async function shot(page: Page, name: string) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [
        ...document.querySelectorAll<HTMLImageElement>(
          "[data-reader-page] img",
        ),
      ].map((i) => i.decode().catch(() => {})),
    );
  });
  const dir = path.resolve(".smoke/comic-plan-b-after");
  await mkdir(dir, { recursive: true });
  await page.screenshot({ path: path.join(dir, name + ".png") });
}
for (const theme of ["light", "dark"] as const) {
  test(
    theme + " 三种版式等比，页首尾可达，跨页保留逻辑位置和旋转",
    async ({ page }) => {
      const album = await geometryAlbum(page.request, 9);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.addInitScript(
        (t) =>
          localStorage.setItem(
            "local-gallery-ui",
            JSON.stringify({ version: 0, state: { theme: t } }),
          ),
        theme,
      );
      await page.goto(readerUrl(album, "?index=1"));
      const img = page.getByAltText("第 2 页", { exact: true }),
        stage = page.locator("[data-image-gallery]");
      await expect(img).toBeVisible();
      await img.evaluate((i: HTMLImageElement) => i.decode());
      const box = async () => (await img.boundingBox())!;
      let b = await box(),
        v = (await stage.boundingBox())!;
      expect(b.width / b.height).toBeCloseTo(900 / 1350, 2);
      expect(b.y).toBeGreaterThanOrEqual(v.y - 1);
      expect(b.y + b.height).toBeLessThanOrEqual(v.y + v.height + 1);
      await shot(page, theme + "-1440x900-single-default");
      await page.keyboard.press("f");
      await stage.evaluate((el) => (el.scrollTop = 0));
      await expect
        .poll(async () => (await box()).width)
        .toBeCloseTo(v.width, 0);
      await stage.evaluate((el) => (el.scrollTop = 0));
      await expect.poll(async () => (await box()).y - v.y).toBeCloseTo(0, 0);
      await shot(page, theme + "-1440x900-width-top");
      await stage.evaluate((el) => (el.scrollTop = el.scrollHeight));
      await expect
        .poll(async () =>
          Math.abs((await box()).y + (await box()).height - v.y - v.height),
        )
        .toBeLessThan(1.5);
      await shot(page, theme + "-1440x900-width-bottom");
      await page.keyboard.press("+");
      await page.keyboard.press("r");
      await page.keyboard.press("3");
      const pages = stage.locator("[data-reader-page]");
      await expect(pages).toHaveCount(2);
      const left = (await pages.nth(0).boundingBox())!,
        right = (await pages.nth(1).boundingBox())!;
      expect(right.x - left.x - left.width).toBeCloseTo(4, 0);
      expect(left.y).toBeCloseTo(right.y, 0);
      expect(await pages.first().getAttribute("data-reader-page")).toBe("2");
      // 第 1 页本身就是跨页扫描图，关闭封面偏移后仍然独占一屏。
      await page.keyboard.press("o");
      await jump(page, 1);
      await expect(pages).toHaveCount(1);
      await expect(pages.first()).toHaveAttribute("data-reader-page", "0");
      await jump(page, 2);
      await page.keyboard.press("o");
      await expect(pages.first()).toHaveAttribute("data-reader-page", "2");
      await shot(page, theme + "-1440x900-double-90");
      await page.keyboard.press("2");
      await expect(img).toBeVisible();
      await page.keyboard.press("1");
      await expect(page.getByTitle("跳转到指定页 (G)")).toHaveText("2");
      for (const angle of [90, 180, 270]) {
        if (angle !== 90) await page.keyboard.press("r");
        await expect
          .poll(() => img.evaluate((el) => el.style.transform))
          .toContain("rotate(" + angle + "deg)");
      }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.keyboard.press("0");
      await page.keyboard.press("r");
      await page.keyboard.press("f");
      await jump(page, 1);
      const landscape = page.getByAltText("第 1 页", { exact: true });
      await expect(landscape).toBeVisible();
      v = (await stage.boundingBox())!;
      b = (await landscape.boundingBox())!;
      expect(b.height).toBeCloseTo(v.height, 0);
      expect(b.width / b.height).toBeCloseTo(900 / 697, 2);
      await shot(page, theme + "-390x844-height");
    },
  );
}
test("连续翻屏、远端活动与新会话续读一致", async ({ page, browser }) => {
  const id = await geometryAlbum(page.request, 8);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(readerUrl(id, "?index=0"));
  await expect(page.getByAltText("第 1 页")).toBeVisible();
  await page.keyboard.press("2");
  await page.keyboard.press("f");
  await jump(page, 7);
  const activity = async () => {
    const r = await page.request.get("/api/activity", {
      params: { albumId: id, mediaKind: "image" },
    });
    return r.ok() ? await r.json() : null;
  };
  await expect
    .poll(activity)
    .toMatchObject({ pageIndex: 6, status: "in_progress" });
  await expect(page.getByTestId("reader-finished")).toHaveCount(0);
  await shot(page, "dark-1440x900-continuous-7");
  const scroll = page.locator("[data-virtuoso-scroller]");
  const top = () => scroll.evaluate((el) => el.scrollTop);
  const initial = await top();
  await page.keyboard.press("PageDown");
  await expect.poll(top).toBeGreaterThan(initial);
  await jump(page, 8);
  await expect
    .poll(activity)
    .toMatchObject({ pageIndex: 7, status: "completed" });
  await jump(page, 7);
  await expect
    .poll(activity)
    .toMatchObject({ pageIndex: 6, status: "in_progress" });
  const other = await browser.newPage();
  try {
    await other.goto(new URL(readerUrl(id), page.url()).href);
    await expect(other.getByTitle("跳转到指定页 (G)")).toHaveText("7");
  } finally {
    await other.close();
  }
});
test("千页连续窗口与目录仅请求有限预览，快速定位采用最新目标", async ({
  page,
}) => {
  const id = await geometryAlbum(page.request, 1001);
  await page.addInitScript(() =>
    localStorage.setItem(
      "local-gallery",
      JSON.stringify({
        version: 0,
        state: { mode: "continuous", fit: "width", direction: "rtl" },
      }),
    ),
  );
  const originals: string[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/media/")) originals.push(r.url());
  });
  await page.goto(readerUrl(id, "?index=776"));
  const label = page.getByTitle("跳转到指定页 (G)");
  await expect(label).toHaveText("777");
  await expect(
    page.getByAltText("第 777 页", { exact: true }),
  ).toBeInViewport();
  await jump(page, 998);
  await jump(page, 25);
  await expect(page.getByAltText("第 25 页", { exact: true })).toBeInViewport();
  expect(
    await page.locator("[data-image-gallery] img").count(),
  ).toBeLessThanOrEqual(12);
  await page.keyboard.press("t");
  await expect(
    page.getByRole("button", { name: "跳到第 25 页", exact: true }),
  ).toBeInViewport();
  expect(await page.locator("[data-overview-index]").count()).toBeLessThan(160);
  await page.keyboard.press("Escape");
  expect(originals).toEqual([]);
});

test("目录隔离背景并归焦，RTL 右键和键盘菜单绑定命中的页", async ({ page }) => {
  const id = await geometryAlbum(page.request, 9);
  await page.goto(readerUrl(id, "?index=0"));
  const opener = page.getByRole("button", { name: "更多", exact: true });
  await opener.click();
  await page.getByRole("menuitem", { name: /目录/ }).click();
  const dialog = page.getByRole("dialog", { name: "目录" });
  for (const key of ["3", "s", "r", "g"]) await page.keyboard.press(key);
  await expect(dialog).toBeVisible();
  expect(await page.locator("[data-reader-page]").count()).toBe(1);
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await page.keyboard.press("3");
  await jump(page, 2);
  const second = page.locator('[data-reader-page="1"]');
  const file = await second.getAttribute("data-file-id");
  await second.click({ button: "right" });
  const request = page.waitForRequest(
    (r) => r.method() === "PUT" && new URL(r.url()).pathname.endsWith("/cover"),
  );
  await page.getByRole("menuitem", { name: /设为封面/ }).click();
  expect(new URL((await request).url()).searchParams.get("file")).toBe(file);
  await second.focus();
  await second.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: /第 2 页.*图片信息/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(second).toBeFocused();
});

test("缺失尺寸、延迟预览及 404 重试保持活动门禁", async ({ page }) => {
  const id = await geometryAlbum(page.request, 8);
  const list = (
    await (await page.request.get(`/api/albums/${id}/media?limit=10`)).json()
  ).page.items as { id: string }[];
  const target = list[3].id,
    writes: number[] = [];
  await page.addInitScript(() =>
    localStorage.setItem(
      "local-gallery",
      JSON.stringify({
        version: 0,
        state: { mode: "continuous", fit: "width", direction: "ltr" },
      }),
    ),
  );
  await page.route("**/api/albums/*/media*", async (route) => {
    const response = await route.fetch(),
      data = await response.json();
    for (const item of data.page.items) {
      delete item.width;
      delete item.height;
    }
    await route.fulfill({ json: data });
  });
  let fail = true;
  await page.route("**/api/previews/" + target + "*", async (route) => {
    if (fail) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.continue();
  });
  page.on("request", (req) => {
    if (
      req.method() === "PUT" &&
      new URL(req.url()).pathname === "/api/activity"
    )
      writes.push(req.postDataJSON().pageIndex);
  });
  await page.goto(readerUrl(id, "?index=3"));
  const retry = page.getByRole("button", { name: "重试", exact: true });
  await expect(retry).toBeVisible();
  await page.waitForTimeout(700);
  expect(writes).toEqual([]);
  fail = false;
  await retry.click();
  await expect(page.getByAltText("第 4 页", { exact: true })).toBeInViewport();
  await expect.poll(() => writes).toContain(3);
  await page.keyboard.press("f");
  await page.keyboard.press("f");
  const img = page.getByAltText("第 4 页", { exact: true });
  await expect(img).toHaveAttribute("src", new RegExp("/api/media/" + target));
  await expect
    .poll(() =>
      img.evaluate((el: HTMLImageElement) => el.getBoundingClientRect().width),
    )
    .toBeCloseTo(900, 0);
});
