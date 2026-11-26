import type {
  AIJobEstimate,
  AnalysisMode,
  AnalysisType,
} from "../../api/aiJobs";
import {
  formatCount,
  formatEstimateDuration,
  moduleReasonLabel,
  taskModeLabel,
} from "../../utils/taskFormat";
import { RefreshIcon } from "../../ui/icons";

interface Props {
  estimate?: AIJobEstimate;
  loading: boolean;
  error: boolean;
  /** 当前选中的模块。 */
  module: AnalysisType;
  /** 当前选中的处理方式；表格里对应的那一行高亮。 */
  mode: AnalysisMode;
  onRefresh: () => void;
  onModeChange: (mode: AnalysisMode) => void;
  disabled?: boolean;
}

/**
 * 本次规模：启动之前先把「要处理多少张」和「大概要多久」摆出来。
 *
 * 增量与全量并排成两行而不是只给当前模式 —— 用户在两种口径之间做取舍时，
 * 需要同时看到代价。切模式不重新请求：一次核算把四个模块的两种口径都
 * 带来了。
 */
export default function TaskEstimatePanel({
  estimate,
  loading,
  error,
  module,
  mode,
  onRefresh,
  onModeChange,
  disabled,
}: Props) {
  if (loading) {
    return (
      <div>
        <p className="text-caption text-ink-3">正在核算本次规模…</p>
        <div className="mt-2 h-8 w-full animate-pulse rounded-lg bg-sunken" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <p role="status" className="text-caption text-warning">
          本次规模核算失败，仍可直接开始分析。
        </p>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={onRefresh}
        >
          <RefreshIcon size={14} />
          重新核算
        </button>
      </div>
    );
  }

  if (!estimate) return null;

  if (!estimate.libraryReady) {
    return (
      <p className="text-caption text-ink-3">
        媒体库尚未就绪，完成扫描后再看本次规模。
      </p>
    );
  }

  const entry = estimate.modules.find((item) => item.type === module);
  if (!entry) return null;

  if (!entry.available) {
    return (
      <p className="text-caption text-ink-3">
        {entry.name}当前不可用：
        {moduleReasonLabel(entry.reason ?? "")}，无法核算本次规模。
      </p>
    );
  }

  const modes = ["incremental", "full"] as const;
  const active = entry[mode];
  return (
    <div>
      {/* 核算口径写在表格上方：这次要处理多少、凭什么估的。
          「本次规模」这个标题由外层的字段标签给出，这里不再重复一遍。 */}
      <p className="text-caption text-ink-2">
        {entry.name}
        {entry.version ? ` · ${entry.version}` : ""} · 整库{" "}
        {formatCount(estimate.totalImages)} 张
      </p>

      <div className="mt-3">
        <fieldset
          disabled={disabled}
          aria-label="本次规模"
          className="divide-y divide-line"
        >
          {modes.map((item) => {
            const value = entry[item];
            return (
              <label
                key={item}
                className="flex min-h-12 cursor-pointer flex-wrap items-center gap-3"
              >
                <input
                  type="radio"
                  name="analysis-scale"
                  value={item}
                  checked={mode === item}
                  onChange={() => onModeChange(item)}
                />
                <span>{taskModeLabel(item)}</span>
                <span className="tabular-nums">
                  {value ? formatCount(value.count) + " 张" : "张数未知"}
                </span>
                <span className="text-caption text-ink-2">
                  {value?.estimatedDurationMs == null
                    ? "无法估算（历史样本不足）"
                    : formatEstimateDuration(value.estimatedDurationMs)}
                </span>
              </label>
            );
          })}
        </fieldset>
        <p className="min-w-[15rem] flex-1 text-caption text-ink-3">
          {active && active.sampleCount > 0
            ? `按最近 ${active.sampleCount} 次${entry.name}历史任务的速度估算，共 ${formatCount(active.sampleImages)} 张`
            : "这个模块还没有跑过，耗时算不出来"}
          {"；以启动时的实际清单为准。"}
        </p>
      </div>
    </div>
  );
}
