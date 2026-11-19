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


test("顶栏搜索回车进入可见的结果页", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const target = nodes.find((node) => node.name);
  expect(target).toBeTruthy();
  const keyword = (target!.name ?? "").slice(0, 4);
  expect(keyword.length).toBeGreaterThan(0);

  await page.goto("/photo");
  const search = page.getByRole("combobox");
  await search.fill(keyword);
  // 下拉给出明确的匹配建议。
  await expect(page.getByRole("option").first()).toBeVisible({ timeout: 10_000 });
  await search.press("Enter");

  // 回车落到结果页，而不是回到一个不显示结果的首页。
  await expect(page).toHaveURL(/\/photo\/search\?q=/);
  await expect(
    page.getByRole("heading", { name: new RegExp(`搜索结果`) }),
  ).toBeVisible();
  await expect(page.getByText(/共 \d+ 项/).first()).toBeVisible();
  // 结果上写着类型与来源。
  await expect(page.getByTestId("album-card").first()).toBeVisible();

  // 打开一个结果，进的是它自己的相册。
  const card = page.getByTestId("album-card").first();
  await card.getByRole("link").first().click();
  await expect(page).toHaveURL(/\/photo\/albums\/|\/photo\/tags\//);
});

test("搜索无结果时说清没有匹配", async ({ page }) => {
  await page.goto("/photo/search?q=zzz-不存在的名字-zzz");
  await expect(page.getByText(/没有匹配/)).toBeVisible();
});
