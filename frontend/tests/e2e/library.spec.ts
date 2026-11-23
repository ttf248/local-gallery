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
  // 首页上有一枚明确的相册入口。
  await page.getByRole("link", { name: "相册" }).first().click();
  await expect(page).toHaveURL(/\/photo\/library/);
  await expect(
    page.getByRole("heading", { name: /全部内容|相册/ }).first(),
  ).toBeVisible();

  // 目录树给出真实的文件夹层级：媒体根下挂着文件夹与相册。
  const tree = page.getByRole("navigation", { name: "目录" });
  await expect(tree).toBeVisible();
  await expect(tree.getByRole("button").first()).toBeVisible();

  // 顶层时树只摆媒体根：根下面可能挂着上百个文件夹，全部摊开就是
  // 一份巨大的导航列表。展开它才看得见下一层。
  await tree.getByRole("button", { name: /^展开 / }).first().click();

  // 点目录里的那本相册，直接进照片墙。
  const albumInTree = tree.getByRole("button", { name: album!.name, exact: true });
  await expect(albumInTree).toBeVisible();
  await albumInTree.click();
  await expect(page).toHaveURL(albumUrlPattern({ id: album!.id }));
  await expect(
    page.locator("[data-virtuoso-scroller], .photo-wall").first(),
  ).toBeVisible();
});

test("图库能按文件夹下钻，面包屑说清在哪一层", async ({ page, request }) => {
  await scannedNodes(request, "photo");
  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  // 媒体根那一层默认收着（不摊开上百个文件夹），展开后从里面找一个
  // 文件夹点进去。
  await tree.getByRole("button", { name: /^展开 / }).first().click();
  const folder = tree.getByRole("button", {
    name: "zz-library-hierarchy",
    exact: true,
  });
  await expect(folder).toBeVisible();
  await folder.click();
  await expect(page).toHaveURL(/\/photo\/library\?node=/);
  // 面包屑给出祖先链：至少是「图库 › 某文件夹」。
  await expect(page.getByRole("navigation", { name: "目录位置" })).toBeVisible();
});

/**
 * 目录查找与照片浏览是一条连续的流程：进两层文件夹、打开相册、回到父级，
 * 全程知道自己站在哪里。
 */
test("从图库进两层文件夹、打开相册、返回父级全程不迷路", async ({
  page,
  request,
}) => {
  await liveRoots(request);
  const childrenOf = async (id: string) => {
    const response = await request.get(
      `/api/library/${id}/children?kind=photo&limit=200`,
    );
    expect(response.ok()).toBeTruthy();
    const body = (await response.json()) as {
      page: { items: Array<{ id: string; name: string; kind: string }> };
    };
    return body.page.items;
  };
  const manifest = (await (
    await request.get("/api/library/manifest")
  ).json()) as {
    manifest: {
      roots: Array<{ id: string; name: string; contentKind?: string }>;
    };
  };
  const root = manifest.manifest.roots.find(
    (item) => item.contentKind === "photo",
  )!;
  const level1 = (await childrenOf(root.id)).find(
    (node) => node.name === "zz-library-hierarchy",
  )!;
  const level2 = (await childrenOf(level1.id)).find(
    (node) => node.name === "outer",
  )!;
  const album = (await childrenOf(level2.id)).find(
    (node) => node.name === "inner",
  )!;

  // 网格是虚拟化的：先用搜索把目标卡片带到眼前。
  await page.goto("/photo/library?q=zz-library-hierarchy");

  // 文件夹卡点开是下一层目录。
  await page
    .getByRole("link", { name: /打开文件夹.*zz-library-hierarchy/ })
    .click();
  await expect(page).toHaveURL(new RegExp(`node=${level1.id}`));
  await expect(
    page.getByRole("navigation", { name: "目录位置" }),
  ).toBeVisible();

  await page.goto(`/photo/library?node=${level1.id}&q=outer`);
  await page.getByRole("link", { name: /打开文件夹.*outer/ }).click();
  await expect(page).toHaveURL(new RegExp(`node=${level2.id}`));

  // 相册卡点开是照片。
  await page.goto(`/photo/library?node=${level2.id}&q=inner`);
  await page.getByRole("link", { name: /打开相册.*inner/ }).click();
  await expect(page).toHaveURL(albumUrlPattern({ id: album.id }));
  await expect(
    page.locator("[data-virtuoso-scroller], .photo-wall").first(),
  ).toBeVisible();

  // 回到图库那一层，用「返回上级」一级一级退回去。
  await page.goto(`/photo/library?node=${level2.id}`);
  await page.getByRole("button", { name: "返回上级" }).click();
  await expect(page).toHaveURL(new RegExp(`node=${level1.id}`));
  await page.getByRole("button", { name: "返回上级" }).click();
  await expect(page).toHaveURL(/\/photo\/library$/);
});

