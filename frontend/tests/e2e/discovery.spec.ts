import { expect, test } from "@playwright/test";
import {
  ensureLibraryReady,
  ensureMetadataReady,
  resetWorkbenchMode,
  scannedNodes,
} from "./helpers/library";

/**
 * 搜索与发现的验收用例。
 *
 * 覆盖三条主链路：顶栏搜索（名称与画面两档）、发现页的人物与地点预览、
 * 以及这些预览点进去之后的深链。
 *
 * 临时库里没有跑过人脸分析（`peopleEnabled: false`，素材是纯色图），
 * 因此人物这一档验的是**诚实**：说清还没分析、给下一步，而不是摆一张
 * 假装有人的卡。已命名与候选分组的分区由前端用例覆盖。
 */

test.beforeEach(async ({ request }) => {
  test.setTimeout(180_000);
  await resetWorkbenchMode(request);
  await ensureLibraryReady(request);
});

/**
 * 带坐标的那几本相册。
 *
 * 坐标来自这些相册里的 EXIF：只分析它们，临时库里其余照片仍留着「未分析」
 * 的状态 —— 后面的用例要验「缺分析时给补分析的入口」，得有料可缺。
 */
async function gpsAlbumIds(
  request: Parameters<typeof ensureLibraryReady>[0],
): Promise<string[]> {
  const nodes = await scannedNodes(request, "photo");
  return nodes
    .filter((node) => node.name.includes("足迹"))
    .map((node) => node.id);
}

test("顶栏搜索按名称进结果页，结果带命中理由", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const target = nodes.find((node) => node.name);
  expect(target).toBeTruthy();
  const keyword = (target!.name ?? "").slice(0, 3);
  expect(keyword.length).toBeGreaterThan(0);

  await page.goto("/photo");
  const search = page.getByRole("combobox", { name: "搜索相册或标签" });
  await search.fill(keyword);
  await search.press("Enter");

  await expect(page).toHaveURL(/\/photo\/search\?q=/);
  // 结果页说清搜的是名字。
  await expect(
    page.getByText("正在搜相册、文件夹与标签的名字"),
  ).toBeVisible();
  // 每条结果写明为什么是它。
  await expect(
    page.getByText(/名字(完全相同|以关键词开头|里含有关键词)/).first(),
  ).toBeVisible();
});

test("顶栏搜索可以切到画面与文字，回车进内容结果页", async ({ page }) => {
  await page.goto("/photo");
  const scope = page.getByRole("button", { name: /搜索范围/ });
  await scope.click();
  await page.getByRole("menuitemradio", { name: /画面/ }).click();

  const search = page.getByRole("combobox", { name: "搜索照片里的画面与文字" });
  await search.fill("海边");
  await search.press("Enter");

  await expect(page).toHaveURL(/\/photo\/search\?q=.*scope=content/);
  await expect(page.getByText("正在搜照片里的画面与图片文字")).toBeVisible();
  // 临时库没建过画面索引：零结果要说清是索引没准备好，而不是「没有匹配」。
  await expect(
    page.getByText(/还没有建立画面索引|画面搜索还没准备好/),
  ).toBeVisible();
});

/**
 * 名称结果按命中理由分组。
 *
 * 临时库里有 105 本 `zz-search-load-more-*` 的相册，它们都是同一种命中
 * 理由（名字以关键词开头）。理由因此只出现一次 —— 当分组标题，而不是在
 * 一百张卡上把同一句话重复一百遍。
 */
test("名称结果按命中理由分组，理由不写在每张卡上", async ({ page }) => {
  await page.goto("/photo/search?q=zz-search-load-more");

  const heading = page.getByRole("heading", {
    name: /名字(完全相同|以关键词开头|里含有关键词|标签命中|归属路径里含有关键词)/,
  });
  await expect(heading.first()).toBeVisible();
  await expect(heading).toHaveCount(1);
  // 卡片本身还在：理由成了标题，结果没有少。
  await expect(page.getByTestId("album-card").first()).toBeVisible();
});

test("搜索结果页能清除条件回到空态", async ({ page }) => {  await page.goto("/photo/search?q=旅行");
  await expect(page.getByRole("heading", { name: /搜索结果/ })).toBeVisible();

  await page.getByRole("button", { name: "清除条件" }).click();

  await expect(page.getByText("还没有搜索")).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);
});

test("发现页首屏给出找法，下面是各维度的紧凑预览", async ({ page }) => {
  await page.goto("/photo/explore");

  // 首屏：搜索入口 + 四个维度。
  // 找法就是那条输入框本身：页面上不再另起一个标题把同一件事说两遍。
  await expect(page.getByRole("textbox", { name: "搜索" })).toBeVisible();
  const nav = page.getByRole("navigation", { name: "发现维度" });
  for (const label of ["时间", "人物", "地点", "主题"]) {
    await expect(nav.getByRole("link", { name: label })).toBeVisible();
  }
  // 四个维度依次给出紧凑预览。
  await expect(page.getByRole("heading", { name: "时间" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "人物" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "地点" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "主题" })).toBeVisible();
});

test("发现页的搜索入口进的是搜索结果页", async ({ page }) => {
  await page.goto("/photo/explore");

  await page.getByRole("textbox", { name: "搜索" }).fill("旅行");
  await page.getByRole("button", { name: "搜索", exact: true }).click();

  await expect(page).toHaveURL(/\/photo\/search\?q=/);
});

test("人物这一档没有分析结果时说清原因，不摆假卡", async ({ page }) => {
  await page.goto("/photo/explore");

  // 临时库没跑过人脸分析：这一档要说清没分析，并给下一步。
  const people = page.getByRole("region", { name: "人物" });
  await expect(people.getByText(/人物分析尚未启用/)).toBeVisible();
  await expect(people.getByRole("link", { name: "打开任务中心" })).toBeVisible();
  // 也没有把分组说成已确认的人。
  await expect(people.getByText(/已命名/)).toHaveCount(0);
});

test("人物页深链可用，没分析时给出去哪开启的入口", async ({ page }) => {
  await page.goto("/photo/people");

  await expect(page.getByText("人物分析默认关闭")).toBeVisible();
  await expect(page.getByRole("link", { name: "打开任务中心" })).toBeVisible();
});

test("地点预览列出能点进详情的城市", async ({ page, request }) => {
  await ensureMetadataReady(request, await gpsAlbumIds(request));
  await page.goto("/photo/explore");

  const places = page.getByRole("region", { name: "地点" });
  const place = places.getByRole("link", { name: /杭州市|上海市|北京市/ }).first();
  await expect(place).toBeVisible();
  // 地点卡片用真实的地理照片当画面，不是一块空白占位。
  await expect(place.locator("img")).toBeVisible();
  await place.click();

  await expect(page).toHaveURL(/\/photo\/travels\/place\/\d+/);
  // 地点详情是这一段的规范地址：标题与照片都在。
  await expect(page.locator("h1").first()).toContainText(/杭州|上海|北京/);
});

test("足迹深链仍然可用", async ({ page, request }) => {
  await ensureMetadataReady(request, await gpsAlbumIds(request));
  await page.goto("/photo/travels");

  await expect(page.getByRole("radiogroup", { name: "时间跨度" })).toBeVisible();
  // 临时库里的坐标落在三个城市：小地图上就有三个点。
  await expect(page.locator(".travel-mini-map__point")).toHaveCount(3);
});
