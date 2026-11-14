import { expect, test } from "@playwright/test";
import {
  ensureLibraryReady,
  ensureMetadataReady,
  resetWorkbenchMode,
} from "./helpers/library";

test.beforeEach(async ({ request }) => {
  test.setTimeout(180_000);
  await resetWorkbenchMode(request);
  // 地点页读的是媒体库快照：这条用例要能单独跑，不能等别的用例先把库准备好。
  await ensureLibraryReady(request);
  // 坐标来自元数据分析任务：没有这一趟，临时库里就没有带位置的照片。
  await ensureMetadataReady(request);
});

test("侧栏的足迹入口打开的是新的地点页", async ({ page }) => {
  await page.goto("/photo");

  await page.getByRole("link", { name: "足迹" }).click();
  await expect(page).toHaveURL(/\/photo\/travels$/);
  // 页面名不再显示在内容区，进来看到的是跨度筛选与右栏的地图。
  await expect(page.getByRole("radiogroup", { name: "时间跨度" })).toBeVisible();
  await expect(page.locator(".travel-layout__aside")).toBeVisible();
});

test("地图在正文右栏，照片位置画成点云", async ({ page }) => {
  await page.goto("/photo/travels");

  // 地图不用选中什么就一直在：它就在正文右栏里，滚动时跟着。
  const map = page.locator(".travel-layout__aside").getByRole("img", { name: /小地图/ });
  await expect(map).toBeVisible();

  // 临时库里三个坐标（杭州 ×3、上海 ×2、北京 ×1）—— 这一条断言是
  // EXIF → 匹配 → 聚合 → 端点 → 渲染整条链路的端到端验证。
  await expect(page.locator(".travel-mini-map__point")).toHaveCount(3);
});

test("时间跨度是一排分段，切换后写进地址并收窄行程", async ({ page }) => {
  await page.goto("/photo/travels");

  const span = page.getByRole("radiogroup", { name: "时间跨度" });
  await expect(span).toBeVisible();
  // 缺省是最近五年，不写进地址。
  await expect(page).not.toHaveURL(/span=/);

  await page.getByRole("radio", { name: "1年" }).click();
  await expect(page).toHaveURL(/span=1y/);

  // 临时库的照片拍在 2024-05 与 2025-09：跨度锚在最后一月（2025-09），
  // 最近一年只剩 2025 年那一段行程。
  await expect(page.locator(".travel-trips__year")).toHaveCount(1);
  await expect(page.locator(".travel-trips__year").first()).toHaveText("2025");
});

test("行程按年份倒序，两栏并排", async ({ page }) => {
  await page.goto("/photo/travels");

  // 行程目录是异步来的：先等第一个年份出现，再读整列。
  await expect(page.locator(".travel-trips__year").first()).toBeVisible();
  // 年份倒序：最近的一段排在最前面。
  const years = await page.locator(".travel-trips__year").allTextContents();
  expect(years).toEqual(["2025", "2024"]);

  // 宽屏上两栏并排 —— 一段行程只有两行高，一列排下来整页是空的。
  const columns = await page
    .locator(".travel-trips__list")
    .first()
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ").length).toBe(2);
});

test("一段行程是一张卡片，点开才展开照片", async ({ page }) => {
  await page.goto("/photo/travels");

  // 杭州 → 上海相隔一天，是同一段行程；北京隔了一年，另起一段。
  const segment = page.getByRole("region", { name: "2024-05-02 至 2024-05-03" });
  await expect(segment).toBeVisible();
  await expect(segment.getByRole("button", { name: /杭州市/ })).toBeVisible();
  await expect(segment.getByRole("button", { name: /上海市/ })).toBeVisible();

  // 收起的时候没有照片带。
  await expect(
    segment.getByRole("button", { name: "看这一段的照片" }),
  ).toHaveCount(0);

  await segment.getByRole("button", { name: /2024-05-02 至 2024-05-03/ }).click();

  // 照片带是这一段的门面：五张照片都在带子上。
  await expect(
    segment.getByRole("button", { name: "看这一段的照片" }),
  ).toHaveCount(5);

  await expect(
    page.getByRole("region", { name: "2025-09-10 至 2025-09-10" }),
  ).toBeVisible();
});

