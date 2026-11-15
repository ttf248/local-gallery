import { expect, test } from "@playwright/test";
import { albumUrl, resetWorkbenchMode, scannedNodes } from "./helpers/library";

test.beforeEach(async ({ request }) => {
  await resetWorkbenchMode(request);
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
