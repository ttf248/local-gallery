import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  SmartAlbumDimension,
  SmartAlbumOverride,
  SmartAlbumSummary,
} from "../../api/albums";
import type { AIJob, AIJobModule, AnalysisType } from "../../api/aiJobs";
import { smartAlbumEvidenceDimensions } from "../../utils/smartAlbum";
import ErrorBanner from "../common/ErrorBanner";
import SmartAlbumCover from "./SmartAlbumCover";
import SmartAlbumEvidence from "./SmartAlbumEvidence";

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
  /** 分析模块的安装状态：推荐维度要知道缺哪个模块。 */
  modules: AIJobModule[];
  /** 全部分析任务记录：推荐维度要知道分析过没有、跑成功没有。 */
  jobs: AIJob[];
}

const DIMENSIONS: readonly [SmartAlbumDimension, string][] = [
  ["recommended", "精选推荐"],
  ["time", "时间"],
  ["place", "地点"],
  ["people", "人物"],
  ["scene", "场景"],
];

/**
 * 推荐成立缺一不可的两个模块。
 *
 * EXIF 给出时间与地点线索，语义向量给出场景线索 —— 这两类对上了
 * 才谈得上「多条线索指向同一批照片」。人物线索是加分项：
 * 没有它照样能出推荐，只是少一类证据。
 */
const ESSENTIAL_RECOMMENDATION_MODULES: readonly AnalysisType[] = [
  "metadata",
  "embedding",
];

/** 精选推荐要吃的三个模块：时间地点、场景、人物。 */
const RECOMMENDATION_MODULES: readonly AnalysisType[] = [
  ...ESSENTIAL_RECOMMENDATION_MODULES,
  "face",
];

/** 精选推荐的准入门槛：至少 12 张、至少两类线索一致。 */
const RECOMMENDATION_MINIMUM_PHOTOS = 12;

