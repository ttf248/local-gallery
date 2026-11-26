import type {TaskCenterPlan} from "../../hooks/useTaskCenter";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AIJobEstimate } from "../../api/aiJobs";
import RunSummaryPanel from "./RunSummaryPanel";

function estimateFixture(
  overrides: Partial<AIJobEstimate> = {},
): AIJobEstimate {
  return {
    generatedAt: "2026-11-11T02:00:00Z",
    libraryRevision: 7,
    libraryReady: true,
    totalImages: 12345,
    modules: [
      {
        type: "metadata",
        name: "照片元数据",
        installed: true,
        available: true,
        version: "metadata-v1",
        incremental: {
          count: 320,
          estimatedDurationMs: 45000,
          sampleCount: 3,
          sampleImages: 900,
        },
        full: {
          count: 12345,
          estimatedDurationMs: 1740000,
          sampleCount: 3,
          sampleImages: 900,
        },
      },
    ],
    sequence: {
      incremental: {
        count: 320,
        estimatedDurationMs: 45000,
        modules: ["metadata"],
      },
      full: {
        count: 12345,
        estimatedDurationMs: 1740000,
        modules: ["metadata"],
      },
    },
    ...overrides,
  };
}

describe("RunSummaryPanel", () => {
  it("把增量与全量并排列出张数与预计耗时", () => {
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimate={estimateFixture()}
        estimating={false}
        error={false}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={() => {}}
      />,
    );

    const table = screen.getByRole("group", { name: "本次规模" });
    expect(within(table).getByText("320 张")).toBeInTheDocument();
    expect(within(table).getByText("12,345 张")).toBeInTheDocument();
    expect(within(table).getByText("约 45 秒")).toBeInTheDocument();
    expect(within(table).getByText("约 29 分钟")).toBeInTheDocument();
    expect(screen.getByText(/整库 12,345 张/)).toBeInTheDocument();
    expect(
      screen.getByText(/按最近 3 次照片元数据历史任务/),
    ).toBeInTheDocument();
  });

  it("没有历史记录时明说算不出来，不给假数字", () => {
    const estimate = estimateFixture();
    estimate.modules[0].incremental = {
      count: 320,
      estimatedDurationMs: null,
      sampleCount: 0,
      sampleImages: 0,
    };
    estimate.modules[0].full = {
      count: 12345,
      estimatedDurationMs: null,
      sampleCount: 0,
      sampleImages: 0,
    };
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimate={estimate}
        estimating={false}
        error={false}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={() => {}}
      />,
    );

    const table = screen.getByRole("group", { name: "本次规模" });
    expect(within(table).getAllByText("无法估算（历史样本不足）")).toHaveLength(
      2,
    );
    // 张数照常给出。
    expect(within(table).getByText("320 张")).toBeInTheDocument();
    expect(screen.getByText(/这个模块还没有跑过/)).toBeInTheDocument();
  });

  it("核算中先给一句话，不摆空表", () => {
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimating estimate={null}
        error={false}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText("正在核算本次规模…")).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "本次规模" }),
    ).not.toBeInTheDocument();
  });

  it("核算失败时说明失败，并给出重新核算的入口", () => {
    const onRefresh = vi.fn();
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimating={false}
        error estimate={null}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={onRefresh}
      />,
    );

    expect(screen.getByText(/本次规模核算失败/)).toBeInTheDocument();
    screen.getByRole("button", { name: /重新核算/ }).click();
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it("模块不可用时说明原因，不出表格", () => {
    const estimate = estimateFixture();
    estimate.modules[0].available = false;
    estimate.modules[0].reason = "people_analysis_disabled";
    estimate.modules[0].incremental = null;
    estimate.modules[0].full = null;
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimate={estimate}
        estimating={false}
        error={false}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText(/需先启用人物分析/)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "本次规模" }),
    ).not.toBeInTheDocument();
  });

  it("媒体库没就绪时说明要先去扫描", () => {
    const estimate = estimateFixture({ libraryReady: false, totalImages: 0 });
    render(
      <RunSummaryPanel plan={{peopleEnabled:true} as TaskCenterPlan} running={false} onStart={vi.fn()} onFaceModelChange={vi.fn()}
        onModeChange={vi.fn()}
        estimate={estimate}
        estimating={false}
        error={false}
        selection={{module:"metadata",mode:"incremental",setMode:vi.fn(),setModule:vi.fn()}}
        onRefresh={() => {}}
      />,
    );

    expect(screen.getByText(/媒体库尚未就绪/)).toBeInTheDocument();
    expect(
      screen.queryByRole("group", { name: "本次规模" }),
    ).not.toBeInTheDocument();
  });
});
