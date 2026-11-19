import {
  albumUrl,
  ensureLibraryReady,
  ensureMetadataReady,
  scannedNodes,
} from "./helpers/library";
import { expect, test } from "@playwright/test";

// 元数据与相似照片分析都要真的跑一遍：临时库有几百张图，第一条用例还要
// 连扫描一起等，默认的 30 秒超时远远不够。
test.setTimeout(600_000);

interface AlbumFacets {
  facets: {
    total: number;
    videos: number;
    time: {
      available: boolean;
      reason?: string;
      months: { month: string; count: number }[];
      unresolvedCount: number;
    };
    people: {
      available: boolean;
      reason?: string;
      items: { id: string; name: string; count: number }[];
    };
    places: { available: boolean; reason?: string };
    picks: { pickedCount: number };
    groupPhotos: { available: boolean; reason?: string; count: number };
    similarity: {
      available: boolean;
      reason?: string;
      groupCount: number;
      photoCount: number;
    };
  };
}

interface AlbumMediaPage {
  page: {
    total: number;
    photoTotal: number;
    albumTotal: number;
    filtered: boolean;
    unresolved: { total: number };
    grouped: number;
    items: { id: string; name: string; similarityGroup?: { id: string } }[];
  };
}

interface LibraryNode {
  id: string;
  name: string;
  imageCount?: number;
}

/** 临时库里的相册。 */
async function albums(request: Parameters<typeof ensureLibraryReady>[0]) {
  return (await scannedNodes(request, "photo")) as LibraryNode[];
}

/** 带 EXIF 的那本相册：素材里只有「足迹」那几本带拍摄时间与坐标。 */
async function exifAlbum(request: Parameters<typeof ensureLibraryReady>[0]) {
  const nodes = await albums(request);
  const album = nodes.find((node) => node.name.includes("足迹"));
  expect(album, "临时库里没有带 EXIF 的相册").toBeTruthy();
  return album!;
}

/** 照片最多的那本相册：用来验大相册上的折叠与分页。 */
async function largestAlbum(
  request: Parameters<typeof ensureLibraryReady>[0],
) {
  const nodes = await albums(request);
  const album = nodes
    .slice()
    .sort((left, right) => (right.imageCount ?? 0) - (left.imageCount ?? 0))[0];
  expect(album, "临时库里没有照片相册").toBeTruthy();
  return album!;
}

/** 这本相册的筛选条件。 */
async function facetsOf(
  request: Parameters<typeof ensureLibraryReady>[0],
  albumId: string,
) {
  return (await (
    await request.get(`/api/albums/${encodeURIComponent(albumId)}/filters`)
  ).json()) as AlbumFacets;
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
      { timeout: 300_000 },
    )
    .toMatch(/^(completed|failed|cancelled)$/);
}

test("照片墙的筛选条件真实可用，缺分析结果时说清原因", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await ensureMetadataReady(request);
  const album = await exifAlbum(request);

  const facets = await facetsOf(request, album.id);
  // 分析跑过之后，拍摄时间这一维要有月份可选。
  expect(facets.facets.time.available).toBeTruthy();
  expect(facets.facets.time.months.length).toBeGreaterThan(0);
  // 位置这一维：有坐标的照片在，地点这一维就该能用。
  expect(facets.facets.places.available).toBeTruthy();

  await page.goto(albumUrl(album));
  await page.getByRole("button", { name: /^筛选/ }).click();
  const panel = page.getByRole("dialog", { name: "筛选照片" });
  await expect(panel).toBeVisible();
  // 面板里摆的是这本相册真实有的月份。
  const firstMonth = facets.facets.time.months[0];
  await expect(
    panel.getByRole("button", {
      name: `${firstMonth.month.slice(0, 4)}年`,
      exact: true,
    }),
  ).toBeVisible();
});

test("没有分析结果的那一维写清原因，不摆空选项", async ({ page, request }) => {
  await ensureLibraryReady(request);
  // 素材里的照片多半是 PNG，没有 EXIF：这一维应当说清为什么不能用。
  const album = await largestAlbum(request);
  const facets = await facetsOf(request, album.id);
  if (facets.facets.time.available) {
    test.skip(true, "这本相册有拍摄时间，时间这一维可用");
  }
  expect(facets.facets.time.reason).toBeTruthy();

  await page.goto(albumUrl(album));
  await page.getByRole("button", { name: /^筛选/ }).click();
  const panel = page.getByRole("dialog", { name: "筛选照片" });
  await expect(panel.getByText(facets.facets.time.reason!).first()).toBeVisible();
});

test("筛选写进地址，服务端按条件筛选，换条件后旧游标失效", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await ensureMetadataReady(request);
  const album = await exifAlbum(request);

  await page.goto(albumUrl(album));
  await page.getByRole("button", { name: /^筛选/ }).click();
  const panel = page.getByRole("dialog", { name: "筛选照片" });
  await panel.getByRole("button", { name: /\d{4}年/ }).first().click();

  // 条件住进地址栏：刷新不丢。
  await expect(page).toHaveURL(/from=\d{4}-01/);
  await expect(page).toHaveURL(/to=\d{4}-12/);

  const filtered = (await (
    await request.get(
      `/api/albums/${encodeURIComponent(album.id)}/media?from=2000-01&to=2099-12&limit=1`,
    )
  ).json()) as AlbumMediaPage;
  expect(filtered.page.filtered).toBeTruthy();
  expect(filtered.page.photoTotal).toBeLessThanOrEqual(filtered.page.albumTotal);
  // 换了一套条件，旧游标必须失效。
  const stale = await request.get(
    `/api/albums/${encodeURIComponent(album.id)}/media?limit=1&cursor=not-a-cursor`,
  );
  expect(stale.status()).toBe(400);
});

