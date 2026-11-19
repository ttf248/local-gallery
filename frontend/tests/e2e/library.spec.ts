import { expect, test } from "@playwright/test";
import {
  albumUrlPattern,
  liveRoots,
  resetNavItems,
  resetWorkbenchMode,
  scannedNodes,
} from "./helpers/library";

/**
 * 图库的验收用例。
 *
 * 图库回答「库里有什么、在哪儿」：真实目录层级、面包屑、点相册进照片墙，
 * 以及读不出来时给不给得出重试的手柄。
 */

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
  await resetNavItems(request);
});


test("从首页进图库，按目录找到相册并打开照片", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find(
    (node) => (node as { kind?: string }).kind === "album" && node.name,
  );
  expect(album, "临时库里应有照片相册").toBeTruthy();

  await page.goto("/photo");
  // 首页上有一枚明确的图库入口。
  await page.getByRole("link", { name: /图库/ }).first().click();
  await expect(page).toHaveURL(/\/photo\/library/);
  await expect(
    page.getByRole("heading", { name: /全部相册|图库/ }).first(),
  ).toBeVisible();

  // 目录树给出真实的文件夹层级：媒体根下挂着集合与相册。
  const tree = page.getByRole("navigation", { name: "目录" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("button").first()).toBeVisible();

  // 点目录里的那本相册，直接进照片墙。
  const albumInTree = tree.getByRole("button", { name: album!.name, exact: true });
  await expect(albumInTree).toBeVisible();
  await albumInTree.click();
  await expect(page).toHaveURL(albumUrlPattern({ id: album!.id }));
  await expect(
    page.locator("[data-virtuoso-scroller], .photo-wall").first(),
  ).toBeVisible();
});

test("图库能按集合下钻，面包屑说清在哪一层", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  // 展开第一个媒体根，找一个集合点进去。
  const collection = tree.getByRole("button", { name: /^[^/]*\d+ 本相册$/ });
  if ((await collection.count()) > 0) {
    await collection.first().click();
    await expect(page).toHaveURL(/\/photo\/library\?node=/);
    // 面包屑给出祖先链：至少是「图库 › 某集合」。
    await expect(page.getByRole("navigation", { name: "目录位置" })).toBeVisible();
  }
});

test("图库打不开时给出重试手柄", async ({ page, request }) => {
  await liveRoots(request);
  await page.route("**/api/library/overview**", (route) =>
    route.fulfill({
      status: 500,
      json: { code: "test_unavailable", message: "unavailable" },
    }),
  );
  await page.goto("/photo/library");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("图库内容读取失败", { timeout: 15_000 });
  await expect(alert.getByRole("button", { name: /重试/ })).toBeVisible();
});

test("目录树根与集合读取失败时显示错误并可重试", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  const manifestResponse = await request.get("/api/library/manifest");
  const manifest = (await manifestResponse.json()) as {
    manifest: {
      roots: Array<{ id: string; name: string; contentKind?: string }>;
    };
  };
  const root = manifest.manifest.roots.find(
    (item) => item.contentKind === "photo",
  )!;
  const rootResponse = await request.get(
    `/api/library/${root.id}/children?kind=photo&limit=200`,
  );
  const rootChildren = (await rootResponse.json()) as {
    page: { items: Array<{ id: string; name: string; kind: string }> };
  };
  const collection = rootChildren.page.items.find(
    (item) => item.name === "zz-library-hierarchy",
  )!;
  expect(collection.kind).toBe("collection");

  const attempts = new Map<string, number>();
  await page.route("**/api/library/*/children*", async (route) => {
    const parentId = new URL(route.request().url()).pathname
      .split("/")
      .at(-2);
    if (parentId === root.id || parentId === collection.id) {
      const count = (attempts.get(parentId) ?? 0) + 1;
      attempts.set(parentId, count);
      if (count === 1) {
        await route.fulfill({
          status: 400,
          json: { code: "test_unavailable", message: "unavailable" },
        });
        return;
      }
    }
    await route.continue();
  });

  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  await expect(tree.getByRole("alert")).toContainText("目录读取失败");
  await tree.getByRole("button", { name: "重试" }).click();
  await expect(
    tree.getByRole("button", { name: collection.name, exact: true }),
  ).toBeVisible();
  await expect(tree.getByRole("alert")).toContainText("目录读取失败");

  await tree.getByRole("button", { name: "重试" }).click();
  await expect(
    tree.getByRole("button", { name: "outer", exact: true }),
  ).toBeVisible();
  expect(attempts.get(root.id)).toBe(2);
  expect(attempts.get(collection.id)).toBe(2);
});