const requiredModuleNames: Record<AnalysisType, string> = {
  metadata: "EXIF 元数据",
  embedding: "语义向量",
  ocr: "OCR 文字",
  face: "人脸",
  similarity: "相似照片特征",
};

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
  modules,
  jobs,
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
  const analyzableMissing = summary
    ? Math.max(0, summary.coverage.missing - summary.unavailablePhotos)
    : 0;

  // 精选推荐同时吃三类线索：EXIF 时间地点、语义向量场景、人脸人物。
  // 推荐维度自己的 coverage 是「combined」，拿不到模块级进度，只能
  // 从任务记录与模块安装状态推断 —— 这两样相册页已经在取了。
  const recommendation = recommendationState({
    summary,
    modules,
    jobs,
    peopleEnabled,
  });

  const emptyDescription = (() => {
    if (!summary) return "正在读取这本相册的分析线索…";
    if (summary.hiddenGroupCount > 0 && !showHiddenGroups) {
      return "当前分组已隐藏，可选择显示已隐藏分组。";
    }
    if (summary.coverage.reason === "people_analysis_disabled") {
      return "人物分组依赖人脸分析。先到任务中心启用人物分析，再把人脸分析加入运行或每日计划。";
    }
    if (dimension === "recommended") {
      return recommendation.description;
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
  // 推荐维度给的是「还缺哪个模块」的入口，缺哪些由任务记录推断。
  const recommendedAnalyzeModules = recommendation.analyzeModules;

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
              <div className="mb-6 rounded-xl border border-border bg-bg-elevated px-4 py-3">
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-meta text-fg-muted">
                  <span>
                    精选主题{" "}
                    {visibleGroups.filter((group) => !group.hidden).length} 组
                  </span>
                  <span>
                    覆盖 {summary.totalPhotos - summary.ungroupedPhotos} 张
                  </span>
                  <span>可用照片 {summary.availablePhotos}</span>
                </div>
                <p className="mt-2 text-meta text-fg-subtle">
                  推荐至少 {RECOMMENDATION_MINIMUM_PHOTOS}
                  张、至少两类线索一致，且不与所在文件夹重复。
                </p>
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
                  {dimension === "recommended"
                    ? recommendation.title
                    : "还没有可展示的分组"}
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
                ) : recommendedAnalyzeModules.length > 0 ? (
                  <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {recommendedAnalyzeModules.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => onAnalyzeDimension(type)}
                        disabled={analyzing}
                        className="btn btn-sm btn-outline"
                      >
                        {analyzing
                          ? "已加入分析队列…"
                          : `补充${requiredModuleNames[type]}分析`}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleGroups.map((group) => {
                  const evidence = smartAlbumEvidenceDimensions(group);
                  const reasons = group.recommendationReasons ?? [];
                  return (
                    <article
                      key={group.id}
                      className={`overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm ${group.hidden ? "opacity-65" : ""}`}
                    >
                      <button
                        type="button"
                        onClick={() => onOpenGroup(group.id)}
                        className="group relative block aspect-square w-full overflow-hidden bg-bg-subtle text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                        data-testid="smart-album-cover"
                        aria-label={`打开分组 ${group.name}，${group.photoCount} 张`}
                      >
                        <SmartAlbumCover
                          fileId={group.coverResourceId}
                          version={group.coverVersion}
                          displayWidth={320}
                          /* 这里的槽宽由 CSS 网格决定，量不到具体像素：
                             用视口相对宽度告诉浏览器这个槽位有多宽。 */
                          sizes="(min-width: 1280px) 18vw, (min-width: 1024px) 22vw, (min-width: 640px) 32vw, 45vw"
                        />
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
                              className="btn-text text-meta text-brand hover:underline"
                            >
                              保存
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingGroupId(null)}
                              className="btn-text text-meta text-fg-muted hover:text-fg"
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
                              {group.dimension === "recommended" &&
                                (evidence.length > 0 ? (
                                  <span className="mt-1 block">
                                    <SmartAlbumEvidence dimensions={evidence} />
                                  </span>
                                ) : (
                                  <p
                                    className="mt-1 truncate text-meta leading-4 text-fg-subtle"
                                    title={reasons.join(" · ")}
                                  >
                                    {reasons.join(" · ")}
                                  </p>
                                ))}
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
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

interface RecommendationStateInput {
  summary?: SmartAlbumSummary;
  modules: AIJobModule[];
  jobs: AIJob[];
  peopleEnabled: boolean;
}

interface RecommendationState {
  title: string;
  description: string;
  /** 还能补的分析模块：空数组表示没有可补的入口。 */
  analyzeModules: AnalysisType[];
}

/**
 * 精选推荐空态的三态判定。
 *
 * 推荐维度的 coverage 是「combined」：`analyzed` 是可读文件数、`missing`
 * 是文件不可用数、`failed` 恒为 0、`withEvidence` 是进了推荐的照片数 ——
 * 都不回答「哪个模块还没跑」。所以这里用两样相册页已经在取的东西：
 * 分析模块的安装状态，与分析任务记录。
 *
 * 任务记录只当线索用，不当证据：清过「终态记录」就看不出跑过没有，
 * 这时宁可再让人点一次补分析（增量分析很便宜），也别把「跑过了」
 * 说成「没跑过」。全库任务算覆盖所有相册，因此全库任务的失败会让
 * 每本相册都看到「分析有失败项」——这是真的，那批照片确实没分析成。
 */
function recommendationState({
  summary,
  modules,
  jobs,
  peopleEnabled,
}: RecommendationStateInput): RecommendationState {
  const needed = RECOMMENDATION_MODULES;
  const albumId = summary?.albumId;
  const uninstalled = ESSENTIAL_RECOMMENDATION_MODULES.filter((type) => {
    const module = modules.find((item) => item.type === type);
    return module ? !module.installed : false;
  });
  // 全库任务也算覆盖这本相册：每日计划跑的就是全库任务。
  const coversAlbum = (job: AIJob) => job.albumId === albumId || !job.albumId;
  const completedTypes = new Set(
    jobs
      .filter((job) => job.status === "completed" && coversAlbum(job))
      .map((job) => job.type),
  );
  // 只有「这个模块从来没成功过」才报失败：成功过之后的零星失败
  // 说明照片多半已经分析过，这时该说的是「没凑出主题」。
  const failedJobs = jobs.filter(
    (job) =>
      coversAlbum(job) &&
      ESSENTIAL_RECOMMENDATION_MODULES.includes(job.type) &&
      !completedTypes.has(job.type) &&
      (job.status === "failed" || job.failed > 0),
  );
  const pendingModules = needed.filter((type) => {
    if (type === "face" && !peopleEnabled) return false;
    const module = modules.find((item) => item.type === type);
    if (module && !module.installed) return false;
    return !completedTypes.has(type);
  });
  const essentialPending = ESSENTIAL_RECOMMENDATION_MODULES.filter(
    (type) => !completedTypes.has(type),
  );

  if (!summary) {
    return {
      title: "还没有可展示的分组",
      description: "正在读取这本相册的分析线索…",
      analyzeModules: [],
    };
  }
  if (uninstalled.length > 0) {
    return {
      title: "所需分析模块还没就绪",
      description:
        "精选推荐要同时看 EXIF 时间地点与语义向量场景这两类线索，先到任务中心的本机存储页把模型装好。",
      analyzeModules: [],
    };
  }
  if (failedJobs.length > 0) {
    return {
      title: "分析有失败项",
      description: "有照片没能分析成功，补完再来看推荐；失败的照片不参与分组。",
      analyzeModules: pendingModules,
    };
  }
  if (essentialPending.length > 0) {
    return {
      title: "还没有分析结果",
      description:
        "精选推荐要同时看 EXIF 时间地点与语义向量场景两类线索，先把分析跑起来。",
      analyzeModules: pendingModules,
    };
  }
  if (summary.totalPhotos < RECOMMENDATION_MINIMUM_PHOTOS) {
    return {
      title: "照片还不够形成推荐",
      description: `这本相册只有 ${summary.totalPhotos} 张照片，推荐至少要 ${RECOMMENDATION_MINIMUM_PHOTOS} 张。`,
      analyzeModules: pendingModules,
    };
  }
  return {
    title: "暂时没有形成主题",
    description:
      "线索已经够了，但没有满足准入规则的主题：至少两类线索一致，且与所在文件夹有区别。详细分类可以在其他页签查看。",
    analyzeModules: pendingModules,
  };
}
