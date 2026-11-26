import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { SmartAlbumDimension, SmartAlbumSummary } from "../../api/albums";
import type { AIJob, AIJobModule, AnalysisType } from "../../api/aiJobs";
import AlbumGroupPanel from "./AlbumGroupPanel";

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
  dimension?: SmartAlbumDimension;
  onAnalyzeDimension?: (type: AnalysisType) => void;
  onOpenGroup?: (groupId: string | null) => void;
}

function renderPanel({
  summary: data = summary(),
  modules = MODULES,
  jobs = [],
  peopleEnabled = true,
  dimension = "recommended",
  onAnalyzeDimension = vi.fn(),
  onOpenGroup = vi.fn(),
}: Options = {}) {
  render(
    <MemoryRouter>
      <AlbumGroupPanel
        summary={data}
        loading={false}
        error={false}
        dimension={dimension}
        groupId={null}
        totalPhotos={40}
        onDimensionChange={vi.fn()}
        onOpenGroup={onOpenGroup}
        onClose={vi.fn()}
        analyzing={false}
        rebuilding={false}
        onAnalyze={vi.fn()}
        onAnalyzeDimension={onAnalyzeDimension}
        onRebuild={vi.fn()}
        onSaveOverride={vi.fn().mockResolvedValue(true)}
        peopleEnabled={peopleEnabled}
        modules={modules}
        jobs={jobs}
      />
    </MemoryRouter>,
  );
  return { onAnalyzeDimension, onOpenGroup };
}

describe("相册内的分组面板", () => {
  it("封面按原比例摆，不裁成方形", () => {
    renderPanel({
      dimension: "time",
      summary: summary({
        groups: [
          {
            id: "sg_1",
            dimension: "time",
            name: "2024年5月2日",
            suggestedName: "2024年5月2日",
            customName: false,
            photoCount: 3,
            coverResourceId: "f_1",
            coverVersion: "v1",
            hidden: false,
          },
        ],
      }),
    });

    const photo = screen.getByTestId("smart-album-cover-photo");
    expect(photo).toHaveClass("object-contain");
    expect(photo).not.toHaveClass("object-cover");
    expect(screen.getByTestId("smart-album-cover-backdrop")).toBeTruthy();
  });

  it("分组是照片的一种看法：面板里先给「全部照片」那一条", () => {
    const { onOpenGroup } = renderPanel({
      dimension: "time",
      summary: summary({
        groups: [
          {
            id: "sg_1",
            dimension: "time",
            name: "2024年5月2日",
            suggestedName: "2024年5月2日",
            customName: false,
            photoCount: 3,
            coverResourceId: "f_1",
            coverVersion: "v1",
            hidden: false,
          },
        ],
      }),
    });

    expect(screen.getByRole("button", { name: /全部照片/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^2024年5月2日/ })).toBeInTheDocument();
    screen.getByRole("button", { name: /^2024年5月2日/ }).click();
    expect(onOpenGroup).toHaveBeenCalledWith("sg_1");
    screen.getByRole("button", { name: /全部照片/ }).click();
    expect(onOpenGroup).toHaveBeenCalledWith(null);
  });

  it("分析覆盖率收在按需展开的说明里，默认不摆在面板上", () => {
    renderPanel({
      dimension: "time",
      summary: summary({
        groups: [
          {
            id: "sg_1",
            dimension: "time",
            name: "2024年5月2日",
            suggestedName: "2024年5月2日",
            customName: false,
            photoCount: 3,
            coverResourceId: "f_1",
            coverVersion: "v1",
            hidden: false,
          },
        ],
      }),
    });

    expect(screen.queryByText(/分析覆盖/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "分析说明" }));
    expect(screen.getByText(/分析覆盖/)).toBeInTheDocument();
  });
});

describe("相册内精选推荐的空态", () => {
  it("还没跑分析时给出补分析入口", () => {
    const { onAnalyzeDimension } = renderPanel({ jobs: [] });

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
    renderPanel({ jobs: [], peopleEnabled: false });

    expect(screen.queryByRole("button", { name: "补充人脸分析" })).toBeNull();
  });

  it("分析模块没就绪时指向任务中心", () => {
    renderPanel({
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
    renderPanel({
      jobs: [job({ type: "metadata" }), job({ id: "j_2", type: "embedding" })],
    });

    expect(screen.getByText("暂时没有形成主题")).toBeTruthy();
    expect(screen.getAllByText(/至少两类线索一致/).length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: "补充EXIF 元数据分析" }),
    ).toBeNull();
  });

  it("分析有失败项时先说失败", () => {
    renderPanel({
      jobs: [job({ status: "failed", failed: 3 })],
    });

    expect(screen.getByText("分析有失败项")).toBeTruthy();
  });

  it("照片太少时说明还差多少张", () => {
    renderPanel({
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
    renderPanel();

    // 门槛写在按需展开的说明里，不占面板的主视觉。
    fireEvent.click(screen.getByRole("button", { name: "分析说明" }));
    expect(screen.getByText(/至少 12/)).toBeTruthy();
  });
});
