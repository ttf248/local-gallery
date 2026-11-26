import type {
  AIJobEstimate,
  AIJobModule,
  AnalysisType,
} from "../../api/aiJobs";
import {
  formatCount,
  formatEstimateDuration,
  sumEstimateModes,
} from "../../utils/taskFormat";
import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import { Switch } from "../../ui/Switch";

interface Props {
  enabled: boolean;
  time: string;
  selectedModules: AnalysisType[];
  scanEnabled: boolean;
  smartAlbumsEnabled: boolean;
  peopleEnabled: boolean;
  /** 服务器设置还没到之前不允许编辑。 */
  ready: boolean;
  onEnabledChange: (value: boolean) => void;
  onTimeChange: (value: string) => void;
  onModulesChange: (value: AnalysisType[]) => void;
  onScanChange: (value: boolean) => void;
  onSmartAlbumsChange: (value: boolean) => void;
  onPeopleEnabledChange: (value: boolean) => void;
  onSave: () => void;
  saving: boolean;
  saved: boolean;
  error: boolean;
  /** 后端记录的上次计划执行日期。 */
  lastScheduledDate?: string;
  lastScheduledStatus?: "running" | "completed" | "failed" | "interrupted";
  lastScheduledStage?: string;
  lastScheduledError?: string;
  modules: AIJobModule[];
  /** 空闲时的规模与耗时核算；每日计划按增量口径看。 */
  estimate?: AIJobEstimate;
  estimateLoading: boolean;
  estimateError: boolean;
}

/**
 * 每日增量计划：一条紧凑的设置条，不做成独立表单。
 *
 * 模块选择用芯片而不是一串复选框标签 —— 复选框排成一行时每个都是同样
 * 权重的一小块，看不出哪些被选中了；芯片把选中态直接染出来。
 */
