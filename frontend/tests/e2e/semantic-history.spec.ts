import { expect, test, type Page } from "@playwright/test";

function nextSearch(page: Page) {
  return page.waitForRequest(
    (req) =>
      req.method() === "POST" &&
      new URL(req.url()).pathname === "/api/ai/search",
  );
}

test("组合搜索在刷新和前后导航时恢复提交条件", async ({ page }) => {
  await page.goto("/photo/semantic");
  await page.getByRole("button", { name: /高级筛选/ }).click();
  await page.getByLabel("搜索内容").fill("海边");
  await page.getByLabel("拍摄年份").fill("2024");
  await page.getByLabel("仅精选照片").check();
  const submit = page.getByRole("button", { name: "搜索照片" });
  await Promise.all([nextSearch(page), submit.click()]);
  const [restored] = await Promise.all([nextSearch(page), page.reload()]);
  expect(restored.postDataJSON()).toMatchObject({
    ocrText: "海边",
    year: "2024",
    pickedOnly: true,
  });
  await expect(page.getByLabel("仅精选照片")).toBeChecked();
  await page.getByLabel("拍摄年份").fill("2025");
  await Promise.all([nextSearch(page), submit.click()]);
  const [back] = await Promise.all([nextSearch(page), page.goBack()]);
  expect(back.postDataJSON().year).toBe("2024");
  await expect(page.getByLabel("拍摄年份")).toHaveValue("2024");
  const [forward] = await Promise.all([nextSearch(page), page.goForward()]);
  expect(forward.postDataJSON().year).toBe("2025");
});

test("只限定相册时刷新保留相册", async ({ page }) => {
  await page.route("**/api/search?**", (route) =>
    route.fulfill({
      json: {
        ok: true,
        count: 1,
        results: [
          { kind: "album", path: "album-id", name: "测试相册", count: 1 },
        ],
      },
    }),
  );
  await page.goto("/photo/semantic");
  await page.getByRole("button", { name: /高级筛选/ }).click();
  await page.getByPlaceholder("输入相册名搜索").fill("测试");
  await page.getByRole("button", { name: "测试相册" }).click();
  await Promise.all([
    nextSearch(page),
    page.getByRole("button", { name: "搜索照片" }).click(),
  ]);
  const [restored] = await Promise.all([nextSearch(page), page.reload()]);
  expect(restored.postDataJSON()).toMatchObject({ albumId: "album-id" });
  expect(restored.postDataJSON()).not.toHaveProperty("ocrText");
  await expect(page.getByRole("button", { name: /测试相册/ })).toBeVisible();
});
