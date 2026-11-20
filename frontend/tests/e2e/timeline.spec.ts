import { expect, test } from "@playwright/test";
import {
  resetNavItems,
  resetWorkbenchMode,
  scannedNodes,
} from "./helpers/library";

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});

/**
 * 时间线是这个工作台的第一屏。
 *
 * 它要回答的是「这段时间是什么时候」以及「这段时间是怎么来的」——
 * 后者尤其重要：从文件名或目录名推断出来的日期不是拍摄时间，界面上
 * 必须照实说。
 */
test("照片首页就是时间线：按日期精度分段，来源照实说", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo");

  await expect(page.getByRole("heading", { name: "按时间浏览" })).toBeVisible();
  const headers = page.getByTestId("timeline-group-header");
  await expect(headers.first()).toBeVisible();
  await expect(headers.first()).toContainText("年");
  await expect(headers.first()).toContainText("月");
  const legend = page.getByTestId("timeline-source-legend");
  await expect(legend).toBeVisible();
  await expect(legend).toContainText("张");
  await expect(page.getByTestId("timeline-precision-legend")).toContainText(
    "仅年份",
  );
});

test("年份与年月目录保留原精度，不补出一月或某一天", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");

  await page.goto("/photo?year=2018");
  const yearHeader = page.getByTestId("timeline-group-header").first();
  await expect(yearHeader).toContainText("2018 年");
  await expect(yearHeader).not.toContainText("1 月");
  await expect(page.getByTestId("timeline-precision-legend")).toContainText(
    "仅年份 1 张",
  );

  await page.goto("/photo?year=2019");
  const monthHeader = page.getByTestId("timeline-group-header").first();
  await expect(monthHeader).toContainText("2019 年 11 月");
  await expect(monthHeader).not.toContainText("11 月 1 日");
  await expect(page.getByTestId("timeline-precision-legend")).toContainText(
    "仅年月 1 张",
  );
});

/**
 * 跳年、跳月与照片 / 视频的筛选都写进地址栏。
 *
 * 跳过去是一个能分享、能后退的地址，而不是一次回不去的操作。
 */
test("跳年与跳月写进地址栏，刷新与后退都还在原地", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo");

  const year = page.getByLabel("年份");
  await expect(year).toBeVisible();
  await year.selectOption("2024");
  await expect(page).toHaveURL(/\?year=2024$/);

  await page.reload();
  await expect(page.getByLabel("年份")).toHaveValue("2024");

  const month = page.getByLabel("月份");
  await expect(month).toBeVisible();
  await month.selectOption({ index: 1 });
  await expect(page).toHaveURL(/year=2024&month=/);

  await page.goBack();
  await expect(page).toHaveURL(/\?year=2024$/);
});

/**
 * 没有拍摄证据的媒体仍然可达，而且不冒充某一年。
 *
 * 它们单独成一段，标题说清「只有文件修改时间，不是拍摄时间」。
 */
test("日期未知的媒体单独成段，不混进任何一年", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo");

  await page.getByLabel("年份").selectOption("unknown");
  await expect(page).toHaveURL(/\?year=unknown$/);
  const header = page.getByTestId("timeline-group-header").first();
  await expect(header).toBeVisible();
  await expect(header).toContainText("日期未知");
  await expect(page.getByTestId("timeline-group-note").first()).toContainText(
    "只有文件修改时间，不是拍摄时间",
  );
});

/**
 * 大图预览：左右翻、回到来源相册、Esc 退出后位置还原。
 */
test("时间线上的照片能左右翻、能回到来源相册，退出后位置还原", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo");

  const scroller = page.locator("main [data-virtuoso-scroller]");
  const tile = scroller.getByRole("button", { name: /^查看 / }).first();
  await expect(tile).toBeVisible({ timeout: 20_000 });
  await tile.click();

  const viewer = page.getByRole("dialog", { name: /大图预览/ });
  await expect(viewer).toBeVisible();
  // 标题是来源相册，点它就回到那本相册。
  const source = viewer.getByRole("link");
  await expect(source).toBeVisible();
  const href = await source.getAttribute("href");
  expect(href).toMatch(/^\/photo\/albums\//);

  // 左右翻：位置读数往前走。
  await expect(viewer.getByText(/第 1 张/)).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(viewer.getByText(/第 2 张/)).toBeVisible();

  // Esc 退出：墙回到刚才看的那一张。
  await page.keyboard.press("Escape");
  await expect(viewer).toBeHidden();
  await expect(
    scroller.getByRole("button", { name: /^查看 / }).first(),
  ).toBeVisible();
});

/**
 * 照片与视频可以分开看。
 */
test("只看视频时时间线只留视频", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo");

  await page.getByRole("button", { name: "视频", exact: true }).click();
  await expect(page).toHaveURL(/\?media=video$/);
  const videos = page.locator(
    'main [data-virtuoso-scroller] button[aria-label^="播放"]',
  );
  const photos = page.locator(
    'main [data-virtuoso-scroller] button[aria-label^="查看"]',
  );
  await expect
    .poll(async () => (await videos.count()) + (await photos.count()), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
  expect(await photos.count()).toBe(0);
});
