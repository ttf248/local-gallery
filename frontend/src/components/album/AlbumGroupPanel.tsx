import { useState } from "react";
import { Link } from "react-router-dom";
import type {
  SmartAlbumDimension,
  SmartAlbumSummary,
} from "../../api/albums";
import type { AIJob, AIJobModule, AnalysisType } from "../../api/aiJobs";
import { smartAlbumEvidenceDimensions } from "../../utils/smartAlbum";
import ErrorBanner from "../common/ErrorBanner";
import Popover, { PopoverItem, PopoverLabel } from "../../ui/Popover";
import {
  ChevronRightIcon,
  CloseIcon,
  MoreHorizontalIcon,
} from "../../ui/icons";
import SmartAlbumCover from "./SmartAlbumCover";
import SmartAlbumEvidence from "./SmartAlbumEvidence";

interface Props {
  /** 这一维度的分组摘要。 */
  summary?: SmartAlbumSummary;
  loading: boolean;
  error: boolean;
  /** 当前分组维度。 */
  dimension: SmartAlbumDimension;
  /** 选中的分组 id。 */
  groupId: string | null;
  /** 这一本相册里的照片总数：分组之外的「全部照片」那一条用它。 */
  totalPhotos: number;
  /** 换分组维度。 */
  onDimensionChange: (dimension: SmartAlbumDimension) => void;
  /** 选中分组，或回到全部照片。 */
  onOpenGroup: (groupId: string | null) => void;
  /** 关掉分组面板：回到全部照片。 */
  onClose: () => void;
  analyzing: boolean;
  rebuilding: boolean;
  peopleEnabled: boolean;
  onAnalyze: () => void;
  onAnalyzeDimension: (type: AnalysisType) => void;
  onRebuild: () => void;
  onSaveOverride: (
    groupId: string,
    override: { name?: string; hidden?: boolean },
  ) => Promise<boolean>;
  /** 分析模块的安装状态。 */
  modules: AIJobModule[];
  /** 分析任务记录。 */
  jobs: AIJob[];
}

const DIMENSIONS: readonly [SmartAlbumDimension, string][] = [
  ["recommended", "精选推荐"],
  ["time", "按时间"],
  ["place", "按地点"],
  ["people", "按人物"],
  ["scene", "按场景"],
];

/**
 * 空态给出的那个操作。
 *
 * 空态说什么，底下就得给得出对得上的那一个：缺分析给补分析，分析失败
 * 给重新分析，分析做完了却没凑出分组给重建。一个状态配一个动作，
 * 不给对不上的按钮。
 */
type EmptyAction =
  | null
  | "enable-people"
  | "analyze-module"
  | "retry-module"
  | "rebuild"
  | "recommended-modules";

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

/**
 * 分组面板：相册里照片的一种看法。
 *
 * 它不是第二本相册 —— 墙上始终是这本相册里的照片，面板只决定「先看
 * 哪一组」。因此面板里没有封面墙，只有分组名与张数：点一个分组，墙
 * 上换成那一组的照片；点「全部照片」，墙上换回来。
 *
 * 分析覆盖率、重建与算法说明都收在次级位置：面板底部的「分析说明」
 * 默认收起，分析与重建在面板右上角的更多菜单里。页面主视觉上是照片，
 * 不是分析进度。
 */
