import {
  ensureLibraryReady,
  resetNavItems,
  setWorkbenchMode,
} from "./helpers/library";
import { expect, test } from "@playwright/test";

// 特征分析要真的跑一遍：临时库有五百多张图，第一条用例还要连扫描
// 一起等，默认的 30 秒超时不够。
test.setTimeout(240_000);

/**
 * 相似照片整理的跨层主链路。
 *
 * 跑一次本机特征分析 → 后端算出分组 → 页面列出分组 → 标记已审查 →
 * 决定写进磁盘，重新读取仍在。
 *
 * 素材里的样例图片内容相同，因此一定会出现「完全重复」组；
 * 用例要验证的是整条链路与人工决定的持久化，不依赖具体的算法阈值。
 */

interface SimilarityGroup {
  id: string;
  kind: string;
  status: string;
  representative: string;
  recommended: string;
  members: { resourceId: string }[];
}

interface SimilarityPage {
  page: {
    total: number;
    groups: SimilarityGroup[];
    summary: { exact: number; near: number; burst: number };
  };
}

/** 跑一次相似照片特征分析并等到它结束。 */
async function runSimilarityAnalysis(
  request: Parameters<typeof ensureLibraryReady>[0],
) {
  // 队列里已经有任务时，服务端会拒绝新任务（409）。等那个跑完再排自己的，
  // 而不是去抢别人的队列位置。
  let jobId = "";
  await expect
    .poll(
      async () => {
        const started = await request.post("/api/ai/jobs", {
          data: { type: "similarity", mode: "full" },
        });
        if (!started.ok()) return false;
        jobId = ((await started.json()) as { job: { id: string } }).job.id;
        return true;
      },
      { timeout: 180_000 },
    )
    .toBe(true);
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/ai/jobs/${encodeURIComponent(jobId)}`,
        );
        if (!response.ok()) return "missing";
        // 单项任务快照是平铺的：字段直接在这一层。
        return ((await response.json()) as { status: string }).status;
      },
      { timeout: 180_000 },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
}

test("相似照片能分组列出、跨页加入精选，人工决定重启后仍在", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");
  await resetNavItems(request);
  await runSimilarityAnalysis(request);

  // 分组是后台算的，等它落盘。
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/similarity/groups?limit=50");
        const body = (await response.json()) as SimilarityPage;
        return body.page.total;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  // 先把精选页载入同一个前端会话，再切到整理页操作；返回精选页时
  // 应看到批量接口写入的新照片，而不是已缓存的旧空态。
  const previousPicks = (await (
    await request.get("/api/picks")
  ).json()) as { picks: string[] };
  if (previousPicks.picks.length > 0) {
    const response = await request.post("/api/picks/batch", {
      data: { ids: previousPicks.picks, action: "remove" },
    });
    expect(response.ok()).toBeTruthy();
  }
  await page.goto("/photo/me/picks");
  await expect(page.getByText("还没有精选照片")).toBeVisible();
  const sidebar = page.locator('aside[aria-label="主导航"]');
  await sidebar.getByRole("link", { name: "相似照片", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "相似照片与连拍" }),
  ).toBeVisible();

  const card = page.getByTestId("similarity-group").first();
  await expect(card).toBeVisible();
  // 三类结果分开标记：类别徽章说清是哪种重复。
  await expect(card).toHaveAttribute("data-group-kind", /.+/);
  // 代表照片与质量分项摆在第一眼。
  await expect(card.getByText(/清晰 \d+/)).toBeVisible();

  // 展开后成员并排摆着，能逐张比。
  await card.getByRole("button", { name: "展开", exact: true }).click();
  await expect(page.getByTestId("similarity-member").first()).toBeVisible();

  await card.getByRole("button", { name: "加入精选", exact: true }).click();
  await expect(page.getByText("已把代表照片加入精选")).toBeVisible();
  await expect
    .poll(async () => {
      const response = await request.get("/api/picks");
      return ((await response.json()) as { picks: string[] }).picks.length;
    })
    .toBeGreaterThan(0);
  await sidebar.getByRole("link", { name: "珍藏", exact: true }).click();
  await expect(page).toHaveURL(/\/photo\/me\/picks$/);
  await expect(page.getByText(/^\d+ 张精选$/)).toBeVisible();
  await expect(page.locator('button[aria-label*="移出精选"]').first()).toBeVisible();

  await sidebar.getByRole("link", { name: "相似照片", exact: true }).click();
  const returnedCard = page.getByTestId("similarity-group").first();

  // 标记已处理：决定写进 state，重新读取仍在。
  await returnedCard.getByRole("button", { name: "标记已处理", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await request.get("/api/similarity/groups?limit=50");
      const body = (await response.json()) as SimilarityPage;
      return body.page.groups.some((group) => group.status === "reviewed");
    })
    .toBe(true);

  // 反馈说清做了什么，并留一条撤销。
  await expect(page.getByText("已标记 1 组")).toBeVisible();
  await expect(page.getByRole("button", { name: "撤销" })).toBeVisible();

  // 这一组离开待处理列表了：切到已处理才看得见它。
  await page.getByRole("radio", { name: "已处理" }).click();
  await expect(
    page.getByTestId("similarity-group").first(),
  ).toHaveAttribute("data-group-status", "reviewed");

  // 页面重新读取后，状态照样显示为已处理。
  await page.reload();
  await expect(
    page.getByTestId("similarity-group").first(),
  ).toHaveAttribute("data-group-status", "reviewed");

  const picked = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (picked.picks.length > 0) {
    const response = await request.post("/api/picks/batch", {
      data: { ids: picked.picks, action: "remove" },
    });
    expect(response.ok()).toBeTruthy();
  }
});

test("人工指定的代表照片刷新后仍在", async ({ page, request }) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");

  // 分组是后台算好的：上一条用例已经跑过一次分析，这里直接用。
  // 单独跑这一条时（没有分组）才补跑一次 —— 多跑一次分析会改变库里
  // 「未分析几张」的计数，后面那条用例按这个数字断言。
  const existing = (await (
    await request.get("/api/similarity/groups?limit=1")
  ).json()) as SimilarityPage;
  if (existing.page.total === 0) {
    await runSimilarityAnalysis(request);
    await expect
      .poll(
        async () => {
          const response = await request.get("/api/similarity/groups?limit=50");
          const body = (await response.json()) as SimilarityPage;
          return body.page.total;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
  }

  // 看连拍组：它们的成员少，展开后逐张比较不会刷出几千张图。
  await page.goto("/photo/similarity?kind=burst");
  const card = page.getByTestId("similarity-group").first();
  await expect(card).toBeVisible();

  // 展开后成员并排摆着，点其中一张就是「把它当代表」。
  await card.getByRole("button", { name: "展开", exact: true }).click();
  const members = card.getByTestId("similarity-member");
  await expect(members.first()).toBeVisible();
  await members.nth(1).locator("button[aria-label*='设为代表照片']").click();
  await expect(card.getByText("当前代表")).toBeVisible();

  // 决定记在磁盘上：刷新后还是那一张。
  await page.reload();
  const again = page.getByTestId("similarity-group").first();
  await again.getByRole("button", { name: "展开", exact: true }).click();
  await expect(again.getByText("当前代表")).toBeVisible();
  await expect(
    again
      .getByTestId("similarity-member")
      .nth(1)
      .locator("button[aria-label*='设为代表照片']"),
  ).toHaveAttribute("aria-pressed", "true");
});

/**
 * 读某一组当前的状态。
 *
 * 状态是三档，「全部」视图里混着待处理、已处理与已忽略：
 * 撤销要按每组操作前的那一档恢复，不能统一翻一个布尔。
 */
async function groupStatus(
  request: Parameters<typeof ensureLibraryReady>[0],
  groupId: string,
): Promise<string | undefined> {
  // 逐个状态档找：每一档的组数都在一页之内，比一次拿全量再翻更稳。
  for (const status of ["pending", "reviewed", "ignored"]) {
    const response = await request.get(
      `/api/similarity/groups?status=${status}&limit=200`,
    );
    const body = (await response.json()) as SimilarityPage;
    if (body.page.groups.some((group) => group.id === groupId)) return status;
  }
  return undefined;
}

/**
 * 等后台重建停下来。
 *
 * 重建会重算分组并迁移人工决定，分组的 id 也可能跟着变。正在重建时
 * 做的撤销会撞上「状态已经变了」或「这一组已经不在了」—— 那是并发
 * 保护在正常工作，不是缺陷，所以用例要先等它安静下来再动手。
 */
async function waitForStableGroups(
  request: Parameters<typeof ensureLibraryReady>[0],
) {
  let lastId = "";
  await expect
    .poll(
      async () => {
        const statusResponse = await request.get("/api/similarity/status");
        const status = (await statusResponse.json()) as {
          status: { stale: boolean; rebuilding: boolean };
        };
        if (status.status.rebuilding || status.status.stale) {
          lastId = "";
          return false;
        }
        const groupsResponse = await request.get(
          "/api/similarity/groups?limit=1",
        );
        const groups = (await groupsResponse.json()) as SimilarityPage;
        const id = groups.page.groups[0]?.id ?? "";
        // 连续两次读到同一批分组，才算真的安静下来了。
        const stable = id !== "" && id === lastId;
        lastId = id;
        return stable;
      },
      { timeout: 120_000, intervals: [1_500] },
    )
    .toBe(true);
}

/** 确保有分组可验：没有就先跑一次分析。 */
async function ensureSimilarityGroups(
  request: Parameters<typeof ensureLibraryReady>[0],
) {
  const existing = (await (
    await request.get("/api/similarity/groups?limit=1")
  ).json()) as SimilarityPage;
  if (existing.page.total === 0) {
    await runSimilarityAnalysis(request);
    await expect
      .poll(
        async () => {
          const response = await request.get("/api/similarity/groups?limit=50");
          const body = (await response.json()) as SimilarityPage;
          return body.page.total;
        },
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
  }
  await waitForStableGroups(request);
}

/**
 * 撤销按操作前的状态恢复。
 *
 * 「已忽略」的组被标记为已处理之后，原来的「已忽略」就找不回来了 ——
 * 撤销时只翻一个布尔，那一组会掉进「待处理」：用户明明说过
 * 「我不想再看它」，撤销之后却又回到了待办堆里。
 */
test("撤销按操作前的状态恢复：已忽略的组标记已处理后撤销回到已忽略", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");
  await ensureSimilarityGroups(request);

  const pending = (await (
    await request.get("/api/similarity/groups?status=pending&limit=2")
  ).json()) as SimilarityPage;
  expect(pending.page.groups.length).toBeGreaterThan(0);

  await page.goto("/photo/similarity");
  const card = page.getByTestId("similarity-group").first();
  await expect(card).toBeVisible();
  // 以页面上这一张卡为准：用户点的是看得见的那一张。
  const groupId = (await card.getAttribute("data-group-id")) ?? "";

  // 先忽略这一组，再撤销它 —— 撤销要回到待处理。
  await card.getByRole("button", { name: "更多组操作" }).click();
  await page.getByRole("menuitem", {name:"忽略",exact:true}).click();
  const ignored = page.getByText("已忽略这一组");
  await expect(ignored).toBeVisible();
  // 等状态真的写进磁盘再撤销：不然后面读到的状态对不上，撤销会被
  // 「状态已经变了」的并发保护挡下来。
  await expect.poll(() => groupStatus(request, groupId)).toBe("ignored");
  await ignored.locator("..").getByRole("button", { name: "撤销" }).click();
  // 提示会堆着：同一条文案可能有多条（上一条还没过期），取最新的一条。
  await expect(page.getByText("已恢复原状态").last()).toBeVisible({
    timeout: 15000,
  });
  await expect.poll(() => groupStatus(request, groupId)).toBe("pending");
  await expect(ignored).toHaveCount(0);

  // 再忽略一次，然后标记已处理：撤销这次要回到「已忽略」。
  await page.getByTestId("similarity-group").and(page.locator("[data-group-id=" + JSON.stringify(groupId) + "]")).getByRole("button", { name: "更多组操作" }).click();
  await page.getByRole("menuitem", {name:"忽略",exact:true}).click();
  await expect(page.getByText("已忽略这一组")).toBeVisible();
  await expect.poll(() => groupStatus(request, groupId)).toBe("ignored");

  // 切到已忽略这一档：这一组就在里面，按钮也换成了「取消忽略」。
  await page.getByRole("radio", { name: "已忽略" }).click();
  const ignoredCard = page.locator(
    `[data-testid="similarity-group"][data-group-id="${groupId}"]`,
  );
  await expect(ignoredCard).toBeVisible();
  await ignoredCard
    .getByRole("button", { name: "标记已处理", exact: true })
    .click();
  const reviewed = page.getByText("已标记 1 组");
  await expect(reviewed).toBeVisible();
  await expect.poll(() => groupStatus(request, groupId)).toBe("reviewed");
  await reviewed.locator("..").getByRole("button", { name: "撤销" }).click();
  // 提示会堆着：同一条文案可能有多条（上一条还没过期），取最新的一条。
  await expect(page.getByText("已恢复原状态").last()).toBeVisible({
    timeout: 15000,
  });

  // 撤销之后，这一组还是「已忽略」，没有掉进待处理。
  await expect.poll(() => groupStatus(request, groupId)).toBe("ignored");

  // 刷新之后照样是「已忽略」：决定写在磁盘上。
  await page.reload();
  await page.getByRole("radio", { name: "已忽略" }).click();
  const reloaded = page.locator(
    `[data-testid="similarity-group"][data-group-id="${groupId}"]`,
  );
  await expect(reloaded).toHaveAttribute("data-group-status", "ignored");
});

/**
 * 混合状态的批量修改，撤销按每组各自恢复。
 *
 * 「全部」视图里的组本来就有各种状态：统一翻一个布尔的话，已处理的
 * 会被推回待处理、已忽略的也会丢掉 —— 用户的选择全乱了。
 */
test("混合状态的批量修改，撤销按每组各自恢复", async ({ page, request }) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");
  await ensureSimilarityGroups(request);

  await page.goto("/photo/similarity?status=all");
  const cards = page.getByTestId("similarity-group");
  await expect(cards.first()).toBeVisible();
  // 以「全部」视图里看得见的两张卡为准：混合状态正是这个视图的常态。
  const ignoredId = (await cards.nth(0).getAttribute("data-group-id")) ?? "";
  const reviewedId = (await cards.nth(1).getAttribute("data-group-id")) ?? "";
  expect(ignoredId).not.toBe(reviewedId);

  // 两组先进入不同的状态：一个是已忽略，另一个还待处理。
  // 状态用接口摆好，页面再刷新一次 —— 要验的是批量撤销的恢复语义，
  // 不是状态怎么摆上去的。
  for (const [groupId, status] of [
    [ignoredId, "ignored"],
    [reviewedId, "pending"],
  ] as const) {
    const response = await request.put(
      `/api/similarity/groups/${encodeURIComponent(groupId)}`,
      { data: { status } },
    );
    expect(response.ok()).toBeTruthy();
  }
  await page.reload();

  const ignoredCard = page.locator(
    `[data-testid="similarity-group"][data-group-id="${ignoredId}"]`,
  );
  const reviewedCard = page.locator(
    `[data-testid="similarity-group"][data-group-id="${reviewedId}"]`,
  );
  await expect(ignoredCard).toBeVisible();
  await expect(reviewedCard).toBeVisible();
  await expect.poll(() => groupStatus(request, ignoredId)).toBe("ignored");
  await expect.poll(() => groupStatus(request, reviewedId)).toBe("pending");

  // 勾上两组，一起标记为已处理。
  await ignoredCard.getByRole("checkbox", { name: /选中这一组/ }).check();
  await reviewedCard.getByRole("checkbox", { name: /选中这一组/ }).check();
  const bar = page.getByTestId("similarity-batch-bar");
  await expect(bar).toBeVisible();
  await bar.getByRole("button", { name: "标记已处理", exact: true }).click();
  await expect(page.getByText("已把 2 组标记为已处理")).toBeVisible();

  // 撤销：每一组各自回到自己原来的那一档。
  await page
    .getByText("已把 2 组标记为已处理")
    .locator("..")
    .getByRole("button", { name: "撤销" })
    .click();
  await expect(page.getByText("已恢复 2 组的原状态")).toBeVisible({ timeout: 15000 });
  await expect.poll(() => groupStatus(request, ignoredId)).toBe("ignored");
  await expect.poll(() => groupStatus(request, reviewedId)).toBe("pending");
});

test("相似照片的人工决定能随状态备份导出并恢复", async ({ request }) => {
  await ensureLibraryReady(request);
  await runSimilarityAnalysis(request);

  await expect
    .poll(
      async () => {
        const response = await request.get("/api/similarity/groups?limit=50");
        const body = (await response.json()) as SimilarityPage;
        return body.page.total;
      },
      { timeout: 60_000 },
    )
    .toBeGreaterThan(0);

  const groups = (await (
    await request.get("/api/similarity/groups?limit=50")
  ).json()) as SimilarityPage;
  const group = groups.page.groups[0];
  await request.put(`/api/similarity/groups/${encodeURIComponent(group.id)}`, {
    data: { reviewed: true },
  });

  const exported = (await (
    await request.get("/api/admin/state/export")
  ).json()) as { similarity?: { reviewed?: Record<string, boolean> } };
  expect(exported.similarity?.reviewed?.[group.id]).toBe(true);

  const preview = (await (
    await request.post("/api/admin/state/import/preview", {
      data: { backup: exported },
    })
  ).json()) as { versions: Record<string, string>; libraryRevision: number };
  const response = await request.post("/api/admin/state/import", {
    data: {
      backup: exported,
      categories: ["similarity"],
      versions: preview.versions,
      libraryRevision: preview.libraryRevision,
    },
  });
  expect(response.ok()).toBeTruthy();

  const restored = (await (
    await request.get("/api/similarity/groups?limit=50")
  ).json()) as SimilarityPage;
  expect(restored.page.groups.some((item) => item.status === "reviewed")).toBe(
    true,
  );
});
