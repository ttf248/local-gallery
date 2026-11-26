import { test, expect } from "@playwright/test";
import { makeGroup } from "./helpers/similarityGroup";
import { ensureLibraryReady, setWorkbenchMode } from "./helpers/library";

test("逐组审阅的键盘决定、原状态撤销与窄屏深链", async ({ page, request }) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");
  const { page: feed } = (await (
    await request.get(
      "/api/library/media-feed?kind=photo&scope=timeline&media=photo",
    )
  ).json()) as { page: { items: { id: string }[] } };
  const ids = feed.items.slice(0, 2).map((item) => item.id);
  const groups = Array.from({ length: 3 }, (_, index) => ({
    ...makeGroup(index, ids),
    status: "pending" as string,
  }));
  await page.route("**/api/similarity/groups**", async (route) => {
    const req = route.request(),
      url = new URL(req.url());
    if (req.method() === "PUT") {
      const group = groups.find((item) =>
        url.pathname.endsWith("/" + item.id),
      )!;
      const update = req.postDataJSON() as {
        status?: string;
        representative?: string;
      };
      const previousStatus = group.status;
      Object.assign(group, update);
      await route.fulfill({
        json: { ok: true, changed: true, status: group.status, previousStatus },
      });
      return;
    }
    const visible = groups.filter(
      (group) =>
        !url.searchParams.get("status") ||
        url.searchParams.get("status") === group.status,
    );
    await route.fulfill({
      json: {
        ok: true,
        page: {
          revision: 1,
          total: visible.length,
          groups: visible,
          folders: [],
          summary: {
            exact: 3,
            near: 0,
            burst: 0,
            pending: visible.length,
            reviewed: 3 - visible.length,
            ignored: 0,
            redundant: 3,
            photos: 6,
          },
        },
      },
    });
  });
  await page.route("**/api/similarity/batch", async (route) => {
    const { restores } = route.request().postDataJSON() as {
      restores: { groupId: string; to: string; from: string }[];
    };
    for (const entry of restores) {
      const group = groups.find((item) => item.id === entry.groupId)!;
      expect(group.status).toBe(entry.from);
      group.status = entry.to;
    }
    await route.fulfill({ json: { ok: true, changed: restores.length } });
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/photo/similarity");
  const stage = page.getByRole("region", { name: "组内审阅" });
  await expect(stage).toBeVisible();
  await stage.focus();
  await page.keyboard.press("j");
  await expect(page).toHaveURL(/group=pagination-2/);
  await page.keyboard.press("2");
  await expect.poll(() => groups[1].representative).toBe(ids[1]);
  await expect(stage.getByRole("button", { name: /标记已处理/ })).toBeEnabled();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/group=pagination-3/);
  await stage.focus();
  await page.keyboard.press("Control+z");
  await expect(page).toHaveURL(/group=pagination-2/);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/photo/similarity?view=review&group=pagination-2");
  await expect(page.getByRole("dialog", { name: "逐组审阅" })).toBeVisible();
  await page.getByRole("button", { name: "返回网格" }).click();
  await expect(page).toHaveURL(/view=grid/);
});
