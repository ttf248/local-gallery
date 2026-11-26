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
 * 覆盖三条主链路：命令面板（名称与画面两档）、发现页的人物与地点预览、
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

test("命令面板按名称进结果页，结果带命中理由", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const target = nodes.find((node) => node.name);
  expect(target).toBeTruthy();
  const keyword = (target!.name ?? "").slice(0, 3);
  expect(keyword.length).toBeGreaterThan(0);

  await page.goto("/photo");
  await page.getByRole("button", { name: "打开命令面板" }).click();
  const search = page.getByRole("combobox", { name: "搜索相册或标签" });
  await search.fill(keyword);
  await search.press("Enter");

  await expect(page).toHaveURL(/\/photo\/search\?q=/);
  // 结果页说清搜的是名字。
  await expect(
    page.getByRole("radio", { name: "名称" }),
  ).toBeChecked();
  // 每条结果写明为什么是它。
  await expect(
    page.getByText(/名字(完全相同|以关键词开头|里含有关键词)/).first(),
  ).toBeVisible();
});

test("命令面板可以切到画面与文字，回车进内容结果页", async ({ page }) => {
  await page.goto("/photo");
  await page.getByRole("button", { name: "打开命令面板" }).click();
  await page.getByRole("radio", { name: "画面与文字" }).click();
  const search = page.getByRole("combobox", { name: "搜索照片里的画面与文字" });
  await search.fill("海边");
  await search.press("Enter");

  await expect(page).toHaveURL(/\/photo\/search\?q=.*scope=content/);
  await expect(page.getByRole("radio", { name: "画面与文字" })).toBeChecked();
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
  await expect(page.getByRole("heading", { name: "搜索结果", level: 1 })).toBeVisible();

  await page.getByRole("button", { name: "清除搜索" }).click();

  await expect(page.getByText("还没有搜索")).toBeVisible();
  await expect(page).not.toHaveURL(/q=/);
});

test("发现页首屏给出找法，下面是各维度的紧凑预览", async ({ page }) => {
  await page.goto("/photo/explore");

  await expect(page.getByRole("complementary",{name:"主导航"}).getByRole("button", { name: "打开命令面板" })).toBeVisible();
  await expect(page.getByRole("searchbox")).toHaveCount(0);
  const sections=page.locator("main section[aria-labelledby^='explore-']");
  await expect(sections.getByRole("heading",{level:2})).toHaveText(["人物","地点","时间","主题"]);
  for(const [label,link] of [["人物","全部人物"],["地点","足迹"],["时间","时间线"],["主题","全部主题"]]){
    await expect(page.getByRole("region",{name:label,exact:true}).getByRole("link",{name:link,exact:true})).toBeVisible();
  }
  await page.getByRole("button",{name:"人物说明"}).click();
  await expect(page.getByText(/分组只是复核线索/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/分组只是复核线索/)).toBeHidden();
});

test("从发现的全局搜索提交两种范围，结果页改词后可逐步返回", async ({ page }) => {
  await page.goto("/photo/explore");
  const bar = page.getByTestId("top-bar");
  const input = bar.getByRole("searchbox");
  const trigger = page.getByRole("button", { name: "打开命令面板" });
  const panel = page.getByRole("dialog", { name: "命令面板" });
  await trigger.click();
  await panel.getByRole("combobox").fill("旅行");
  await panel.getByRole("combobox").press("Shift+Enter");
  await expect(page).toHaveURL(/\/photo\/search\?q=/);
  await expect(input).toHaveValue("旅行");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("main").getByRole("radio", { name: "名称" })).toBeChecked();
  await expect(page.getByRole("searchbox")).toHaveCount(1);
  await input.fill("sample-album");
  await input.press("Enter");
  await expect(page.getByTestId("album-card").first()).toBeVisible();
  await page.goBack();
  await expect(input).toHaveValue("旅行");
  await page.goBack();
  await expect(page).toHaveURL("/photo/explore");
  await trigger.click();
  await panel.getByRole("radio", { name: "画面与文字" }).click();
  await panel.getByRole("combobox").fill("南昌");
  await panel.getByRole("combobox").press("Enter");
  await expect(page).toHaveURL(url => url.pathname === "/photo/search" && url.searchParams.get("q") === "南昌" && url.searchParams.get("scope") === "content");
  await expect(input).toHaveValue("南昌");
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
