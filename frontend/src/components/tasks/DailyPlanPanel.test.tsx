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
        saved={false}
        error={false}
        modules={[]}
        estimateLoading={false}
        estimateError={false}
      />,
    );

    const dimensions = screen.getByRole("status", {
      name: "智能相册维度计划",
    });
    expect(dimensions).toHaveTextContent(
      "本轮具备生成线索：时间、地点、场景。",
    );
    expect(dimensions).toHaveTextContent("人物需启用并选择人脸分析");
  });
});
