import { expect, test, type APIRequestContext } from "@playwright/test";
import { albumUrl, resetWorkbenchMode, scannedNodes } from "./helpers/library";

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
});

/**
 * 记下地址栏是「推入历史」还是「改写当前那条」。
 *
 * 用户的选择进历史，后退键才退得回去；系统自动纠错改写当前那条，
 * 不然后退一次就多一条死链，来回打转停不下来。
 */
async function trackHistoryWrites(page: import("@playwright/test").Page) {
  await page.addInitScript(() => {
    const store = window as unknown as {
      __pushes: string[];
      __replaces: string[];
    };
    store.__pushes = [];
    store.__replaces = [];
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (
      ...args: Parameters<typeof push>
    ): void => {
      store.__pushes.push(String(args[2] ?? ""));
      push(...args);
    };
    history.replaceState = (
      ...args: Parameters<typeof replace>
    ): void => {
      store.__replaces.push(String(args[2] ?? ""));
      replace(...args);
    };
  });
}

async function historyWrites(page: import("@playwright/test").Page) {
  return page.evaluate(() => {
    const store = window as unknown as {
      __pushes: string[];
      __replaces: string[];
    };
    return { pushes: store.__pushes, replaces: store.__replaces };
  });
}

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
  await expect(page.getByRole("heading", { name: "全部照片" })).toBeVisible();
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
  }

  // 按人物：人脸分析没启用，说清为什么，给的是启用入口。
  await page.getByRole("tab", { name: "按人物" }).click();
  await expect(
    page.getByRole("heading", { name: "人物分组还不能用" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "去任务中心启用" }),
  ).toBeVisible();

  // 按场景：分析模块可用，说的是「还没完成分析」，给的是补分析。
  await page.getByRole("tab", { name: "按场景" }).click();
  await expect(
    page.getByRole("heading", { name: "还没有完成分析" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "补充语义向量分析" }),
  ).toBeVisible();

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

/**
 * 分组与普通筛选不叠加。
 *
 * 分组本身就是服务端算好的一段照片；筛选条件留在地址栏里，分组视图
 * 只会静默忽略它们 —— 地址栏说着一套条件，墙上摆着另一批照片。
 * 进入分组时条件被明确结束，回到全部照片看到的就是这本相册的全部照片。
 */
test("进入分组时结束冲突的筛选条件，回到全部照片不再意外恢复", async ({
  page,
  request,
}) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();
  await analyzeMetadata(page.request, album!.id);

  // 先精选一张：筛选条里才有「只看精选」这一档可用。
  const media = (await (
    await request.get(`/api/albums/${album!.id}/media?limit=10`)
  ).json()) as { page: { items: Array<{ id: string }> } };
  const pickId = media.page.items[0].id;
  await request.post("/api/picks/batch", {
    data: { ids: [pickId], action: "add" },
  });

  try {
    await page.goto(albumUrl(album!));
    await page.getByRole("button", { name: /^筛选/ }).click();
    await page.getByRole("radio", { name: "已精选" }).click();
    await expect(page).toHaveURL(/picks=only/);
    // 墙上只剩精选的那一张。
    await expect(page.locator("button[aria-label^='查看']")).toHaveCount(1);

    // 进入分组：条件被明确结束，地址栏里也不再挂着它。
    await page.getByRole("button", { name: "按分组浏览" }).click();
    await page.getByRole("tab", { name: "按时间" }).click();
    const group = page.getByRole("button", { name: /^2024年5月2日/ });
    await expect(group).toBeVisible();
    await group.click();
    await expect(page).not.toHaveURL(/picks=only/);
    // 界面上说清分组不叠加条件，不让用户自己猜。
    await expect(
      page.getByText("分组已经是筛好的照片，不叠加其它条件"),
    ).toBeVisible();

    // 回到全部照片：真的回到全部，不会只留下精选的那一张。
    await page.getByRole("button", { name: "回到全部照片" }).click();
    await expect(page.locator("button[aria-label^='查看']")).toHaveCount(5);
  } finally {
    await request.post("/api/picks/batch", {
      data: { ids: [pickId], action: "remove" },
    });
  }
});

/**
 * 分组被删掉、被重建之后，原先选中的那一组已经不在了：退回全部照片。
 *
 * 这是系统的纠错，不是用户的操作：改写当前那条地址就行，往历史里追加
 * 地址只会让后退一次多一条死链。
 */
test("分组失效后自动退回全部照片，不往历史里追加地址", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();

  await trackHistoryWrites(page);
  // 深链指向一个不存在的分组。
  await page.goto(`${albumUrl(album!)}?dimension=time&group=sg_not_a_group`);

  // 自动纠错：地址被改写，历史里没有多出任何一条。
  await expect(page).toHaveURL(/dimension=time$/);
  const writes = await historyWrites(page);
  expect(writes.pushes).toEqual([]);
  expect(writes.replaces.some((url) => url.includes("dimension=time"))).toBe(
    true,
  );

  // 刷新不丢，也不回到那个失效的分组。
  await page.reload();
  await expect(page).toHaveURL(/dimension=time$/);
  await expect(page.getByText("分组已经是筛好的照片，不叠加其它条件")).toHaveCount(
    0,
  );

  // 后退一次就离开这一页，不在失效地址与正确地址之间来回打转。
  await page.goBack();
  await expect(page).not.toHaveURL(/dimension=time/);
});

/**
 * 用户主动选分组仍然进历史：后退键要能退回全部照片。
 */
test("主动选分组进历史，系统纠错只改地址", async ({ page }) => {
  const albums = await scannedNodes(page.request, "photo");
  const album = albums.find((item) => item.name === "zz-足迹");
  expect(album).toBeDefined();
  await analyzeMetadata(page.request, album!.id);

  await trackHistoryWrites(page);
  await page.goto(albumUrl(album!));
  await page.getByRole("button", { name: "按分组浏览" }).click();
  await page.getByRole("tab", { name: "按时间" }).click();
  const group = page.getByRole("button", { name: /^2024年5月2日/ });
  await expect(group).toBeVisible();
  await group.click();
  await expect(page).toHaveURL(/group=/);

  // 用户的选择推入历史。
  const writes = await historyWrites(page);
  expect(writes.pushes.some((url) => url.includes("group="))).toBe(true);

  // 后退能退回全部照片。
  await page.goBack();
  await expect(page).not.toHaveURL(/group=/);
});
