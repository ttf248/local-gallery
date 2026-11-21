import { ensureLibraryReady, setWorkbenchMode } from "./helpers/library";
import { expect, test } from "@playwright/test";

interface MediaFeedResponse {
  page: { items: { id: string }[] };
}

interface SimilarityGroup {
  id: string;
  kind: "exact";
  folder: string;
  resourceIds: string[];
  members: {
    resourceId: string;
    folder: string;
    albumId: string;
    albumName: string;
    width: number;
    height: number;
    quality: {
      sharpness: number;
      sharpnessScore: number;
      megapixels: number;
      resolutionScore: number;
      exposure: number;
      clippedHigh: number;
      clippedLow: number;
      exposureScore: number;
      score: number;
    };
    distance: number;
    similarity: number;
    score: number;
  }[];
  recommended: string;
  representative: string;
  representativeIsManual: boolean;
  distance: number;
  similarity: number;
  timeSpanMs: number;
  timeSource: string;
  crossFolder: boolean;
  status: "pending";
  redundant: number;
}

const TOTAL_GROUPS = 121;

function makeGroup(index: number, resourceIds: string[]): SimilarityGroup {
  const quality = {
    sharpness: 820,
    sharpnessScore: 0.86,
    megapixels: 12,
    resolutionScore: 0.82,
    exposure: 0.45,
    clippedHigh: 0.02,
    clippedLow: 0.01,
    exposureScore: 0.9,
    score: 0.86,
  };
  const members = resourceIds.map((resourceId) => ({
    resourceId,
    folder: "分页验证",
    albumId: "a_1",
    albumName: "分页验证",
    width: 4000,
    height: 3000,
    quality,
    distance: 0,
    similarity: 1,
    score: 0.86,
  }));
  return {
    id: `pagination-${index + 1}`,
    kind: "exact",
    folder: "分页验证",
    resourceIds,
    members,
    recommended: resourceIds[0],
    representative: resourceIds[0],
    representativeIsManual: false,
    distance: 0,
    similarity: 1,
    timeSpanMs: 0,
    timeSource: "capture",
    crossFolder: false,
    status: "pending",
    redundant: 1,
  };
}

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

    await page.goto("/photo/similarity");
    const firstCard = page.getByTestId("similarity-group").first();
    await expect(firstCard).toBeVisible();
    const selected = firstCard.getByRole("checkbox");
    await selected.check();
    const selectionBar = page.getByTestId("similarity-batch-bar");
    await expect(selectionBar).toContainText("已选 1 组");

    await page.getByRole("button", { name: /再显示 60 组/ }).click();
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
