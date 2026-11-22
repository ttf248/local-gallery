import { ensureLibraryReady, setWorkbenchMode } from "./helpers/library";
import { expect, test } from "@playwright/test";

test("发现页年份卡与时间线共用同一日期范围，旧目录年份书签仍可访问", async ({
  page,
  request,
}) => {
  await ensureLibraryReady(request);
  await setWorkbenchMode(request, "photo");

  await page.goto("/photo/explore");
  const yearOnlyCard = page.getByRole("button", { name: /2018/ });
  await expect(yearOnlyCard).toContainText("1 张");
  await yearOnlyCard.click();

  await expect(page).toHaveURL(/\/photo\?year=2018$/);
  await expect(page.getByRole("heading", { name: "全部照片" })).toBeVisible();
  await expect(page.locator(".album-bar__meta").first()).toContainText("1 张");
  await expect(
    page.getByRole("button", { name: "查看 year-only.png" }),
  ).toBeVisible();

  await page.goto("/photo/years/2024");
  await expect(
    page.getByRole("heading", { name: "2024 年目录照片" }),
  ).toBeVisible();
});
