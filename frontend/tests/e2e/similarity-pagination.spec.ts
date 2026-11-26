import {makeGroup} from "./helpers/similarityGroup";
import { ensureLibraryReady, setWorkbenchMode } from "./helpers/library";
import { expect, test } from "@playwright/test";

interface MediaFeedResponse {
  page: { items: { id: string }[] };
}

type SimilarityGroup=ReturnType<typeof makeGroup>;
const TOTAL_GROUPS=121;
function response(groups: SimilarityGroup[]) {
  return {
    ok: true,
    page: {
      revision: 1,
      total: TOTAL_GROUPS,
      groups,
      folders: [
        { folder: "分页验证", groups: TOTAL_GROUPS, photos: TOTAL_GROUPS * 2 },
      ],
      summary: {
        exact: TOTAL_GROUPS,
        near: 0,
        burst: 0,
        pending: TOTAL_GROUPS,
        reviewed: 0,
        ignored: 0,
        photos: TOTAL_GROUPS * 2,
        redundant: TOTAL_GROUPS,
      },
      stale: false,
      limited: false,
    },
  };
}

for (const failure of ["500", "断网"] as const) {
  test(`相似整理后续分页${failure}后保留选择并手动恢复`, async ({
    page,
    request,
  }) => {
    await ensureLibraryReady(request);
    await setWorkbenchMode(request, "photo");
    const mediaResponse = await request.get(
      "/api/library/media-feed?kind=photo&scope=timeline&media=photo",
    );
    const media = (await mediaResponse.json()) as MediaFeedResponse;
    const resourceIds = media.page.items.slice(0, 2).map((item) => item.id);
    expect(resourceIds).toHaveLength(2);

    const offsets: number[] = [];
    let failedAttempts = 0;
    await page.route("**/api/similarity/groups**", async (route) => {
      const url = new URL(route.request().url());
      const offset = Number(url.searchParams.get("offset") ?? 0);
      offsets.push(offset);

      if (offset === 60 && failedAttempts < 4) {
        failedAttempts += 1;
        if (failure === "500") {
          await route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify({
              ok: false,
              error: { code: "internal_error", message: "server error" },
            }),
          });
        } else {
          await route.abort("failed");
        }
        return;
      }

      const groups = Array.from(
        { length: Math.min(60, TOTAL_GROUPS - offset) },
        (_, index) => makeGroup(offset + index, resourceIds),
      );
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(response(groups)),
      });
    });

    await page.goto("/photo/similarity?view=grid");
    const firstCard = page.getByTestId("similarity-group").first();
    await expect(firstCard).toBeVisible();
    const selected = firstCard.getByRole("checkbox");
    await selected.check();
    const selectionBar = page.getByTestId("similarity-batch-bar");
    await expect(selectionBar).toContainText("已选 1 组");

    await page.locator("main").evaluate((element) => { element.scrollTop = element.scrollHeight; });
    await expect(
      page.getByText("后续分组读取失败，已加载的分组仍可整理。"),
    ).toBeVisible({ timeout: 20_000 });
    // 分组列表按窗口虚拟化：检查批量栏的选择计数，不绑定当前可见的卡片。
    await expect(selectionBar).toContainText("已选 1 组");

    const attemptsAtError = offsets.filter((offset) => offset === 60).length;
    expect(attemptsAtError).toBeGreaterThan(0);
    await page.waitForTimeout(800);
    expect(offsets.filter((offset) => offset === 60)).toHaveLength(
      attemptsAtError,
    );

    await page.getByRole("button", { name: "重试加载" }).click();
    await expect(page.getByRole("button", { name: /还有 1 组/ })).toBeVisible();
    await expect(selectionBar).toContainText("已选 1 组");
    expect(offsets.filter((offset) => offset === 60)).toHaveLength(
      attemptsAtError + 1,
    );
  });
}