export default function DailyPlanPanel({
  enabled,
  time,
  selectedModules,
  scanEnabled,
  smartAlbumsEnabled,
  peopleEnabled,
  ready,
  onEnabledChange,
  onTimeChange,
  onModulesChange,
  onScanChange,
  onSmartAlbumsChange,
  onPeopleEnabledChange,
  onSave,
  saving,
  saved,
  error,
  lastScheduledDate,
  lastScheduledStatus,
  lastScheduledStage,
  lastScheduledError,
  modules,
  estimate,
  estimateLoading,
  estimateError,
}: Props) {
  const disabled = !ready || saving;
  const hasSelectedTask =
    scanEnabled || smartAlbumsEnabled || selectedModules.length > 0;
  const generatedDimensions = [
    ...(selectedModules.includes("metadata") ? ["时间", "地点"] : []),
    ...(selectedModules.includes("embedding") ? ["场景"] : []),
    ...(peopleEnabled && selectedModules.includes("face") ? ["人物"] : []),
  ];
  const unavailableDimensions = [
    ...(!selectedModules.includes("metadata")
      ? ["时间、地点需元数据分析"]
      : []),
    ...(!selectedModules.includes("embedding") ? ["场景需语义向量分析"] : []),
    ...(!peopleEnabled || !selectedModules.includes("face")
      ? ["人物需启用并选择人脸分析"]
      : []),
  ];

  const scheduledStatus = (() => {
    if (lastScheduledStatus === "running") {
      if (lastScheduledStage === "scan") return "正在扫描媒体库";
      if (lastScheduledStage === "analysis") return "正在运行分析模块";
      if (lastScheduledStage === "smart_albums") return "正在生成智能相册";
      return "正在执行计划";
    }
    if (lastScheduledStatus === "completed") return "已完成";
    if (lastScheduledStatus === "interrupted")
      return "上次执行中断，下次启动会续跑";
    if (lastScheduledStatus === "failed") {
      if (lastScheduledError === "scan_failed")
        return "扫描失败，后续任务未运行";
      if (lastScheduledError === "analysis_failed")
        return smartAlbumsEnabled
          ? "分析模块失败，智能相册已刷新已有结果"
          : "分析模块失败";
      if (lastScheduledError === "analysis_module_unavailable")
        return smartAlbumsEnabled
          ? "分析模块未就绪，智能相册已刷新已有结果"
          : "分析模块未就绪";
      if (lastScheduledError === "library_not_ready")
        return "图库尚未就绪，分析未运行";
      if (lastScheduledError === "smart_albums_failed")
        return "智能相册生成失败";
      return "执行失败";
    }
    return "";
  })();

  function toggleModule(type: AnalysisType) {
    const next = selectedModules.includes(type)
      ? selectedModules.filter((item) => item !== type)
      : [...selectedModules, type];
    onModulesChange(next);
  }

  return (
    <section className="tasks-section mt-4 p-[clamp(12px,2vw,22px)] border border-line rounded-tile bg-bg-elevated" aria-labelledby="daily-plan-heading">
      <div className="tasks-section__head flex flex-wrap items-start justify-between gap-y-2.5 gap-x-5">
        <div className="min-w-0">
          <h2 id="daily-plan-heading" className="tasks-section__title font-display text-body font-semibold text-fg">
            每日计划
          </h2>
          <p className="tasks-section__desc mt-[3px] text-caption leading-[1.6] text-fg-subtle max-w-[68ch]">
            {
              "到点后依次扫描媒体目录、运行所选分析模块、生成智能相册；分析与分组在本机处理。按设备本地时间运行，错过计划时间后会在下次启动时补跑一次。"
            }
          </p>
        </div>
        <label className="flex shrink-0 items-center gap-2.5 text-body text-fg">
          <Switch
            label="启用每日自动任务"
            checked={enabled}
            disabled={disabled}
            onChange={onEnabledChange}
          />
          <span>启用每日自动任务</span>
        </label>
      </div>

      <form
        className="tasks-section__body mt-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSave();
        }}
      >
        <div className="tasks-field grid grid-cols-[92px_minmax(0,1fr)] items-center [justify-items:start] gap-4 py-2.5 px-0 border-t border-t-line [@container_tasks_(max-width:560px)]:grid-cols-1 [@container_tasks_(max-width:560px)]:gap-1.5">
          <span className="tasks-field__label text-caption text-fg-muted">开始时间</span>
          <input
            type="time"
            value={time}
            disabled={disabled}
            onChange={(event) => onTimeChange(event.currentTarget.value)}
            className="field w-fit"
            aria-label="每日自动任务开始时间"
          />
        </div>

        <div className="tasks-field grid grid-cols-[92px_minmax(0,1fr)] items-center [justify-items:start] gap-4 py-2.5 px-0 border-t border-t-line [@container_tasks_(max-width:560px)]:grid-cols-1 [@container_tasks_(max-width:560px)]:gap-1.5">
          <span className="tasks-field__label text-caption text-fg-muted">扫描与分组</span>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-body text-fg">
              <input
                type="checkbox"
                checked={scanEnabled}
                disabled={disabled}
                onChange={(event) => onScanChange(event.currentTarget.checked)}
              />
              扫描所有媒体目录
            </label>
            <label className="flex items-center gap-2 text-body text-fg">
              <input
                type="checkbox"
                checked={smartAlbumsEnabled}
                disabled={disabled}
                onChange={(event) =>
                  onSmartAlbumsChange(event.currentTarget.checked)
                }
              />
              生成智能相册分组
            </label>
          </div>
        </div>

        <SettingsGroup id="plan-modules" title="运行模块">
          {modules.map((module) => (
            <SettingsRow
              key={module.type}
              label={module.name}
              description={
                !module.installed
                  ? "不可用：缺少模型或运行环境"
                  : (module.type === "face" || module.type === "portrait") && !peopleEnabled
                    ? "需先启用人物分析"
                    : undefined
              }
            >
              <Switch
                label={module.name}
                checked={selectedModules.includes(module.type)}
                disabled={
                  disabled ||
                  !module.installed ||
                  ((module.type === "face" || module.type === "portrait") && !peopleEnabled)
                }
                onChange={() => toggleModule(module.type)}
              />
            </SettingsRow>
          ))}
        </SettingsGroup>

        <div className="tasks-field grid grid-cols-[92px_minmax(0,1fr)] items-center [justify-items:start] gap-4 py-2.5 px-0 border-t border-t-line [@container_tasks_(max-width:560px)]:grid-cols-1 [@container_tasks_(max-width:560px)]:gap-1.5">
          <span className="tasks-field__label text-caption text-fg-muted">人物分析</span>
          <label className="flex items-center gap-2 text-body text-fg">
            <input
              type="checkbox"
              checked={peopleEnabled}
              disabled={disabled}
              onChange={(event) =>
                onPeopleEnabledChange(event.currentTarget.checked)
              }
            />
            启用人物分析（默认关闭）
          </label>
        </div>

        <div className="tasks-actions flex flex-wrap items-center gap-y-2 gap-x-4 py-3 px-0 border-t border-t-line">
          <button
            className="btn btn-sm btn-primary"
            type="submit"
            disabled={disabled || (enabled && !hasSelectedTask)}
          >
            {saving ? "保存中…" : "保存计划"}
          </button>
          <span className="text-caption text-fg-subtle">
            {lastScheduledDate
              ? `最近执行 ${lastScheduledDate}${scheduledStatus ? ` · ${scheduledStatus}` : ""}`
              : "尚未自动运行过"}
          </span>
          {enabled ? (
            <DailyPlanEstimate
              estimate={estimate}
              loading={estimateLoading}
              error={estimateError}
              modules={selectedModules}
            />
          ) : null}
          {saved ? (
            <span className="text-caption text-fg-muted">已保存</span>
          ) : null}
          {enabled && !hasSelectedTask ? (
            <span className="text-caption text-fg-muted">
              至少选择扫描、分析模块或智能相册中的一项。
            </span>
          ) : null}
          {error ? (
            <p role="alert" className="text-caption text-danger">
              保存失败，请检查时间后重试。
            </p>
          ) : null}
        </div>
      </form>

      {smartAlbumsEnabled ? (
        <div
          className="mt-3 text-caption leading-relaxed"
          role="status"
          aria-label="智能相册维度计划"
        >
          <p className="text-fg-muted">
            本轮具备生成线索：
            {generatedDimensions.length > 0
              ? generatedDimensions.join("、")
              : "暂无"}
            。
          </p>
          {unavailableDimensions.length > 0 && (
            <p className="mt-1 text-fg-subtle">
              其他维度仍会刷新已有结果；补齐前置分析：
              {unavailableDimensions.join("；")}。
            </p>
          )}
        </div>
      ) : null}
    </section>
  );
}

