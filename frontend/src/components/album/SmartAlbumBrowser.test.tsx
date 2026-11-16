import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SmartAlbumSummary } from "../../api/albums";
import type { AIJob, AIJobModule } from "../../api/aiJobs";
import SmartAlbumBrowser from "./SmartAlbumBrowser";

const MODULES: AIJobModule[] = [
  { type: "metadata", name: "EXIF 元数据", installed: true },
  { type: "embedding", name: "语义向量", installed: true },
  { type: "face", name: "人脸", installed: true },
];

function summary(
  overrides: Partial<SmartAlbumSummary> = {},
): SmartAlbumSummary {
  return {
    albumId: "a_1",
    dimension: "recommended",
    revision: 1,
    snapshotKey: "k",
    totalPhotos: 40,
    availablePhotos: 40,
    unavailablePhotos: 0,
    ungroupedPhotos: 40,
    hiddenGroupCount: 0,
    coverage: {
      module: "combined",
      total: 40,
      analyzed: 40,
      missing: 0,
      failed: 0,
      withEvidence: 0,
      available: true,
    },
    groups: [],
    cacheHit: true,
    ...overrides,
  };
}

function job(overrides: Partial<AIJob> = {}): AIJob {
  return {
    id: "j_1",
    type: "metadata",
    mode: "incremental",
    albumId: "a_1",
    status: "completed",
    stage: "",
    moduleVersion: "v1",
    total: 40,
    processed: 40,
    skipped: 0,
    failed: 0,
    done: 40,
    checkpoint: { offset: 40, batch: 1, moduleVersion: "v1" },
    computeDevice: "cpu",
    createdAt: "2026-11-16T00:00:00Z",
    updatedAt: "2026-11-16T00:00:00Z",
    elapsedMs: 1,
    speedPerSecond: 1,
    planned: 40,
    completed: 40,
    estimatedRemainingMs: 0,
    ...overrides,
  };
}

interface Options {
  summary?: SmartAlbumSummary;
  modules?: AIJobModule[];
  jobs?: AIJob[];
  peopleEnabled?: boolean;
  onAnalyzeDimension?: (
    type: "metadata" | "embedding" | "ocr" | "face",
  ) => void;
}

function renderBrowser({
  summary: data = summary(),
  modules = MODULES,
  jobs = [],
  peopleEnabled = true,
  onAnalyzeDimension = vi.fn(),
}: Options = {}) {
  render(
    <MemoryRouter>
      <SmartAlbumBrowser
        summary={data}
        loading={false}
        error={false}
        dimension="recommended"
        analyzing={false}
        rebuilding={false}
        onDimensionChange={vi.fn()}
        onAnalyze={vi.fn()}
        onAnalyzeDimension={onAnalyzeDimension}
        peopleEnabled={peopleEnabled}
        onRebuild={vi.fn()}
        onSaveOverride={vi.fn().mockResolvedValue(true)}
        onOpenGroup={vi.fn()}
        modules={modules}
        jobs={jobs}
      />
    </MemoryRouter>,
  );
  return { onAnalyzeDimension };
}

describe("相册内精选推荐的空态", () => {
  it("还没跑分析时给出补分析入口", () => {
    const { onAnalyzeDimension } = renderBrowser({ jobs: [] });

    expect(screen.getByText("还没有分析结果")).toBeTruthy();
    const metadata = screen.getByRole("button", {
      name: "补充EXIF 元数据分析",
    });
    const embedding = screen.getByRole("button", {
      name: "补充语义向量分析",
    });
    metadata.click();
    embedding.click();
    expect(onAnalyzeDimension).toHaveBeenCalledWith("metadata");
    expect(onAnalyzeDimension).toHaveBeenCalledWith("embedding");
  });

  it("人物分析没启用时不给人脸入口", () => {
    renderBrowser({ jobs: [], peopleEnabled: false });

    expect(screen.queryByRole("button", { name: "补充人脸分析" })).toBeNull();
  });

  it("分析模块没就绪时指向任务中心", () => {
    renderBrowser({
      jobs: [],
      modules: [
        { type: "metadata", name: "EXIF 元数据", installed: true },
        {
          type: "embedding",
          name: "语义向量",
          installed: false,
          reason: "model_missing",
        },
      ],
    });

    expect(screen.getByText("所需分析模块还没就绪")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "补充语义向量分析" }),
    ).toBeNull();
  });

  it("分析跑过但没凑出主题时说明准入规则", () => {
    renderBrowser({
      jobs: [job({ type: "metadata" }), job({ id: "j_2", type: "embedding" })],
    });

    expect(screen.getByText("暂时没有形成主题")).toBeTruthy();
    expect(screen.getAllByText(/至少两类线索一致/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "补充EXIF 元数据分析" }),
    ).toBeNull();
  });

  it("分析有失败项时先说失败", () => {
    renderBrowser({
      jobs: [job({ status: "failed", failed: 3 })],
    });

    expect(screen.getByText("分析有失败项")).toBeTruthy();
  });

  it("照片太少时说明还差多少张", () => {
    renderBrowser({
      summary: summary({
        totalPhotos: 5,
        availablePhotos: 5,
        ungroupedPhotos: 5,
        coverage: {
          module: "combined",
          total: 5,
          analyzed: 5,
          missing: 0,
          failed: 0,
          withEvidence: 0,
          available: true,
        },
      }),
      jobs: [job({ type: "metadata" }), job({ id: "j_2", type: "embedding" })],
    });

    expect(screen.getByText("照片还不够形成推荐")).toBeTruthy();
  });

  it("推荐维度也写清准入门槛", () => {
    renderBrowser();

    expect(screen.getByText(/至少 12/)).toBeTruthy();
  });
});
