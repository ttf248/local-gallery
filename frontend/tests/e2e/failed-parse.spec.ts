import { test, expect } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { liveRoots, scannedNodes } from "./helpers/library";

test("已知解码失败在后续任务中跳过，任务中心显示原因", async ({
  page,
  request,
}) => {
  const root = (await liveRoots(request)).find(
    (item) => item.kind === "photo",
  )!;
  const dir = await mkdtemp(path.join(root.path, "failed-parse-"));
  try {
    await writeFile(path.join(dir, "broken.jpg"), "损坏的图片");
    const album = (await scannedNodes(request)).find(
      (item) => item.name === path.basename(dir),
    )!;
    const run = async (mode: string, status: string) => {
      const response = await request.post("/api/ai/jobs", {
        data: { type: "similarity", mode, albumId: album.id },
      });
      expect(response.ok()).toBeTruthy();
      const { job } = await response.json();
      const read = async () =>
        (await request.get("/api/ai/jobs/" + job.id)).json();
      await expect.poll(async () => (await read()).status).toBe(status);
      return await read();
    };
    expect((await run("full", "failed")).failed).toBe(1);
    for (const mode of ["incremental", "full"]) {
      expect(await run(mode, "completed")).toMatchObject({
        planned: 0,
        processed: 0,
        skipped: 1,
        failed: 0,
      });
    }
    await page.goto("/settings/tasks");
    await page.getByText("高级模块明细",{exact:true}).click();
    await page
      .getByRole("button", { name: "相似照片特征", exact: true })
      .click();
    await expect(
      page.getByText(/本次跳过 .* 张已有解析失败记录/),
    ).toBeVisible();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