/**
 * 每日计划的预计工作量。
 *
 * 计划按增量口径逐项串行跑，所以张数与耗时都是所选模块的合计；任一模块
 * 没有历史速度，整体就估不出来。
 */
function DailyPlanEstimate({
  estimate,
  loading,
  error,
  modules,
}: {
  estimate?: AIJobEstimate;
  loading: boolean;
  error: boolean;
  modules: AnalysisType[];
}) {
  if (loading) {
    return (
      <span className="text-caption text-fg-subtle">预计下次运行：核算中…</span>
    );
  }
  if (error) {
    return (
      <span className="text-caption text-fg-subtle">预计下次运行：预估失败</span>
    );
  }
  if (!estimate) return null;
  if (!estimate.libraryReady) {
    return null;
  }
  const entries = modules.map((type) =>
    estimate.modules.find((item) => item.type === type),
  );
  const usable = entries.filter(
    (entry) => entry?.available && entry.incremental,
  );
  if (usable.length === 0) {
    return null;
  }
  const total = sumEstimateModes(
    usable.map((entry) => entry?.incremental ?? null),
  );
  return (
    <span className="text-caption text-fg-subtle">
      {`分析预计：${formatCount(total.count)} 张 · ${formatEstimateDuration(total.estimatedDurationMs)}`}
    </span>
  );
}
