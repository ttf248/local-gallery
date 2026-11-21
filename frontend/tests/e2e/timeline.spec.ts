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

/**
 * 首屏读不出来：说清是哪一类失败，并给一个重试的手柄。
 */
test("时间线首屏失败时给出清楚的错误信息与重试按钮", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  let failing = true;
  await page.route("**/api/library/media-feed**", async (route) => {
    if (failing) {
      await route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ ok: false, message: "服务端出错了" }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/photo");
  await expect(
    page.getByRole("heading", { name: "时间线加载失败" }),
  ).toBeVisible();
  await expect(
    page.getByText("服务端读取时间线时出错了，稍后重试。"),
  ).toBeVisible();

  // 服务端恢复之后重试：照片就回来了。
  failing = false;
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.getByTestId("timeline-group-header").first()).toBeVisible();
});

/**
 * 断网是另一回事：说的是网络没连上，不是服务端出错。
 */
test("断网时说的是网络没有连上", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.route("**/api/library/media-feed**", (route) =>
    route.abort("failed"),
  );

  await page.goto("/photo");
  await expect(
    page.getByRole("heading", { name: "时间线加载失败" }),
  ).toBeVisible();
  await expect(
    page.getByText("网络没有连上，检查连接后重试。"),
  ).toBeVisible();
});

/**
 * 后续分页失败：已加载的照片仍然能翻，失败的是没取到的那一段。
 */
test("后续分页失败时保留已加载的照片，并给出可恢复的提示", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  let cursorRequests = 0;
  let failing = true;
  await page.route("**/api/library/media-feed**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor")) {
      cursorRequests += 1;
      if (failing) {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ ok: false, message: "服务端出错了" }),
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/photo");
  await expect(page.getByTestId("timeline-group-header").first()).toBeVisible();

  // 滚到已加载的末尾：自动接下一页，那一页失败。
  await page
    .locator("[data-virtuoso-scroller]")
    .first()
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await expect(page.getByRole("alert")).toContainText(
    "后续照片加载失败，已加载的照片仍可浏览。",
  );
  // 已加载的照片还在墙上（滚到底之后看到的是最后一段）。
  await expect(
    page.locator("main [data-virtuoso-scroller] button[aria-label^='查看'], main [data-virtuoso-scroller] button[aria-label^='播放']").first(),
  ).toBeVisible();

  // 失败状态下不再自动续页：否则失败一次接一次，成了无限请求。
  const failed = cursorRequests;
  await page.waitForTimeout(1500);
  expect(cursorRequests).toBe(failed);

  // 服务端恢复之后重试：从正确的游标继续，已加载的不重复也不丢。
  failing = false;
  await page.getByRole("button", { name: "重试加载" }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
});

/**
 * 游标失效：库变了，这一页的位置已经不对了，重试它没有意义。
 */
test("游标失效时说清要从头重取", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.route("**/api/library/media-feed**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor")) {
      await route.fulfill({
        status: 409,
        contentType: "application/json",
        body: JSON.stringify({
          ok: false,
          code: "stale_cursor",
          message: "library changed; restart pagination",
        }),
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/photo");
  await expect(page.getByTestId("timeline-group-header").first()).toBeVisible();
  await page
    .locator("[data-virtuoso-scroller]")
    .first()
    .evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
  await expect(page.getByRole("alert")).toContainText(
    "媒体库刚刚变了，这一页的位置已经失效。重新加载会从头开始。",
  );
});
