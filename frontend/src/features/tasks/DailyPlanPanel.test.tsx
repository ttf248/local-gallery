import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import DailyPlanPanel from "./DailyPlanPanel";

describe("DailyPlanPanel", () => {
  it("说明所选分析模块能支持哪些智能相册维度", () => {
    render(
      <DailyPlanPanel
        enabled
        time="03:00"
        selectedModules={["metadata", "embedding"]}
        scanEnabled
        smartAlbumsEnabled
        peopleEnabled={false}
        ready
        onEnabledChange={vi.fn()}
        onTimeChange={vi.fn()}
        onModulesChange={vi.fn()}
        onScanChange={vi.fn()}
        onSmartAlbumsChange={vi.fn()}
        onPeopleEnabledChange={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        dirty
        saved={false}
        error={false}
        modules={[]}
        estimateLoading={false}
        estimateError={false}
      />,
    );

    expect(screen.getByText("有未保存的更改")).toBeVisible();
    const dimensions = screen.getByRole("status", {
      name: "智能相册维度计划",
    });
    expect(dimensions).toHaveTextContent(
      "本轮具备生成线索：时间、地点、场景。",
    );
    expect(dimensions).toHaveTextContent("人物需启用并选择人脸分析");
  });

  it("分析模块失败时报告失败并说明智能相册使用已有结果刷新", () => {
    render(
      <DailyPlanPanel
        enabled
        time="03:00"
        selectedModules={["metadata", "embedding"]}
        scanEnabled
        smartAlbumsEnabled
        peopleEnabled={false}
        ready
        onEnabledChange={vi.fn()}
        onTimeChange={vi.fn()}
        onModulesChange={vi.fn()}
        onScanChange={vi.fn()}
        onSmartAlbumsChange={vi.fn()}
        onPeopleEnabledChange={vi.fn()}
        onSave={vi.fn()}
        saving={false}
        dirty={false}
        saved={false}
        error={false}
        modules={[]}
        estimateLoading={false}
        estimateError={false}
        lastScheduledDate="2026-11-11"
        lastScheduledStatus="failed"
        lastScheduledError="analysis_failed"
      />,
    );

    expect(
      screen.getByText(
        "最近执行 2026-11-11 · 分析模块失败，智能相册已刷新已有结果",
      ),
    ).toBeInTheDocument();
  });
});