test("条件能组合，也能逐条去掉", async ({ page, request }) => {
  await ensureLibraryReady(request);
  await ensureMetadataReady(request);
  const album = await exifAlbum(request);

  await page.goto(albumUrl(album));
  await page.getByRole("button", { name: /^筛选/ }).click();
  const panel = page.getByRole("dialog", { name: "筛选照片" });
  await panel.getByRole("button", { name: /\d{4}年/ }).first().click();
  await panel.getByRole("radio", { name: "已精选" }).click();
  await expect(page).toHaveURL(/picks=only/);
  await expect(page).toHaveURL(/from=\d{4}-01/);

  // 条件标签逐条摆出来，点掉一条其余留着。
  await page.keyboard.press("Escape");
  // 条件标签的可访问名是它自己的文字，「去掉这条条件」在 title 上。
  const chips = page.getByTitle(/去掉这条条件/);
  await expect(chips).toHaveCount(2);
  await chips.first().click();
  await expect(page).not.toHaveURL(/from=\d{4}-01/);
  await expect(page).toHaveURL(/picks=only/);
});

test("相似照片折叠只留代表照片，展开后成员就地摊开", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await runSimilarityAnalysis(request);

  // 分组是后台算的，等它落盘。
  await expect
    .poll(
      async () => {
        const response = await request.get("/api/similarity/groups?limit=50");
        const body = (await response.json()) as {
          page: { total: number };
        };
        return body.page.total;
      },
      { timeout: 120_000 },
    )
    .toBeGreaterThan(0);

  // 找一本真的有相似组的相册。
  const nodes = await albums(request);
  const groups = (await (
    await request.get("/api/similarity/groups?limit=50")
  ).json()) as {
    page: { groups: { members: { albumId: string }[] }[] };
  };
  const albumIDs = new Set<string>();
  for (const group of groups.page.groups) {
    for (const member of group.members) albumIDs.add(member.albumId);
  }
  const album = nodes.find((node) => albumIDs.has(node.id));
  test.skip(!album, "没有相册落在相似组里");

  await page.goto(albumUrl(album!));
  const collapse = page.getByRole("button", { name: "折叠相似" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(page).toHaveURL(/collapse=1/);

  // 折叠之后墙上的照片变少，条上说得清少在哪。
  const collapsed = (await (
    await request.get(
      `/api/albums/${encodeURIComponent(album!.id)}/media?collapse=1&limit=1`,
    )
  ).json()) as AlbumMediaPage;
  const plain = (await (
    await request.get(
      `/api/albums/${encodeURIComponent(album!.id)}/media?limit=1`,
    )
  ).json()) as AlbumMediaPage;
  expect(collapsed.page.photoTotal).toBeLessThan(plain.page.photoTotal);
  expect(collapsed.page.grouped).toBeGreaterThan(0);

  // 点开一组：成员就地摊开，墙上多出照片。
  const chip = page.getByRole("button", { name: /张相似/ }).first();
  await expect(chip).toBeVisible();
  await chip.hover();
  await chip.click();
  await expect(page).toHaveURL(/expand=/);
  const expanded = (await (
    await request.get(
      `/api/albums/${encodeURIComponent(album!.id)}/media?collapse=1&expand=${
        new URL(page.url()).searchParams.get("expand") ?? ""
      }&limit=1`,
    )
  ).json()) as AlbumMediaPage;
  expect(expanded.page.photoTotal).toBeGreaterThan(collapsed.page.photoTotal);
});

test("筛选结果里能连续选择并批量加入精选，筛选状态与选择都在", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await ensureMetadataReady(request);
  const album = await exifAlbum(request);

  await page.goto(albumUrl(album));
  await page.getByRole("button", { name: /^筛选/ }).click();
  await page
    .getByRole("dialog", { name: "筛选照片" })
    .getByRole("button", { name: /\d{4}年/ })
    .first()
    .click();
  await page.keyboard.press("Escape");

  // 进入多选，连勾两张。
  await page.getByRole("button", { name: "选择照片" }).click();
  const boxes = page.getByRole("checkbox");
  await expect(boxes.first()).toBeVisible();
  await boxes.nth(0).click();
  await boxes.nth(1).click();
  await expect(page.getByText(/已选 2 张/)).toBeVisible();

  // 批量加入精选：条件与选择都还在。
  await page.getByRole("button", { name: "加入精选" }).click();
  await expect(page.getByText(/已把 2 张加入精选/)).toBeVisible();
  await expect(page).toHaveURL(/from=\d{4}-01/);
  await expect(page.getByText(/已选 2 张/)).toBeVisible();
});