test("筛选结果为零时仍可调整条件并一键清除", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  const query = "zz-no-such-library-result";
  await page.goto(
    `/photo/library?q=${encodeURIComponent(query)}&min=999999&view=album`,
  );

  await expect(page.getByRole("heading", { name: /没有匹配/ })).toBeVisible();
  const filterBar = page.locator(".filter-strip");
  await expect(filterBar).toBeVisible();
  await expect(filterBar.getByRole("button", { name: "全部" })).toBeVisible();
  await expect(
    filterBar.getByText(`名称：${query}`, { exact: true }),
  ).toBeVisible();
  await expect(
    filterBar.getByRole("button", { name: "清除筛选" }),
  ).toBeVisible();

  await filterBar.getByRole("button", { name: "清除筛选" }).click();
  await expect(page).toHaveURL("/photo/library");
  await expect(
    filterBar.getByRole("button", { name: "全部", pressed: true }),
  ).toBeVisible();
});

test("同属性的多个媒体根可独立选择并限定右侧列表", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  const manifestResponse = await request.get("/api/library/manifest");
  const manifest = (await manifestResponse.json()) as {
    manifest: {
      roots: Array<{ id: string; name: string; contentKind?: string }>;
    };
  };
  const roots = manifest.manifest.roots.filter(
    (root) => root.contentKind === "photo",
  );
  expect(roots).toHaveLength(2);

  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  await expect(tree.locator(".library-tree__row.is-active")).toHaveCount(0);

  const selectedRoot = roots[1]!;
  await tree
    .getByRole("button", { name: selectedRoot.name, exact: true })
    .click();

  await expect(page).toHaveURL(
    new RegExp(`[?&]node=${encodeURIComponent(selectedRoot.id)}(?:&|$)`),
  );
  await expect(tree.locator(".library-tree__row.is-active")).toHaveCount(1);
  await expect(
    tree.getByRole("button", { name: selectedRoot.name, exact: true }),
  ).toHaveAttribute("aria-current", "location");
  await expect(
    page.getByRole("heading", { name: selectedRoot.name }),
  ).toBeVisible();
  await expect(page.getByTestId("album-card")).toHaveCount(1);
  await expect(page.getByTestId("album-card").first()).toContainText(
    "zz-extra-root-only",
  );
  await expect(
    page.locator(".library-content").getByText("sample-album", { exact: true }),
  ).toHaveCount(0);
});

test("深层目录可直达与刷新，面包屑只显示一次当前节点", async ({
  page,
  request,
}) => {
  await scannedNodes(request, "photo");
  const manifestResponse = await request.get("/api/library/manifest");
  const manifest = (await manifestResponse.json()) as {
    manifest: {
      roots: Array<{ id: string; name: string; contentKind?: string }>;
    };
  };
  const root = manifest.manifest.roots.find(
    (item) => item.contentKind === "photo",
  )!;
  const children = async (id: string) => {
    const response = await request.get(
      `/api/library/${id}/children?kind=photo&limit=200`,
    );
    expect(response.ok()).toBeTruthy();
    return (await response.json()) as {
      page: {
        items: Array<{ id: string; name: string; kind: string }>;
      };
    };
  };
  const top = await children(root.id);
  const hierarchy = top.page.items.find(
    (item) => item.name === "zz-library-hierarchy",
  );
  expect(hierarchy?.kind).toBe("collection");
  const nested = await children(hierarchy!.id);
  const outer = nested.page.items.find((item) => item.name === "outer");
  expect(outer?.kind).toBe("collection");

  await page.goto(`/photo/library?node=${encodeURIComponent(outer!.id)}`);
  const breadcrumbs = page.getByRole("navigation", { name: "目录位置" });
  await expect(breadcrumbs).toBeVisible();
  await expect(
    breadcrumbs.getByRole("link", { name: "图库", exact: true }),
  ).toBeVisible();
  await expect(breadcrumbs.getByText(root.name, { exact: true })).toHaveCount(1);
  await expect(
    breadcrumbs.getByRole("link", { name: hierarchy!.name, exact: true }),
  ).toBeVisible();
  await expect(breadcrumbs.getByText(outer!.name, { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.locator(".library-content").getByTestId("album-card"),
  ).toContainText("inner");

  await page.reload();
  await expect(page).toHaveURL(
    new RegExp(`[?&]node=${encodeURIComponent(outer!.id)}(?:&|$)`),
  );
  await expect(breadcrumbs.getByText(outer!.name, { exact: true })).toHaveCount(
    1,
  );
  await expect(
    page.locator(".library-content").getByTestId("album-card"),
  ).toContainText("inner");
});
