import { ensureLibraryReady } from "./helpers/library";
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

test("相似照片能分组列出，人工决定重启后仍在", async ({ page, request }) => {
  await ensureLibraryReady(request);
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

  await page.goto("/photo/similarity");
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

  // 标记已审查：决定写进 state，重新读取仍在。
  await card.getByRole("button", { name: "已审查", exact: true }).click();
  await expect
    .poll(async () => {
      const response = await request.get("/api/similarity/groups?limit=50");
      const body = (await response.json()) as SimilarityPage;
      return body.page.groups.some((group) => group.status === "reviewed");
    })
    .toBe(true);

  // 页面重新读取后，状态照样显示为已审查。
  await page.reload();
  await expect(
    page.getByTestId("similarity-group").first(),
  ).toHaveAttribute("data-group-status", "reviewed");
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
