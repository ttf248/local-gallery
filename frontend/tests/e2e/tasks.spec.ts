import { expect, test } from "@playwright/test";
import { scannedNodes } from "./helpers/library";

test.describe("任务中心", () => {
  test("四个页签各自承载一段内容，切页签写进 URL", async ({ page }) => {
    await page.goto("/tasks/run");
    const tablist = page.getByRole("navigation", { name: "任务中心分区" });
    await expect(tablist).toBeVisible();
    await expect(page.getByRole("link", { name: "运行" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // 空闲态给出开始分析的入口：模块芯片 + 处理方式 + 开始按钮。
    await expect(
      page.getByRole("group", { name: "分析模块" }).getByRole("button", {
        name: "照片元数据", exact:true,
      }),
    ).toBeVisible();
    await expect(page.getByRole("radiogroup",{name:"处理方式"}).getByRole("radio",{name:"增量",exact:true})).toBeVisible();
    await expect(page.getByRole("radiogroup",{name:"处理方式"}).getByRole("radio",{name:"全量",exact:true})).toBeVisible();
    // 按钮文案带上本次张数，所以按正则找。
    await expect(page.getByRole("button", { name: /开始分析/ })).toBeVisible();

    // 顶部状态摘要：现在是什么状态、队列里有没有等待、主要操作是哪一枚。
    const summary = page.getByRole("region", { name: "状态摘要" });
    await expect(summary).toBeVisible();
    await expect(summary.getByRole("heading", { name: /队列(空闲|等待中)|上次运行失败/ })).toBeVisible();
    await expect(
      summary.getByRole("button", { name: /开始分析/ }),
    ).toBeVisible();

    // 侧栏不再挂二级菜单，只在条目上标出当前页签。
    const sidebar = page.locator('aside[aria-label="主导航"]');
    await expect(sidebar.getByRole("button", { name: /本机存储/ })).toHaveCount(
      0,
    );
    await expect(sidebar.getByTestId("nav-tab-label")).toHaveCount(0);
    await expect(page).toHaveTitle(/ · 运行 · Local Gallery$/);

    await page.getByRole("link", { name: "本机存储" }).click();
    await expect(page).toHaveURL(/\/tasks\/storage$/);
    await expect(page.getByRole("heading", { name: "派生缓存" })).toBeVisible();
    await expect(sidebar.getByTestId("nav-tab-label")).toHaveCount(0);
    await expect(page).toHaveTitle(/ · 本机存储 · Local Gallery$/);

    // 深链直接落在那一屏。
    await page.goto("/tasks/plan");
    await expect(page.getByLabel("每日自动任务开始时间")).toBeVisible();
  });

  test("空闲时给出增量与全量的规模对比，并带上本次张数", async ({ page }) => {
    await page.goto("/tasks/run");
    await scannedNodes(page.request);
    await expect
      .poll(async () => {
        const response = await page.request.get("/api/ai/jobs/estimate");
        if (!response.ok()) return false;
        const body = (await response.json()) as {
          estimate?: { libraryReady?: boolean };
        };
        return body.estimate?.libraryReady ?? false;
      })
      .toBe(true);
    // 这次扫描由 API 测试助手触发，页面没有收到浏览器内的扫描完成事件；
    // 重新加载以从已就绪的图库读取新的规模估算。
    await page.reload();
    await expect(page.getByRole("heading",{name:"本次规模",exact:true})).toBeVisible();
    await expect(page.getByRole("group",{name:"本次规模"}).getByRole("radio",{name:/^增量/})).toBeVisible();
    await expect(page.getByRole("group",{name:"本次规模"}).getByRole("radio",{name:/^全量/})).toBeVisible();
    const fullScale = page.getByRole("group", {name:"本次规模"}).getByRole("radio", {name:/^全量/});
    await expect(fullScale).toHaveAccessibleName(/全量.*[\d,]+ 张.*(约|无法估算|秒|分钟)/);
    // 开始按钮带上本次要处理的张数。
    await expect(
      page.getByRole("button", { name: /开始分析 · [\d,]+ 张/ }),
    ).toBeVisible();
    // 切到全量，按钮上的张数跟着换，表格不重新请求。
    await page.getByRole("radiogroup",{name:"处理方式"}).getByRole("radio",{name:"全量",exact:true}).click();
    await expect(
      page.getByRole("button", { name: /开始分析 · [\d,]+ 张/ }),
    ).toBeVisible();
  });

  test("本机存储给出派生缓存占用、模型与产物路径", async ({ page }) => {
    await page.goto("/tasks/storage");
    await expect(page.getByRole("heading", { name: "派生缓存" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "AI 模型与产物" }),
    ).toBeVisible();
    // 「缩略图」在重建范围勾选项里也有一份，这里认的是占用行。
    await expect(
      page.locator("span.text-ink-2", { hasText: /^缩略图$/ }),
    ).toBeVisible();
    await expect(page.getByText("转换图", { exact: true })).toBeVisible();
    // 路径默认收起，展开后相对路径对所有设备可见；本机浏览器还能看到绝对锚点。
    await page.getByText("路径", { exact: true }).click();
    await expect(page.getByText("state/ai_jobs.json")).toBeVisible();
    await expect(page.getByText("缓存根目录", { exact: true })).toBeVisible();
  });

  test("每日计划的时间可以保存并在刷新后保留", async ({ page }) => {
    await page.goto("/tasks/plan");
    const timeInput = page.getByLabel("每日自动任务开始时间");
    const planSwitch = page.getByRole("switch", { name: "启用每日自动任务" });
    const scanTask = page.getByRole("checkbox", { name: "扫描所有媒体目录" });
    const smartAlbumTask = page.getByRole("checkbox", {
      name: "生成智能相册分组",
    });
    await expect(timeInput).toBeEnabled();
    await expect(scanTask).toBeChecked();
    await expect(smartAlbumTask).toBeChecked();
    await planSwitch.click();
    await scanTask.uncheck();
    await timeInput.fill("04:15");
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("已保存")).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("每日自动任务开始时间")).toHaveValue("04:15");
    await expect(
      page.getByRole("switch", { name: "启用每日自动任务" }),
    ).toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "扫描所有媒体目录" }),
    ).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "生成智能相册分组" }),
    ).toBeChecked();
  });

  test("任务中心能手动生成智能相册分组", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/tasks/run");
    await scannedNodes(page.request, "photo");

    const start = page.getByRole("button", { name: "增量更新" });
    await expect(start).toBeVisible();
    await start.click();

    // 后台任务跑完，面板上给出重算与复用的数量。
    await expect(page.getByTestId("smart-album-refresh-done")).toBeVisible({
      timeout: 90_000,
    });
    await expect(page.getByTestId("smart-album-refresh-done")).toContainText(
      "个相册",
    );
    // 任务结束就不再提供「取消」。
    await expect(page.getByRole("button", { name: "取消" })).toHaveCount(0);
  });

  test("跑完一次分析后任务记录里出现新的任务与产出明细", async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto("/tasks/run");
    await scannedNodes(page.request);
    await expect(page.getByRole("radiogroup",{name:"处理方式"}).getByRole("radio",{name:"全量",exact:true})).toBeVisible();
    const start = page.getByRole("button", { name: /开始分析/ });
    await expect(start).toBeVisible();
    const startResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/ai/jobs") &&
        response.request().method() === "POST",
    );
    await page.getByRole("radiogroup",{name:"处理方式"}).getByRole("radio",{name:"全量",exact:true}).click();
    await start.click();
    const startedJob = (await (await startResponse).json()).job as {
      id: string;
    };

    // 任务跑起来后状态面板给出进度读数。
    await expect(page.getByText("预计剩余")).toBeVisible({ timeout: 30_000 });

    // 同一测试库可能已有定时任务；跟踪本次启动的 ID，避免把旧记录当成本次结果。
    await expect
      .poll(
        async () => {
          const response = await page.request.get(
            `/api/ai/jobs/${encodeURIComponent(startedJob.id)}`,
          );
          if (!response.ok()) return "missing";
          const job = (await response.json()) as { status: string };
          return job.status;
        },
        { timeout: 90_000 },
      )
      .toMatch(/^(completed|failed|cancelled)$/);

    // 任务结束后任务记录里多出一行，展开后有产出明细。
    await page.getByRole("link", { name: "任务记录" }).click();
    const history = page.locator(
      `[data-testid="task-history-row"][data-job-id="${startedJob.id}"]`,
    );
    await expect(history).toBeVisible({ timeout: 60_000 });
    await history.locator(":scope > summary").click();
    await expect(history.getByText("产出明细")).toBeVisible();
    await expect(history.getByText("解析结果")).toBeVisible();
    // 展开后给出这次任务自己的产物位置与占用。
    await expect(history.getByText("本次产物")).toBeVisible();
    await expect(
      history.getByText(/derived\/metadata\/metadata\/batches\//),
    ).toBeVisible();
    // 临时库的图都是无 EXIF 的 1×1 PNG，取不到拍摄时间 / 相机 / GPS，
    // 因此这里只断言解析结果这一行；字段产出的渲染由 Vitest 覆盖。

    await history.getByRole("button", { name: "删除任务记录" }).click();
    await page.getByRole("dialog").getByRole("button",{name:"删除记录",exact:true}).click();
    await expect(history).toHaveCount(0);
    const response = await page.request.get("/api/ai/jobs");
    const body = (await response.json()) as {
      snapshot: { jobs: { id: string }[]; queue: string[] };
    };
    expect(body.snapshot.jobs.some((job) => job.id === startedJob.id)).toBe(
      false,
    );
    expect(body.snapshot.queue).not.toContain(startedJob.id);
  });
});
