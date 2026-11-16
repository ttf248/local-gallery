import { expect, test } from "@playwright/test";
import { albumUrl, resetWorkbenchMode, scannedNodes } from "./helpers/library";

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
});

test("首页给出智能相册入口，专页铺出分组并直达来源相册", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();

  const started = await page.request.post("/api/ai/jobs", {
    data: { type: "metadata", mode: "incremental", albumId: album!.id },
  });
  expect(started.ok()).toBeTruthy();
  const { job } = (await started.json()) as { job: { id: string } };
  await expect
    .poll(async () => {
      const response = await page.request.get("/api/ai/jobs");
      if (!response.ok()) return "";
      const body = (await response.json()) as {
        snapshot: { jobs: Array<{ id: string; status: string }> };
      };
      return (
        body.snapshot.jobs.find((item) => item.id === job.id)?.status ?? ""
      );
    })
    .toBe("completed");

  const summaryResponse = await page.request.get(
    `/api/albums/${encodeURIComponent(album!.id)}/smart-groups?dimension=time`,
  );
  expect(summaryResponse.ok()).toBeTruthy();
  const summary = (await summaryResponse.json()) as {
    summary: {
      groups: Array<{ id: string; name: string; photoCount: number }>;
    };
  };
  const group = summary.summary.groups[0];
  expect(group).toBeDefined();

  await page.goto("/");
  // 照片侧首页那一节是智能相册的预览，标题与「查看全部」都通向专页。
  const smartHeading = page.getByRole("heading", { name: "智能相册", exact: true });
  await expect(smartHeading).toBeVisible();
  await expect(smartHeading.getByRole("link")).toHaveAttribute(
    "href",
    "/photo/smart-albums",
  );
  await expect(
    page.getByRole("link", { name: /查看全部/ }),
  ).toHaveAttribute("href", "/photo/smart-albums");

  // 专页按维度铺出分组卡片，点分组直达来源相册里的那一个。
  await page.goto("/photo/smart-albums?dimension=time");
  const smartGroupLink = page.locator(
    `a[href="${albumUrl(album!)}?view=smart&dimension=time&group=${group.id}"]`,
  );
  await expect(smartGroupLink).toBeVisible();
  await expect(smartGroupLink).toContainText(group.name);
  await expect(smartGroupLink).toContainText("zz-足迹");
  await smartGroupLink.click();

  await expect(page).toHaveURL(
    `${albumUrl(album!)}?view=smart&dimension=time&group=${group.id}`,
  );
  await expect(
    page.getByRole("button", { name: "智能相册", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  const wall = page.locator("[data-virtuoso-scroller]");
  await expect(wall.getByRole("button", { name: /查看 .*\.jpg/ })).toHaveCount(
    group.photoCount,
  );
});

test("专页按维度翻页，分组随之换一批", async ({ page }) => {
  await scannedNodes(page.request, "photo");
  await page.goto("/photo/smart-albums");
  await expect(page.getByRole("tab", { name: /全部/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  await page.getByRole("tab", { name: /人物/ }).click();
  await expect(page).toHaveURL(/\/photo\/smart-albums\?dimension=people/);
  await expect(page.getByRole("tab", { name: /人物/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // 页签上的组数来自轻量请求：人物维度不是零就是有个数。
  const peopleCount = await page
    .getByRole("tab", { name: /人物/ })
    .innerText();
  expect(peopleCount).toMatch(/\d+/);
});

test("缺少的维度可只为当前相册排入所需的增量分析", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-capture-date");
  expect(album).toBeDefined();

  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "智能相册", exact: true }).click();
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

  const started = await page.request.post("/api/ai/jobs", {
    data: { type: "metadata", mode: "incremental", albumId: album!.id },
  });
  expect(started.ok()).toBeTruthy();
  const { job } = (await started.json()) as { job: { id: string } };

  await expect
    .poll(async () => {
      const response = await page.request.get("/api/ai/jobs");
      if (!response.ok()) return "";
      const body = (await response.json()) as {
        snapshot: { jobs: Array<{ id: string; status: string }> };
      };
      return (
        body.snapshot.jobs.find((item) => item.id === job.id)?.status ?? ""
      );
    })
    .toBe("completed");

  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "智能相册", exact: true }).click();
  const group = page.getByRole("button", {
    name: "打开分组 2024年5月2日，3 张",
  });
  await expect(group).toBeVisible();

  await page.getByRole("tab", { name: "地点" }).click();
  await expect(
    page.getByRole("button", {
      name: "打开分组 浙江省 · 杭州市 · 拱墅区，3 张",
    }),
  ).toBeVisible();

  for (const dimension of ["人物", "场景"]) {
    await page.getByRole("tab", { name: dimension }).click();
    await expect(page.getByText("分析覆盖 0/5")).toBeVisible();
    await expect(page.getByText("未分析 5 张")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "还没有可展示的分组" }),
    ).toBeVisible();
  }

  await page.getByRole("tab", { name: "时间" }).click();
  await expect(group).toBeVisible();
  await group.click();

  const wall = page.locator("[data-virtuoso-scroller]");
  await expect(wall.getByRole("button", { name: /查看 .*\.jpg/ })).toHaveCount(
    3,
  );
  await expect(page.getByRole("button", { name: /智能分组/ })).toBeVisible();
});