export default function AlbumGroupPanel({
  summary,
  loading,
  error,
  dimension,
  groupId,
  totalPhotos,
  onDimensionChange,
  onOpenGroup,
  onClose,
  analyzing,
  rebuilding,
  peopleEnabled,
  onAnalyze,
  onAnalyzeDimension,
  onRebuild,
  onSaveOverride,
  modules,
  jobs,
}: Props) {
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);

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

  const recommendation = recommendationState({
    summary,
    modules,
    jobs,
    peopleEnabled,
  });

  /* 分组面板的空态有三种，说法与操作各自对上：
     - 还没分析：缺的是分析，入口是补分析。
     - 分析失败：缺的是重跑，入口是重新分析（补分析不会碰失败的那些）。
     - 分析过了但没凑出分组：没有可补的东西，只把原因说清楚。 */
  const emptyState = (() => {
    if (!summary) {
      return {
        title: "还没有可展示的分组",
        description: "正在读取这本相册的分析线索…",
        action: null as EmptyAction,
      };
    }
    if (summary.hiddenGroupCount > 0 && !showHiddenGroups) {
      return {
        title: "还没有可展示的分组",
        description: "当前分组已隐藏，可选择显示已隐藏分组。",
        action: null as EmptyAction,
      };
    }
    if (summary.coverage.reason === "people_analysis_disabled") {
      return {
        title: "人物分组还不能用",
        description:
          "人物分组依赖人脸分析。先到任务中心启用人物分析，再把人脸分析加入运行或每日计划。",
        action: "enable-people" as EmptyAction,
      };
    }
    if (dimension === "recommended") {
      return {
        title: recommendation.title,
        description: recommendation.description,
        action: "recommended-modules" as EmptyAction,
      };
    }
    if (!summary.coverage.available) {
      return {
        title: "所需分析模块不可用",
        description:
          "所需分析模块当前不可用；可在任务中心的本机存储页查看模型状态。",
        action: null as EmptyAction,
      };
    }
    if (summary.coverage.failed > 0) {
      return {
        title: "分析有失败项",
        description: `有 ${summary.coverage.failed} 张照片分析失败，失败的这些不参与分组。`,
        action: "retry-module" as EmptyAction,
      };
    }
    if (analyzableMissing > 0) {
      return {
        title: "还没有完成分析",
        description: `还有 ${analyzableMissing} 张照片没有完成${requiredModuleNames[requiredModule[dimension]]}分析。`,
        action: "analyze-module" as EmptyAction,
      };
    }
    if (summary.unavailablePhotos > 0) {
      return {
        title: "还没有可展示的分组",
        description:
          "尚未分析的照片当前不可读取；请先检查本地文件并重新扫描媒体库。",
        action: null as EmptyAction,
      };
    }
    if (summary.coverage.withEvidence < 3) {
      return {
        title: "还没有可展示的分组",
        description: `分析已完成，但只有 ${summary.coverage.withEvidence} 张照片含有可用线索；每组至少需要 3 张。`,
        action: "rebuild" as EmptyAction,
      };
    }
    return {
      title: "还没有可展示的分组",
      description: "分析已完成，但当前线索没有形成达到最低数量的分组。",
      action: "rebuild" as EmptyAction,
    };
  })();
  const canAnalyzeDimension = Boolean(
    summary &&
      dimension !== "recommended" &&
      summary.coverage.available &&
      analyzableMissing > 0 &&
      !(dimension === "people" && !peopleEnabled),
  );
  const recommendedAnalyzeModules = recommendation.analyzeModules;

  return (
    <section
      aria-label="分组浏览"
      className="shrink-0 border-b border-border-faint bg-bg"
    >
      <div className="page-shell py-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-body font-medium text-fg">分组浏览</span>
          <span className="text-meta text-fg-subtle">
            只在本相册内分组，原始照片与文件保持不变
          </span>
          <div className="ml-auto flex items-center gap-2">
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
            <Popover
              align="end"
              aria-label="分组相关操作"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
                  title="分析与重建"
                  aria-label="分析与重建"
                >
                  <MoreHorizontalIcon size={14} />
                </button>
              }
            >
              <PopoverLabel>分析</PopoverLabel>
              <PopoverItem onClick={onAnalyze} disabled={analyzing}>
                <span>
                  {analyzing ? "正在分析…" : "分析当前相册"}
                </span>
              </PopoverItem>
              <PopoverItem onClick={onRebuild} disabled={rebuilding || loading}>
                <span>{rebuilding ? "正在重建…" : "重建分组"}</span>
              </PopoverItem>
            </Popover>
            <button
              type="button"
              onClick={onClose}
              className="btn btn-sm btn-ghost"
              aria-label="收起分组浏览"
            >
              <CloseIcon size={13} />
              收起
            </button>
          </div>
        </div>

        <div
          className="mt-3 flex flex-wrap gap-2"
          role="tablist"
          aria-label="分组维度"
        >
          {DIMENSIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={dimension === key}
              onClick={() => onDimensionChange(key)}
              className={`rounded-full border px-3 py-1 text-meta transition-colors ${
                dimension === key
                  ? "border-accent/40 bg-accent/10 text-accent-ink"
                  : "border-border bg-bg-elevated text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <ErrorBanner className="mt-3 rounded-xl p-4">
            智能分组读取失败，请重试。
          </ErrorBanner>
        ) : loading || !summary ? (
          <div className="mt-3 rounded-xl border border-border bg-bg-elevated p-4 text-body text-fg-muted">
            正在读取这本相册的分析线索…
          </div>
        ) : visibleGroups.length === 0 ? (
          <div className="mt-3 rounded-xl border border-dashed border-border bg-bg-elevated/60 px-6 py-10 text-center">
            <h3 className="text-body font-medium text-fg">{emptyState.title}</h3>
            <p className="mt-2 text-meta text-fg-muted">
              {emptyState.description}
            </p>
            {emptyState.action === "enable-people" ? (
              <Link to="/tasks/plan" className="btn btn-sm btn-outline mt-4">
                去任务中心启用
              </Link>
            ) : emptyState.action === "retry-module" ? (
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
                  : `重新分析${requiredModuleNames[requiredModule[dimension]]}`}
              </button>
            ) : emptyState.action === "analyze-module" && canAnalyzeDimension ? (
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
            ) : emptyState.action === "recommended-modules" &&
              recommendedAnalyzeModules.length > 0 ? (
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
            ) : emptyState.action === "rebuild" ? (
              /* 分析做完了却没凑出分组：能做的不是再分析一次，
                 而是按现有结果重建一遍分组。 */
              <button
                type="button"
                onClick={onRebuild}
                disabled={rebuilding}
                className="btn btn-sm btn-outline mt-4"
              >
                {rebuilding ? "正在重建…" : "重建分组"}
              </button>
            ) : null}
          </div>
        ) : (
          <ul
            className="mt-3 max-h-[38vh] space-y-1 overflow-y-auto pr-1"
            data-testid="album-group-list"
          >
            <li>
              <button
                type="button"
                onClick={() => onOpenGroup(null)}
                aria-pressed={groupId === null}
                className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                  groupId === null
                    ? "border-accent/40 bg-accent/10"
                    : "border-border bg-bg-elevated hover:border-border-strong"
                }`}
              >
                <span className="min-w-0 flex-1 truncate text-body text-fg">
                  全部照片
                </span>
                <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                  {totalPhotos} 张
                </span>
              </button>
            </li>
            {visibleGroups.map((group) => {
              const evidence = smartAlbumEvidenceDimensions(group);
              const reasons = group.recommendationReasons ?? [];
              const active = group.id === groupId;
              return (
                <li key={group.id}>
                  <div
                    className={`flex items-center gap-3 rounded-lg border px-3 py-2 ${
                      active
                        ? "border-accent/40 bg-accent/10"
                        : "border-border bg-bg-elevated"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenGroup(group.id)}
                      aria-pressed={active}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      {/* 封面组件内部是绝对定位的：外层必须是定位容器，
                          否则那张图会飘到面板外面挡住别的控件。 */}
                      <span
                        className="relative h-10 w-10 shrink-0 overflow-hidden rounded-md bg-bg-subtle"
                        data-testid="smart-album-cover"
                      >
                        <SmartAlbumCover
                          fileId={group.coverResourceId}
                          version={group.coverVersion}
                          displayWidth={80}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        {editingGroupId === group.id ? null : (
                          <span className="block truncate text-body text-fg">
                            {group.name}
                          </span>
                        )}
                        <span className="mt-0.5 flex flex-wrap items-center gap-2 text-meta text-fg-muted">
                          <span className="tabular-nums">
                            {group.photoCount} 张
                          </span>
                          {group.dimension === "recommended" &&
                            (evidence.length > 0 ? (
                              <SmartAlbumEvidence dimensions={evidence} />
                            ) : (
                              <span
                                className="truncate"
                                title={reasons.join(" · ")}
                              >
                                {reasons.join(" · ")}
                              </span>
                            ))}
                          {group.hidden ? (
                            <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-meta text-fg-subtle">
                              已隐藏
                            </span>
                          ) : null}
                          {group.overrideConflict ? (
                            <span className="rounded-full bg-bg-subtle px-1.5 py-0.5 text-meta text-warning">
                              修改待确认
                            </span>
                          ) : null}
                        </span>
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
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
                          className="flex items-center gap-1"
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(event) =>
                              setNameDraft(event.target.value)
                            }
                            maxLength={60}
                            aria-label="分组名称"
                            className="min-w-0 w-32 rounded-md border border-border bg-bg px-2 py-1 text-meta text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          />
                          <button
                            type="submit"
                            className="btn-text text-meta text-accent hover:underline"
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
                        <>
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
                            className="rounded px-1.5 py-1 text-meta text-fg-muted hover:bg-bg-subtle hover:text-fg"
                            aria-label={`重命名 ${group.name}`}
                          >
                            重命名
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              void onSaveOverride(group.id, {
                                hidden: !group.hidden,
                              })
                            }
                            className="rounded px-1.5 py-1 text-meta text-fg-muted hover:bg-bg-subtle hover:text-fg"
                          >
                            {group.hidden ? "取消隐藏" : "隐藏"}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* 分析说明：覆盖率、重建与算法口径都收在这里，默认收起。
            用户要问「为什么这组这么少」时再展开。 */}
        {summary ? (
          <div className="mt-3">
            <button
              type="button"
              onClick={() => setDetailsOpen((value) => !value)}
              aria-expanded={detailsOpen}
              className="inline-flex items-center gap-1.5 text-meta text-fg-muted hover:text-fg"
            >
              <ChevronRightIcon
                size={12}
                className={`transition-transform ${detailsOpen ? "rotate-90" : ""}`}
              />
              分析说明
            </button>
            {detailsOpen ? (
              <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-elevated px-4 py-3 text-meta text-fg-muted">
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
                {dimension === "recommended" ? (
                  <>
                    <span>
                      精选主题{" "}
                      {visibleGroups.filter((group) => !group.hidden).length} 组
                    </span>
                    <span>
                      覆盖 {summary.totalPhotos - summary.ungroupedPhotos} 张
                    </span>
                    <span>可用照片 {summary.availablePhotos}</span>
                    <span className="text-fg-subtle">
                      推荐至少 {RECOMMENDATION_MINIMUM_PHOTOS} 张照片、至少两类
                      线索一致，且不与所在文件夹重复。
                    </span>
                  </>
                ) : null}
                <span className="text-fg-subtle">
                  分组由本机分析算出，重建只改分组，不动任何原始文件。
                </span>
              </div>
            ) : null}
          </div>
        ) : null}
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
