import { expect, test } from "@playwright/test";

test("扫描并打开示例相册", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByText("Local Gallery", { exact: false }).first(),
  ).toBeVisible();

  const scanButton = page
    .getByRole("button", { name: /开始扫描|重新扫描/ })
    .first();
  if (await scanButton.isVisible()) {
    await scanButton.click();
  }

  await expect(
    page.getByText("sample-album", { exact: false }).first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  const response = await page.request.get("/api/library");
  expect(response.ok()).toBeTruthy();
  const body = (await response.json()) as {
    result: {
      root: string;
      albums: Array<{ path: string; coverImage: string }>;
    };
  };
  expect(body.result.root).toMatch(/^r_[0-9a-f]{12}$/);
  expect(body.result.albums[0]?.path).toMatch(/^a_/);
  expect(body.result.albums[0]?.coverImage).toMatch(/^f_/);
});

test("设置页可加载服务端配置", async ({ page }) => {
  await page.goto("/settings");
  await expect(
    page.getByText("服务端", { exact: false }).first(),
  ).toBeVisible();
  await expect(
    page.getByText("图像根目录", { exact: false }).first(),
  ).toBeVisible();
});
