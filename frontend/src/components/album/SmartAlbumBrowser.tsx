import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  SmartAlbumDimension,
  SmartAlbumOverride,
  SmartAlbumSummary,
} from "../../api/albums";
import type { AnalysisType } from "../../api/aiJobs";
import RenditionImage from "../common/RenditionImage";
import ErrorBanner from "../common/ErrorBanner";

interface Props {
  summary?: SmartAlbumSummary;
  loading: boolean;
  error: boolean;
  dimension: SmartAlbumDimension;
  analyzing: boolean;
  rebuilding: boolean;
  onDimensionChange: (dimension: SmartAlbumDimension) => void;
  onAnalyze: () => void;
  onAnalyzeDimension: (type: AnalysisType) => void;
  peopleEnabled: boolean;
  onRebuild: () => void;
  onSaveOverride: (
    groupId: string,
    override: SmartAlbumOverride,
  ) => Promise<boolean>;
  onOpenGroup: (groupId: string) => void;
}

const DIMENSIONS: readonly [SmartAlbumDimension, string][] = [
  ["recommended", "精选推荐"],
  ["time", "时间"],
  ["place", "地点"],
  ["people", "人物"],
  ["scene", "场景"],
];

export default function SmartAlbumBrowser({
  summary,
  loading,
  error,
  dimension,
  analyzing,
  rebuilding,
  onDimensionChange,
  onAnalyze,
  onAnalyzeDimension,
  peopleEnabled,
  onRebuild,
  onSaveOverride,
  onOpenGroup,
}: Props) {
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const visibleGroups =
    summary?.groups.filter((group) => showHiddenGroups || !group.hidden) ?? [];
  const requiredModule: Record<SmartAlbumDimension, AnalysisType> = {
    recommended: "metadata",
    time: "metadata",
    place: "metadata",
    people: "face",
    scene: "embedding",
  };
  const requiredModuleNames: Record<AnalysisType, string> = {
    metadata: "EXIF 元数据",
    embedding: "语义向量",
    ocr: "OCR 文字",
    face: "人脸",
  };
  const analyzableMissing = summary
    ? Math.max(0, summary.coverage.missing - summary.unavailablePhotos)
    : 0;
  const emptyDescription = (() => {
    if (!summary) return "正在读取这本相册的分析线索…";
    if (summary.hiddenGroupCount > 0 && !showHiddenGroups) {
      return "当前分组已隐藏，可选择显示已隐藏分组。";
    }
    if (summary.coverage.reason === "people_analysis_disabled") {
      return "人物分组依赖人脸分析。先到任务中心启用人物分析，再把人脸分析加入运行或每日计划。";
    }
    if (dimension === "recommended") {
      return "当前文件夹的时间、地点、人物和场景线索还没有形成足够一致且有区分度的主题。详细分类仍可在其他页签查看。";
    }
    if (!summary.coverage.available) {
      return "所需分析模块当前不可用；可在任务中心的本机存储页查看模型状态。";
    }
    if (analyzableMissing > 0) {
      return `还有 ${analyzableMissing} 张照片没有完成${requiredModuleNames[requiredModule[dimension]]}分析。`;
    }
    if (summary.unavailablePhotos > 0) {
      return "尚未分析的照片当前不可读取；请先检查本地文件并重新扫描媒体库。";
    }
    if (summary.coverage.withEvidence < 3) {
      return `分析已完成，但只有 ${summary.coverage.withEvidence} 张照片含有可用线索；每组至少需要 3 张。`;
    }
    return "分析已完成，但当前线索没有形成达到最低数量的分组。";
  })();
  const canAnalyzeDimension = Boolean(
    summary &&
    dimension !== "recommended" &&
    summary.coverage.available &&
    analyzableMissing > 0 &&
    !(dimension === "people" && !peopleEnabled),
  );

  return (
    <section className="page-shell min-h-0 flex-1 overflow-auto py-6">
      <div>
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-title font-semibold text-fg">按线索浏览</h2>
            <p className="mt-1 text-meta text-fg-muted">
              只在这本相册内分组；原始照片与文件保持不变。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary && summary.hiddenGroupCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHiddenGroups((value) => !value)}
                className="btn btn-sm btn-ghost"
                aria-pressed={showHiddenGroups}
              >
                {showHiddenGroups
                  ? "隐藏已隐藏分组"
                  : `显示已隐藏 · ${summary.hiddenGroupCount}`}
              </button>
            )}
            <button
              type="button"
              onClick={onRebuild}
              disabled={rebuilding || loading}
              className="btn btn-sm btn-secondary"
            >
              {rebuilding ? "正在重建…" : "重建分组"}
            </button>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzing}
              className="btn btn-sm btn-primary"
            >
              {analyzing ? "正在分析…" : "分析当前相册"}
            </button>
          </div>
        </div>

        <div
          className="mb-5 flex flex-wrap gap-2"
          role="tablist"
          aria-label="智能分组维度"
        >
          {DIMENSIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={dimension === key}
              onClick={() => onDimensionChange(key)}
              className={`rounded-full border px-4 py-2 text-body transition-colors ${
                dimension === key
                  ? "border-brand/40 bg-brand/10 text-brand-ink"
                  : "border-border bg-bg-elevated text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorBanner className="rounded-xl p-6">
            智能分组读取失败，请重试。
          </ErrorBanner>
        ) : loading || !summary ? (
          <div className="rounded-xl border border-border bg-bg-elevated p-6 text-body text-fg-muted">
            正在读取这本相册的分析线索…
          </div>
        ) : (
          <>
            {dimension === "recommended" ? (
              <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-elevated px-4 py-3 text-meta text-fg-muted">
                <span>
                  精选主题{" "}
                  {visibleGroups.filter((group) => !group.hidden).length} 组
                </span>
                <span>
                  覆盖 {summary.totalPhotos - summary.ungroupedPhotos} 张
                </span>
                <span>可用照片 {summary.availablePhotos}</span>
              </div>
            ) : (
              <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-elevated px-4 py-3 text-meta text-fg-muted">
                <span>
                  分析覆盖 {summary.coverage.analyzed}/{summary.coverage.total}
                </span>
                <span>
                  未分析{" "}
                  {Math.max(
                    0,
                    summary.coverage.missing - summary.unavailablePhotos,
                  )}{" "}
                  张
                </span>
                <span>有效线索 {summary.coverage.withEvidence} 张</span>
                <span>未分组 {summary.ungroupedPhotos} 张</span>
                {summary.coverage.failed > 0 && (
                  <span>分析失败 {summary.coverage.failed} 张</span>
                )}
                {summary.unavailablePhotos > 0 && (
                  <span>文件不可用 {summary.unavailablePhotos} 张</span>
                )}
                {!summary.coverage.available && summary.coverage.reason && (
                  <span className="text-warning">
                    {summary.coverage.reason === "people_analysis_disabled"
                      ? "人物分析尚未启用"
                      : "所需分析模块暂不可用"}
                  </span>
                )}
              </div>
            )}

            {visibleGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-bg-elevated/60 px-6 py-14 text-center">
                <h3 className="text-body font-medium text-fg">
                  还没有可展示的分组
                </h3>
                <p className="mt-2 text-meta text-fg-muted">
                  {emptyDescription}
                </p>
                {summary.coverage.reason === "people_analysis_disabled" ? (
                  <Link
                    to="/tasks/plan"
                    className="btn btn-sm btn-outline mt-4"
                  >
                    去任务中心启用
                  </Link>
                ) : canAnalyzeDimension ? (
                  <button
                    type="button"
                    onClick={() =>
                      onAnalyzeDimension(requiredModule[dimension])
                    }
                    disabled={analyzing}
                    className="btn btn-sm btn-outline mt-4"
                  >
                    {analyzing
                      ? "已加入分析队列…"
                      : `补充${requiredModuleNames[requiredModule[dimension]]}分析`}
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleGroups.map((group) => (
                  <article
                    key={group.id}
                    className={`overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm ${group.hidden ? "opacity-65" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenGroup(group.id)}
                      className="group relative block aspect-[4/3] w-full overflow-hidden bg-bg-subtle text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                      aria-label={`打开分组 ${group.name}，${group.photoCount} 张`}
                    >
                      {group.coverResourceId ? (
                        <RenditionImage
                          fileId={group.coverResourceId}
                          version={group.coverVersion}
                          alt=""
                          displayWidth={320}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-fg-subtle">
                          暂无封面
                        </div>
                      )}
                      {group.hidden && (
                        <span className="absolute left-3 top-3 rounded-full bg-bg/90 px-2 py-1 text-xs text-fg-muted">
                          已隐藏
                        </span>
                      )}
                      {group.overrideConflict && (
                        <span className="absolute right-3 top-3 rounded-full bg-bg/90 px-2 py-1 text-xs text-warning">
                          修改待确认
                        </span>
                      )}
                    </button>
                    <div className="p-3">
                      {editingGroupId === group.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void onSaveOverride(group.id, {
                              name: nameDraft,
                            }).then((saved) => {
                              if (saved) setEditingGroupId(null);
                            });
                          }}
                          className="flex gap-2"
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(event) =>
                              setNameDraft(event.target.value)
                            }
                            maxLength={60}
                            aria-label="分组名称"
                            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-meta text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          />
                          <button
                            type="submit"
                            className="text-meta text-brand hover:underline"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingGroupId(null)}
                            className="text-meta text-fg-muted hover:text-fg"
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3
                              className="truncate text-body font-medium text-fg"
                              title={group.name}
                            >
                              {group.name}
                            </h3>
                            <p className="mt-1 text-meta text-fg-muted">
                              {group.photoCount} 张照片
                            </p>
                            {group.dimension === "recommended" && (
                              <p
                                className="mt-1 text-meta text-fg-subtle"
                                title={group.recommendationReasons?.join(" · ")}
                              >
                                {group.recommendationReasons?.join(" · ")}
                              </p>
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroupId(group.id);
                              setNameDraft(
                                group.customName
                                  ? group.name
                                  : group.suggestedName,
                              );
                            }}
                            className="shrink-0 rounded px-1.5 py-1 text-meta text-fg-muted hover:bg-bg-subtle hover:text-fg"
                            aria-label={`重命名 ${group.name}`}
                          >
                            重命名
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void onSaveOverride(group.id, {
                            hidden: !group.hidden,
                          })
                        }
                        className="mt-2 text-meta text-fg-muted hover:text-fg"
                      >
                        {group.hidden ? "取消隐藏" : "隐藏分组"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
