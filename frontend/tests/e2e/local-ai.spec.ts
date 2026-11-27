import { expect, test } from "@playwright/test";

test.describe("本机智能照片功能", () => {
  test("人物分析默认关闭并可前往任务中心", async ({ page }) => {
    await page.goto("/photo/people");
    await expect(page.getByRole("heading", { name: "人物相册" })).toBeVisible();
    await expect(page.getByText("人物分析默认关闭")).toBeVisible();
    const peopleResponse = await page.request.get("/api/people");
    expect(peopleResponse.ok()).toBeTruthy();
    await expect(peopleResponse.json()).resolves.toMatchObject({
      people: [],
      totalGroups: 0,
      limit: 50,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      sort: "photos",
    });
    const peopleSearchResponse = await page.request.get(
      "/api/people?q=%E4%B8%8D%E5%AD%98%E5%9C%A8&limit=20",
    );
    expect(peopleSearchResponse.ok()).toBeTruthy();
    await expect(peopleSearchResponse.json()).resolves.toMatchObject({
      people: [],
      totalGroups: 0,
      limit: 20,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      sort: "photos",
    });
    const reviewResponse = await page.request.get("/api/people?sort=review");
    expect(reviewResponse.ok()).toBeTruthy();
    await expect(reviewResponse.json()).resolves.toMatchObject({
      people: [],
      totalGroups: 0,
      limit: 50,
      sort: "review",
    });
    await page.getByRole("link", { name: "打开任务中心" }).click();
    await expect(page).toHaveURL(/\/settings\/tasks#daily-plan$/);
    await expect(
      page.getByRole("checkbox", { name: "启用人物分析（手动与每日任务共用）" }),
    ).toBeVisible();
  });

  test("Chinese-CLIP 不可用时仍能从智能搜索提交 OCR 条件", async ({ page }) => {
    await page.goto("/photo/semantic");
    await expect(page.getByLabel("搜索相册或标签")).toHaveCount(0);
    const searchInput = page.getByLabel("搜索内容");
    await searchInput.click();
    await expect(searchInput).toBeFocused();
    await searchInput.fill("入口");
    await page.getByRole("button", { name: "搜索照片" }).click();
    // 画面模型没就绪：系统退成只查图片里的文字，零结果要说清是环境
    // 没准备好 —— 用户要的仍是画面，不能写成「库里没有」。
    await expect(page.getByText("画面搜索还没准备好")).toBeVisible();
    await expect(
      page.getByText(/图片里的文字已经查过了，确实没有匹配/),
    ).toBeVisible();
  });
});
