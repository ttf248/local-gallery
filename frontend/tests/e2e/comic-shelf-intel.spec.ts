import { expect, test } from "@playwright/test";
import { scannedNodes } from "./helpers/library";

test("书架展示本地作品信息，编辑简介与总封面后刷新可恢复", async ({
  page,
  request,
}) => {
  await scannedNodes(request);
  const result = await (
    await request.get("/api/library/overview?kind=comic&q=douluodalu")
  ).json();
  const node = result.page.items[0].node;
  const metaPath = "/api/comics/" + node.id + "/meta";
  await page.goto("/comic/library?q=douluodalu");
  const card = page.getByRole("link", { name: "打开作品“斗罗大陆”" });
  await expect(card).toBeVisible();
  await card.hover();
  await expect(
    page.getByRole("dialog", { name: "预览 斗罗大陆" }),
  ).toContainText("少年踏上寻找失落书页的旅途。");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await card.click();
  const cmd = page.getByRole("button", { name: "编辑信息", exact: true });
  await expect(cmd).toBeVisible();
  try {
    await cmd.click();
    const form = page.getByRole("dialog");
    await form.getByLabel("故事大纲").fill("在书架中保存的新故事。");
    await form.getByRole("button", { name: "保存", exact: true }).click();
    await expect(form).toHaveCount(0);
    await page.reload();
    await expect(
      page.getByText("在书架中保存的新故事。", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "更换封面", exact: true }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "候选封面 2" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.reload();
    await scannedNodes(request);
    const detail = (await (await request.get(metaPath)).json()).meta;
    expect(detail.hasCustomCover).toBe(true);
    expect(detail.fullSynopsis).toBe("在书架中保存的新故事。");
    await page.getByRole("button", { name: /^正篇 2/ }).click();
    await expect(page).toHaveURL(/ep=main/);
    await expect(page.getByTestId("cover-title").first()).not.toContainText(
      "斗罗大陆",
    );
  } finally {
    await request.delete(metaPath);
    await request.delete("/api/collections/" + node.id + "/cover");
  }
});