test("展开一段，就地把这一段的照片取回来", async ({ page }) => {
  await page.goto("/photo/travels");

  const segment = page.getByRole("region", { name: "2024-05-02 至 2024-05-03" });
  await segment.getByRole("button", { name: /2024-05-02 至 2024-05-03/ }).click();

  await expect(segment.locator(".travel-trip-card__grid")).toBeVisible();
  // 整段的五张照片都在展开后的照片墙里。
  await expect(segment.locator(".travel-trip-card__grid img")).toHaveCount(5);
});

test("悬停一段行程，浮出带箭头的轨迹图", async ({ page }) => {
  await page.goto("/photo/travels");

  const segment = page.getByRole("region", { name: "2024-05-02 至 2024-05-03" });
  await segment.hover();

  const preview = page.locator(".travel-trip-card__preview");
  await expect(preview).toBeVisible();
  // 浮层要够大：地图得看得全。
  const box = await preview.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(400);
  const map = await preview.locator(".travel-preview__map").boundingBox();
  expect(map!.width).toBeGreaterThanOrEqual(380);
  // 临时库里那一段是杭州 → 上海：两站、一段轨迹、一个箭头。
  await expect(preview.locator(".travel-preview__step")).toHaveCount(2);
  await expect(preview.locator(".travel-preview__route")).toHaveCount(1);
  await expect(preview.locator(".travel-preview__arrowhead")).toHaveCount(1);
  // 站点表按次序给出每一站。
  await expect(preview.locator(".travel-preview__stop")).toHaveCount(2);
});

test("地图可以切到完整地图", async ({ page }) => {
  await page.goto("/photo/travels");

  const map = page.getByRole("img", { name: /小地图/ });
  const scope = page.getByRole("radiogroup", { name: "地图范围" });
  // 缺省是只看有数据的区域。
  await expect(scope.getByRole("radio", { name: "有数据" })).toBeChecked();

  const zoomed = Number((await map.getAttribute("viewBox"))?.split(" ")[2]);

  await scope.getByRole("radio", { name: "完整地图" }).click();

  await expect(scope.getByRole("radio", { name: "完整地图" })).toBeChecked();
  // 完整地图的画面更宽：不再裁到照片的那一片。
  const full = Number((await map.getAttribute("viewBox"))?.split(" ")[2]);
  expect(full).toBeGreaterThan(zoomed);
});

test("点地名进这个地方，并且带着筛选条件", async ({ page }) => {
  await page.goto("/photo/travels?level=city");

  await page
    .getByRole("region", { name: "2024-05-02 至 2024-05-03" })
    .getByRole("button", { name: /杭州市/ })
    .click();

  await expect(page).toHaveURL(/\/photo\/travels\/place\/330100/);
  await expect(page).toHaveURL(/level=city/);
});

test("归并粒度可以切换", async ({ page }) => {
  await page.goto("/photo/travels");

  const level = page.getByRole("radiogroup", { name: "归并粒度" });
  await expect(level).toBeVisible();
  await level.getByRole("radio", { name: "市" }).click();
  await expect(page).toHaveURL(/level=city/);
  await level.getByRole("radio", { name: "区县" }).click();
  await expect(page).toHaveURL(/level=district/);
});

test("旧的拍摄地点路由已经不存在", async ({ page }) => {
  await page.goto("/photo/locations");

  // 破坏性改名后不留兼容跳转：旧地址落回照片库。
  await expect(page).toHaveURL(/\/photo$/);
  await expect(page.getByRole("heading", { name: "足迹" })).toHaveCount(0);
});
