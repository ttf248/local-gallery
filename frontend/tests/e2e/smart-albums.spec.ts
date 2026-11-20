import { expect, test, type APIRequestContext } from "@playwright/test";
import { albumUrl, resetWorkbenchMode, scannedNodes } from "./helpers/library";

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
});

/** 跑一次当前相册的元数据分析并等它跑完：拍摄时间与坐标都从 EXIF 来。 */
async function analyzeMetadata(request: APIRequestContext, albumId: string) {
  const started = await request.post("/api/ai/jobs", {
    data: { type: "metadata", mode: "incremental", albumId },
  });
  expect(started.ok()).toBeTruthy();
  const { job } = (await started.json()) as { job: { id: string } };
  await expect
    .poll(async () => {
      const response = await request.get("/api/ai/jobs");
      if (!response.ok()) return "";
      const body = (await response.json()) as {
        snapshot: { jobs: Array<{ id: string; status: string }> };
      };
      return (
        body.snapshot.jobs.find((item) => item.id === job.id)?.status ?? ""
      );
    })
    .toBe("completed");
}

test("主题归发现页，照片首页不再摆主题预览", async ({ page }) => {
  await scannedNodes(page.request, "photo");

  // 照片首页是时间线：主题那一节搬去发现页，首页不再摆它。
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "按时间浏览" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "主题", exact: true }),
  ).toHaveCount(0);

  // 发现页的主题一节再通向专页：主题墙的完整形态在那儿。
  await page.goto("/photo/explore");
  await expect(
    page.getByRole("link", { name: "全部主题", exact: true }),
  ).toHaveAttribute("href", "/photo/smart-albums");
});

test("专页只展示精选推荐：旧分类深链被规范化，页面上没有分类页签", async ({
  page,
}) => {
  await scannedNodes(page.request, "photo");
  const requested: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/smart-albums")) {
      requested.push(req.url());
    }
  });

  // 旧的分类深链落到专页上，地址栏里的分类参数被去掉。
  await page.goto("/photo/smart-albums?dimension=time");
  await expect(page).toHaveURL(/\/photo\/smart-albums$/);
  await expect(page.getByRole("tab")).toHaveCount(0);

  // 请求的维度固定是精选推荐，不会按 URL 里的旧分类去取。
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  expect(requested.every((url) => url.includes("dimension=recommended"))).toBe(
    true,
  );
});

test("专页顶部能切换排序，排序写进地址栏并跟着请求", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  const requested: string[] = [];
  page.on("request", (req) => {
    if (req.url().includes("/api/smart-albums")) {
      requested.push(req.url());
    }
  });

  await page.goto("/photo/smart-albums");
  // 默认按时间倒序：这一页只有一个排序控件。
  await expect(page.getByRole("radio", { name: "时间最新" })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect.poll(() => requested.length).toBeGreaterThan(0);
  expect(requested[0]).toContain("sort=time");

  await page.getByRole("radio", { name: "照片最多" }).click();
  await expect(page).toHaveURL(/sort=photos/);
  await expect
    .poll(() => requested.filter((url) => url.includes("sort=photos")).length)
    .toBeGreaterThan(0);
});

test("相册内的分组封面按原比例摆：照片不裁成方形，也不被拉变形", async ({
  page,
}) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();
  await analyzeMetadata(page.request, album!.id);

  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "按分组浏览" }).click();
  await page.getByRole("tab", { name: "按时间" }).click();

  // 素材库里的照片是 64×48 的横图（4:3），不是方图。
  const cover = page.getByTestId("smart-album-cover-photo").first();
  await expect(cover).toBeVisible();
  const box = await cover.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { width: rect.width, height: rect.height };
  });
  // 照片按原比例摆：渲染出来的比例还是 4:3。旧做法是把照片裁成方形，
  // 元素盒就会是 1:1 —— 这里是两者的分界。
  expect(box.width / box.height).toBeCloseTo(64 / 48, 2);
  // 照片没有铺满方槽：至少有一边留给了虚化底。
  const slot = await page
    .locator('[data-testid="smart-album-cover"]')
    .first()
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    });
  expect(box.width < slot.width || box.height < slot.height).toBe(true);
});

test("缺少的维度可只为当前相册排入所需的增量分析", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-capture-date");
  expect(album).toBeDefined();

  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "按分组浏览" }).click();
  await page.getByRole("tab", { name: "按时间" }).click();
  // 分析口径收在按需展开的说明里。
  await page.getByRole("button", { name: "分析说明" }).click();
  await expect(page.getByText("未分析 1 张")).toBeVisible();

  const startResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/ai/jobs") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "补充EXIF 元数据分析" }).click();
  const { job } = (await (await startResponse).json()) as {
    job: { id: string; albumId: string };
  };
  expect(job.albumId).toBe(album!.id);

  await expect
    .poll(async () => {
      const response = await page.request.get(
        `/api/ai/jobs/${encodeURIComponent(job.id)}`,
      );
      if (!response.ok()) return "missing";
      const body = (await response.json()) as { status: string };
      return body.status;
    })
    .toBe("completed");
  await expect(page.getByText("分析覆盖 1/1")).toBeVisible();
});

test("在当前相册按拍摄日期分组并用照片墙打开成员", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();
  await analyzeMetadata(page.request, album!.id);

  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "按分组浏览" }).click();
  await page.getByRole("tab", { name: "按时间" }).click();
  const group = page.getByRole("button", { name: /^2024年5月2日/ });
  await expect(group).toBeVisible();

  await page.getByRole("tab", { name: "按地点" }).click();
  // 地点这一维里有一组 5 张：「全部照片」那一条不算。
  await expect(
    page
      .getByTestId("album-group-list")
      .getByRole("button", { name: /5 张/ })
      .filter({ hasNotText: "全部照片" }),
  ).toBeVisible();

  // 分析口径收在按需展开的说明里：展开一次，后面换维度都还在。
  await page.getByRole("button", { name: "分析说明" }).click();
  for (const dimension of ["按人物", "按场景"]) {
    await page.getByRole("tab", { name: dimension }).click();
    await expect(page.getByText("分析覆盖 0/5")).toBeVisible();
    await expect(page.getByText("未分析 5 张")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "还没有可展示的分组" }),
    ).toBeVisible();
  }

  await page.getByRole("tab", { name: "按时间" }).click();
  await expect(group).toBeVisible();
  await group.click();

  const wall = page.locator("[data-virtuoso-scroller]");
  await expect(wall.getByRole("button", { name: /查看 .*\.jpg/ })).toHaveCount(
    3,
  );
  // 恢复入口：回到全部照片。
  await expect(
    page.getByRole("button", { name: "回到全部照片" }),
  ).toBeVisible();
});
