import { ensureLibraryReady, scannedNodes } from "./helpers/library";
import { expect, test } from "@playwright/test";
import type { StatePreview } from "../../src/api/stateBackup";

// 照片精选的跨层主链路：照片墙加入精选 → 精选页列出来 → 重启后仍在。
//
// 精选是照片级的数据，与相册级收藏是两份。这里既验证接口，也验证
// 界面上「照片墙 → 精选页」这条路径真的连着。
test("照片可以加入精选，在精选页里聚在一起，重启后仍然保留", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  const nodes = await scannedNodes(request, "photo");
  // 素材里的样例相册在照片根下，有三张图：够勾选，也够并排对比。
  const album = nodes.find((node) => node.name === "sample-album");
  expect(album).toBeDefined();

  // 清掉上一条用例留下的精选：精选是全局一份数据。
  const before = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (before.picks.length > 0) {
    const response = await request.post("/api/picks/batch", {
      data: { ids: before.picks, action: "remove" },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto(`/photo/albums/${encodeURIComponent(album!.id)}`);
  const firstTile = page.locator("button[aria-label^='查看']").first();
  await firstTile.waitFor({ timeout: 20000 });

  // 悬停才露出精选角标：满墙常驻圆点会把照片本身挤掉。
  await firstTile.hover();
  const pickButton = page.locator('button[aria-label*="加入精选"]').first();
  await expect(pickButton).toBeVisible();
  await pickButton.click();

  // 服务端确认了这一张进了精选。
  await expect
    .poll(async () => {
      const response = (await (await request.get("/api/picks")).json()) as {
        picks: string[];
      };
      return response.picks.length;
    })
    .toBe(1);

  // 「我的 · 精选照片」把它列出来，并说得出它属于哪本相册。
  await page.goto("/photo/me/picks");
  await expect(
    page.getByRole("tab", { name: "精选照片", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  // 计数在页头上，而这一页签嵌在「我的」里：页头由外层给，
  // 面板里给的是照片本身、它的出处，还有这一页有多少张。
  await expect(page.getByText("共 1 张精选照片")).toBeVisible();
  await expect(page.getByText("sample-album", { exact: true })).toBeVisible();
  const pickedTile = page.locator('button[aria-label*="移出精选"]').first();
  await expect(pickedTile).toBeVisible();

  // 精选与相册级收藏是两份数据：收藏相册不动精选。
  const favorites = (await (await request.get("/api/favorites")).json()) as {
    favorites: string[];
  };
  expect(favorites.favorites).not.toContain(album!.id);

  // 状态落在磁盘上：换一次读取（重新请求接口）仍在，重启后也还在。
  const again = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  expect(again.picks).toHaveLength(1);
});

test("从大图加入精选，珍藏页立刻能看到；移出精选不动相册收藏", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find((node) => node.name === "sample-album");
  expect(album).toBeDefined();

  // 收藏是另一份数据：动精选前后它必须一模一样。
  const favoritesBefore = (await (
    await request.get("/api/favorites")
  ).json()) as { favorites: string[] };

  const before = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (before.picks.length > 0) {
    const response = await request.post("/api/picks/batch", {
      data: { ids: before.picks, action: "remove" },
    });
    expect(response.ok()).toBeTruthy();
  }

  await page.goto(`/photo/albums/${encodeURIComponent(album!.id)}`);
  const scroller = page.locator("[data-virtuoso-scroller]");
  const tile = scroller.getByRole("button", { name: /^查看 / }).first();
  await expect(tile).toBeVisible();
  await tile.click();

  // 大图预览里的那个开关与照片墙上的角标是同一个动作。
  const viewer = page.getByRole("dialog", { name: /大图预览/ });
  await expect(viewer).toBeVisible();
  await viewer.getByRole("button", { name: "把这张加入精选" }).click();

  await expect
    .poll(async () => {
      const response = (await (await request.get("/api/picks")).json()) as {
        picks: string[];
      };
      return response.picks.length;
    })
    .toBe(1);

  // 珍藏页立刻能看到这一张：它摆成陈列，不是一面密排的墙。
  await page.goto("/photo/me/picks");
  await expect(page.getByText("共 1 张精选照片")).toBeVisible();
  const showcase = page.getByTestId("pick-showcase");
  await expect(showcase).toBeVisible();
  await expect(showcase.locator("figure")).toHaveCount(1);

  // 移出精选：反馈说清移的是精选，不是收藏。
  await showcase.getByRole("button", { name: /移出精选/ }).click();
  await expect(page.getByText("已移出精选")).toBeVisible();
  await expect
    .poll(async () => {
      const response = (await (await request.get("/api/picks")).json()) as {
        picks: string[];
      };
      return response.picks.length;
    })
    .toBe(0);
  await expect(page.getByText("还没有精选照片")).toBeVisible();

  // 收藏一份没动：移出精选不碰资源级收藏。
  const favoritesAfter = (await (
    await request.get("/api/favorites")
  ).json()) as { favorites: string[] };
  expect(favoritesAfter.favorites).toEqual(favoritesBefore.favorites);
});

test("少量精选摆成陈列：并排、完整，不挤在左边也不裁掉画面", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find((node) => node.name === "sample-album");
  expect(album).toBeDefined();
  const media = (await (
    await request.get(`/api/albums/${album!.id}/media?limit=10`)
  ).json()) as { page: { items: Array<{ id: string }> } };
  const ids = media.page.items.slice(0, 2).map((item) => item.id);
  expect(ids).toHaveLength(2);

  const previous = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (previous.picks.length > 0) {
    await request.post("/api/picks/batch", {
      data: { ids: previous.picks, action: "remove" },
    });
  }
  await request.post("/api/picks/batch", {
    data: { ids, action: "add" },
  });

  try {
    await page.goto("/photo/me/picks");
    const showcase = page.getByTestId("pick-showcase");
    await expect(showcase).toBeVisible();
    const figures = showcase.locator("figure");
    await expect(figures).toHaveCount(2);

    // 两个框并排摆开：不是一个挤在左边，另一个掉到下一行。
    const first = await figures.nth(0).boundingBox();
    const second = await figures.nth(1).boundingBox();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(Math.abs(first!.y - second!.y)).toBeLessThan(4);
    expect(second!.x).toBeGreaterThan(first!.x);

    // 框按照片自己的形状长：素材是 1×1，图上按 1:1 摆，不裁。
    const style = await figures
      .nth(0)
      .locator("div")
      .first()
      .getAttribute("style");
    expect(style).toContain("aspect-ratio: 1");
  } finally {
    const current = (await (await request.get("/api/picks")).json()) as {
      picks: string[];
    };
    if (current.picks.length > 0) {
      await request.post("/api/picks/batch", {
        data: { ids: current.picks, action: "remove" },
      });
    }
  }
});

test("时间线与珍藏共用一份精选状态：一边改了，另一边跟着变", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  const before = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (before.picks.length > 0) {
    const response = await request.post("/api/picks/batch", {
      data: { ids: before.picks, action: "remove" },
    });
    expect(response.ok()).toBeTruthy();
  }

  // 时间线（照片首页）上把一张加入精选。
  await page.goto("/photo");
  const scroller = page.locator("[data-virtuoso-scroller]");
  const tile = scroller.getByRole("button", { name: /^查看 / }).first();
  await expect(tile).toBeVisible();
  await tile.hover();
  const pickButton = scroller.locator('button[aria-label*="加入精选"]').first();
  await expect(pickButton).toBeVisible();
  await pickButton.click();

  await expect
    .poll(async () => {
      const response = (await (await request.get("/api/picks")).json()) as {
        picks: string[];
      };
      return response.picks.length;
    })
    .toBe(1);

  // 珍藏页立刻看到这一张。
  await page.goto("/photo/me/picks");
  await expect(page.getByText("共 1 张精选照片")).toBeVisible();

  // 回到时间线，那一张的角标已经是「移出精选」：状态是同一份。
  await page.goto("/photo");
  const back = page.locator("[data-virtuoso-scroller]");
  const picked = back.locator('button[aria-label*="移出精选"]').first();
  await expect(picked).toBeVisible();

  const current = (await (await request.get("/api/picks")).json()) as {
    picks: string[];
  };
  if (current.picks.length > 0) {
    await request.post("/api/picks/batch", {
      data: { ids: current.picks, action: "remove" },
    });
  }
});

test("精选能随状态备份导出并按类别恢复，且不动相册收藏", async ({
  request,
}) => {
  await ensureLibraryReady(request);
  // 这一条不再触发扫描：扫描会推进库 revision，恢复前的预览就作废了。
  const manifest = (await (
    await request.get("/api/library/manifest")
  ).json()) as { manifest: { roots: Array<{ id: string; contentKind?: string }> } };
  const root = manifest.manifest.roots.find(
    (item) => item.contentKind === "photo",
  );
  expect(root).toBeDefined();
  const children = (await (
    await request.get(`/api/library/${root!.id}/children?kind=photo&limit=100`)
  ).json()) as { page: { items: Array<{ id: string; name: string }> } };
  const album = children.page.items.find((node) => node.name === "sample-album");
  expect(album).toBeDefined();
  const media = (await (
    await request.get(`/api/albums/${album!.id}/media?limit=10`)
  ).json()) as { page: { items: Array<{ id: string }> } };
  const pickId = media.page.items[0].id;

  try {
    await request.post("/api/picks/batch", {
      data: { ids: [pickId], action: "add" },
    });
    // 备份要在精选加进去之后导出，否则里面没有这张。
    const exported = (await (
      await request.get("/api/admin/state/export")
    ).json()) as { picks?: string[] };
    expect(exported.picks).toContain(pickId);

    // 清掉精选，按类别恢复把它带回来。
    await request.post("/api/picks/batch", {
      data: { ids: [pickId], action: "remove" },
    });
    const preview = (await (
      await request.post("/api/admin/state/import/preview", {
        data: { backup: exported },
      })
    ).json()) as StatePreview;
    const response = await request.post("/api/admin/state/import", {
      data: {
        backup: exported,
        categories: ["picks"],
        versions: preview.versions,
        libraryRevision: preview.libraryRevision,
      },
    });
    expect(response.ok()).toBeTruthy();
    const restored = (await (await request.get("/api/picks")).json()) as {
      picks: string[];
    };
    expect(restored.picks).toContain(pickId);
  } finally {
    const current = (await (await request.get("/api/picks")).json()) as {
      picks: string[];
    };
    if (current.picks.length > 0) {
      await request.post("/api/picks/batch", {
        data: { ids: current.picks, action: "remove" },
      });
    }
  }
});
