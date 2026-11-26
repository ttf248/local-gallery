import { expect, test } from "@playwright/test";
import {
  resetNavItems,
  resetWorkbenchMode,
  scannedNodes,
} from "./helpers/library";

/**
 * 名称搜索的验收用例。
 *
 * 回车必须落在**看得见结果**的那一页：以前它只是把关键词塞进地址再回首页，
 * 而首页那一段是智能相册预览，搜到的相册被一片不相关的推荐盖住了。
 */

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});


test("命令面板回车进入可见的结果页", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const target = nodes.find((node) => node.name === "sample-album");
  expect(target).toBeTruthy();
  const keyword = (target!.name ?? "").slice(0, -1);
  expect(keyword.length).toBeGreaterThan(0);

  await page.goto("/photo");
  // 顶栏搜索框：照片首页上还有年份 / 月份两个下拉，它们也是 combobox，
  // 这里要认准搜索框本身。
  await page.getByRole("button", { name: "打开命令面板" }).click();
  const search = page.getByRole("combobox", { name: "搜索相册或标签" });
  await search.fill(keyword);
  // 下拉给出明确的匹配建议。
  await expect(page.getByRole("group", { name: "匹配内容" }).getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");

  // 回车落到结果页，而不是回到一个不显示结果的首页。
  await expect(page).toHaveURL(/\/photo\/search\?q=/);
  await expect(
    page.getByRole("searchbox", { name: "搜索" }),
  ).toHaveValue(keyword);
  await expect(page.getByText(/共 \d+ 项/).first()).toBeVisible();
  // 结果上写着类型与来源。
  await expect(page.getByTestId("album-card").first()).toBeVisible();

  // 打开一个结果，进的是它自己的相册。
  const card = page.getByTestId("album-card").first();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/photo\/albums\/|\/photo\/tags\//);
});

test("全局搜索草稿不覆盖列表筛选，回退后返回原列表地址", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  const listUrl = "/photo/library?q=list-filter-kept&min=2";
  await page.goto(listUrl);
  await page.getByRole("button", { name: "打开命令面板" }).click();
  const search = page.getByRole("combobox");
  await expect(search).toHaveValue("");

  await search.fill("new-search-draft");
  await expect(page).toHaveURL(listUrl);
  await search.press("Enter");
  await expect(page).toHaveURL("/photo/search?q=new-search-draft&scope=name");

  await page.goBack();
  await expect(page).toHaveURL(listUrl);
  await page.keyboard.press("Control+k");
  await expect(search).toHaveValue("");
});

test("搜索无结果时说清没有匹配", async ({ page }) => {
  await page.goto("/photo/search?q=zzz-不存在的名字-zzz");
  await expect(page.getByText(/没有匹配/)).toBeVisible();
});

test("搜索超过一页时显示总数并可继续加载", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo/search?q=zz-search-load-more");

  await expect(page.getByText("显示 100 / 105 项", { exact: true })).toBeVisible();
  const loadMore = page.getByRole("button", { name: /加载更多/ });
  await expect(loadMore).toBeVisible();
  await loadMore.click();

  await expect(page.getByText("共 105 项", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /加载更多/ }),
  ).toHaveCount(0);
});


test("Ctrl+K 与斜杠打开命令面板并归还触发焦点", async ({ page }) => {
  await page.goto("/photo");
  const trigger = page.getByRole("button", { name: "打开命令面板" });
  await trigger.focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "命令面板" });
  const search = palette.getByRole("combobox");
  await expect(search).toBeFocused();
  await expect(page.locator("#root")).toHaveAttribute("inert", "");
  await search.fill("测试");
  await page.keyboard.press("Escape");
  await expect(search).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
});


test("首页搜索在窄屏和键盘占位下保留输入、范围和可滚动的命令", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 700 });
  await page.goto("/photo");
  const trigger = page.getByRole("button", { name: "打开命令面板" });
  await trigger.click();
  const panel = page.getByRole("dialog", { name: "命令面板" });
  await panel.getByRole("combobox").waitFor();
  await page.evaluate(() =>
    document.documentElement.style.setProperty("--keyboard-inset", "310px"),
  );
  const scope = panel.getByRole("radio", { name: "画面与文字" });
  const input = panel.getByRole("combobox");
  const field = await input.boundingBox();
  const radio = await scope.boundingBox();
  expect(field).toBeTruthy();
  expect(radio!.y).toBeGreaterThanOrEqual(field!.y + field!.height);
  await panel.getByRole("button", { name: "快捷操作" }).click();
  const box = await panel.boundingBox();
  expect(box!.y + box!.height).toBeLessThanOrEqual(390);
  const results = panel.getByRole("listbox");
  expect(
    await results.evaluate((el) => el.scrollHeight > el.clientHeight),
  ).toBe(true);
  await scope.click();
  await expect(input).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
});
