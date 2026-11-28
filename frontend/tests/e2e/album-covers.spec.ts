import { expect, test } from "@playwright/test";
import { scannedNodes } from "./helpers/library";

test("任务中心评分后，相册卡片使用已入选的封面", async ({ page, request }) => {
  test.setTimeout(240_000);
  await scannedNodes(request);
  const runtime = await request.get("/api/ai/semantic/status");
  expect(runtime.ok()).toBeTruthy();
  const ready = (await runtime.json()).status.modules.albumCover.ready;
  await page.goto("/settings/tasks");
  await page.getByText("高级模块明细",{exact:true}).click();
  const module = page.getByRole("button", {
    name: "相册封面精选",
    exact: true,
  });
  await expect(module).toBeVisible();
  if (!ready) {
    await expect(module).toBeDisabled();
    return;
  }
  const settings = (await (await request.get("/api/ai/jobs/settings")).json())
    .settings;
  try {
    expect(
      (
        await request.put("/api/ai/jobs/hardware", {
          data: { gpuEnabled: false },
        })
      ).ok(),
    ).toBeTruthy();
    await page.reload();
    await module.click();
    await page.getByRole("radio", { name: /^全量/ }).click();
    const started = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/ai/jobs") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: /开始分析 · 相册封面精选/ }).click();
    const response = await started;
    expect(response.ok()).toBeTruthy();
    const { job } = await response.json();
    await expect
      .poll(
        async () => {
          const { snapshot } = await (await request.get("/api/ai/jobs")).json();
          return snapshot.jobs.find(
            (entry: { id: string }) => entry.id === job.id,
          )?.status;
        },
        { timeout: 180_000 },
      )
      .toBe("completed");
    type Node = {
      name: string;
      coverCandidates?: { id: string; kind: string }[];
    };
    const candidates = async () => {
      const { page } = await (
        await request.get("/api/library/overview?kind=photo")
      ).json();
      return (page.items as { node?: Node }[])
        .map((i) => i.node)
        .find((n) => n?.coverCandidates?.some((c) => c.kind === "image"));
    };
    await expect.poll(candidates).toBeTruthy();
    const node = (await candidates())!;
    await page.goto("/photo/library");
    const img = page
      .getByTestId("card-cover")
      .getByRole("img", { name: node.name, exact: true });
    await expect(img).toBeVisible();
    const src = await img.getAttribute("src");
    await img.hover();
    const preview = page.getByRole("dialog", {name: "预览 " + node.name}).getByRole("img", {name:node.name,exact:true});
    await expect(preview).toHaveAttribute("src", src!);
    expect(node.coverCandidates?.some((c) => src?.includes(c.id))).toBeTruthy();
  } finally {
    await request.put("/api/ai/jobs/hardware", {
      data: { gpuEnabled: settings.gpuEnabled },
    });
  }
});
