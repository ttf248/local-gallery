import { ensureLibraryReady } from "./helpers/library";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { mkdirSync } from "node:fs";
import type { StatePreview } from "../../src/api/stateBackup";

async function restore(
  request: APIRequestContext,
  backup: unknown,
  categories: string[],
) {
  const preview = (await (
    await request.post("/api/admin/state/import/preview", { data: { backup } })
  ).json()) as StatePreview;
  const response = await request.post("/api/admin/state/import", {
    data: {
      backup,
      categories,
      versions: preview.versions,
      libraryRevision: preview.libraryRevision,
    },
  });
  expect(response.ok()).toBeTruthy();
}

test("照片多选支持键盘、排序保留和失败重试，搜索草稿不影响选择", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  const backup: unknown = await (
    await request.get("/api/admin/state/export")
  ).json();
  try {
    // 照片侧首页那一块换成智能相册，不再列相册卡片；多选在标签页验证
    // —— 那里仍列带这个标签的相册。
    await page.goto(`/photo/tags/${encodeURIComponent("测试")}`);
    await page.getByRole("button", { name: "选择", exact: true }).click();
    // 同名条目可来自不同目录。记住实际资源 ID，排序后验证同一张卡。
    const firstAlbum = page.getByRole("checkbox", { name: /tagged-A”$/ }).first();
    await expect(firstAlbum).toBeVisible();
    const resourceId = await firstAlbum.getAttribute("data-resource-id");
    expect(resourceId).toBeTruthy();
    const card = page.locator(`[role="checkbox"][data-resource-id="${resourceId}"]`);
    await card.click();
    await expect(card).toHaveAttribute("aria-checked", "true");
    await expect(page).toHaveURL(/\/photo\/tags\//);
    await card.press("Space");
    await expect(card).toHaveAttribute("aria-checked", "false");
    await card.press("Space");
    await expect(
      page.getByRole("button", { name: "标记已读", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "排序", exact: true }).click();
    await page.getByRole("button", { name: "按最近改", exact: true }).click();
    await expect(
      card,
    ).toHaveAttribute("aria-checked", "true");
    let fail = true;
    await page.route("**/api/favorites/batch", async (route) => {
      if (fail)
        await route.fulfill({
          status: 500,
          json: { code: "test_error", message: "unavailable" },
        });
      else await route.continue();
    });
    await page.getByRole("button", { name: "批量收藏", exact: true }).click();
    await expect(
      page.getByText("批量操作失败，请重试。", { exact: true }),
    ).toBeVisible();
    await expect(card).toHaveAttribute("aria-checked", "true");
    fail = false;
    await page.getByRole("button", { name: "批量收藏", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "选择", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page
      .getByRole("button", { name: "选择已加载项", exact: true })
      .click();
    mkdirSync(".smoke/roadmap-batch", { recursive: true });
    for (const theme of ["浅色", "深色"]) {
      await page.getByRole("button", { name: /^外观 ·/ }).click({button:"right"});
      await page
        .getByRole("menuitemradio", { name: theme, exact: true })
        .click();
      for (const width of [390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        await page
          .getByRole("button", { name: "批量收藏", exact: true })
          .scrollIntoViewIfNeeded();
        await page.screenshot({
          path: `.smoke/roadmap-batch/${theme}-${width}.png`,
        });
      }
    }
    await page.getByRole("button", { name: "打开命令面板" }).click();
    const searchDraft = page.getByRole("combobox");
    await searchDraft.fill("zz-没有这样的相册");
    await expect(searchDraft).toHaveValue("zz-没有这样的相册");
    await expect(page).toHaveURL(/\/photo\/tags\//);
    await page.keyboard.press("Escape");
    await expect(searchDraft).toHaveValue("");
    await page.keyboard.press("Escape");
    await expect(card).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("button", { name: "批量收藏", exact: true }),
    ).toBeVisible();
  } finally {
    await restore(request, backup, ["favorites"]);
  }
});

test("漫画批量已读与重置只修改所选阅读活动", async ({ page, request }) => {
  await ensureLibraryReady(request);
  const backup: unknown = await (
    await request.get("/api/admin/state/export")
  ).json();
  try {
    await page.goto("/comic/library?q=sample-comic");
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page
      .getByRole("button", { name: "选择已加载项", exact: true })
      .click();
    const marked = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/activity/batch" &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "标记已读", exact: true }).click();
    expect((await marked).ok()).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "选择", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page
      .getByRole("button", { name: "选择已加载项", exact: true })
      .click();
    const reset = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/activity/batch" &&
        response.request().method() === "DELETE",
    );
    await page.getByRole("button", { name: "重置未读", exact: true }).click();
    expect((await reset).ok()).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "选择", exact: true }),
    ).toBeVisible();
  } finally {
    await restore(request, backup, ["activities"]);
  }
});

for (const view of ["网格视图", "列表视图"] as const) {
  test(`选择模式 ${view} 长列表滚动与宽度切换无崩溃`, async ({
    page,
    request,
  }) => {
    await ensureLibraryReady(request);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/comic/library?q=long-list");
    await page.getByRole("button", { name: view, exact: true }).click();
    await page.getByRole("button", { name: "选择", exact: true }).click();
    await page
      .getByRole("button", { name: "选择已加载项", exact: true })
      .click();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const main = page.locator("main");
      await expect(async () => {
        await main.evaluate((element) => { element.scrollTop = element.scrollHeight; });
        await expect(page.getByRole("checkbox", { name: /long-list-108/ })).toBeInViewport({timeout: 500});
      }).toPass({timeout: 10_000});
      await main.evaluate((element) => { element.scrollTop = 0; });
      await expect(
        page.getByRole("checkbox", { name: /long-list-001/ }),
      ).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
}