/**
 * 相册里换一种看法（分组）不丢已经勾选的照片：勾选是浏览工具，
 * 换看法不该把它清掉。
 */
test("相册里换一种看法不丢已经勾选的照片", async ({ page, request }) => {
  const nodes = await scannedNodes(request, "photo");
  const album = nodes.find(
    (node) => (node as { kind?: string }).kind === "album" && node.name,
  );
  expect(album, "临时库里应有照片相册").toBeTruthy();

  await page.goto(`/photo/albums/${album!.id}`);
  await page.getByRole("button", { name: "选择照片" }).click();
  const first = page.getByRole("checkbox", { name: /^选择「/ }).first();
  await first.click();
  await expect(first).toHaveAttribute("aria-checked", "true");
  await expect(page.getByText("已选 1 张")).toBeVisible();

  // 换一种看法：分组面板开着，勾选还在。
  await page.getByRole("button", { name: "按分组浏览" }).click();
  await expect(page.getByText("已选 1 张")).toBeVisible();
  await expect(first).toHaveAttribute("aria-checked", "true");
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
  await expect(alert).toContainText("相册内容读取失败", { timeout: 15_000 });
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

  // 读不出来的目录一直失败，直到用例放开它：库一变化就会重取目录，
  // 「第一次失败、之后成功」的话错误会被自动重取抹掉，断言就成了竞态。
  const failing = new Set<string>([root.id]);
  await page.route("**/api/library/*/children*", async (route) => {
    const parentId = new URL(route.request().url()).pathname
      .split("/")
      .at(-2);
    if (failing.has(parentId)) {
      await route.fulfill({
        status: 400,
        json: { code: "test_unavailable", message: "unavailable" },
      });
      return;
    }
    await route.continue();
  });

  await page.goto("/photo/library");
  const tree = page.getByRole("navigation", { name: "目录" });
  // 根那一层默认收着（不摊开上百个文件夹）：展开它才会去读子项，
  // 读不出来时也给得出重试的手柄。
  await tree.getByRole("button", { name: /^展开 / }).first().click();
  await expect(tree.getByRole("alert")).toContainText("目录读取失败");

  // 放开失败再重试：目录读得出来了。
  failing.delete(root.id);
  await tree.getByRole("button", { name: "重试" }).click();
  await expect(
    tree.getByRole("button", { name: collection.name, exact: true }),
  ).toBeVisible();

  // 下一层同样读不出来时也给得出重试的手柄。
  failing.add(collection.id);
  await tree.getByRole("button", { name: `展开 ${collection.name}` }).click();
  await expect(tree.getByRole("alert")).toContainText("目录读取失败");
  failing.delete(collection.id);
  await tree.getByRole("button", { name: "重试" }).click();
  await expect(
    tree.getByRole("button", { name: "outer", exact: true }),
  ).toBeVisible();
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
    breadcrumbs.getByRole("link", { name: "相册", exact: true }),
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
