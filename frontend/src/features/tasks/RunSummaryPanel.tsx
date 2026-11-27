import { Menu } from "../../ui/Menu";
import { buttonStyles } from "../../ui/buttonStyles";
import Segmented from "../../ui/Segmented";
import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import type { TaskCenterSelection } from "../../hooks/useTaskCenter";
import { Button } from "../../ui/Button";
import type {
  AIJobEstimate,
  AnalysisMode,
  FaceModel,
  AnalysisType,
} from "../../api/aiJobs";
import {
  formatCount,
  formatEstimateDuration,
  moduleReasonLabel,
  taskModeLabel,
} from "../../utils/taskFormat";
import { RefreshIcon } from "../../ui/icons";

export interface RunSummaryPanelProps {
  active: boolean;
  moduleName: string;
  selection: TaskCenterSelection;
  estimate: AIJobEstimate | null;
  estimating: boolean;
  running: boolean;
  onModeChange: (mode: AnalysisMode) => void;
  onFaceModelChange: (model: FaceModel) => void;
  onStart: () => void;
  startDisabled?: boolean;
  faceModel?: FaceModel;
  faceModelSaving?: boolean;
  faceModelSaveError?: boolean;
  qualityReady?: boolean;
  buffaloReady?: boolean;
  embeddingStatusLoading?: boolean;
  error?: boolean;
  onRefresh?: () => void;
}
/**
 * 本次规模：启动之前先把「要处理多少张」和「大概要多久」摆出来。
 *
 * 增量与全量并排成两行而不是只给当前模式 —— 用户在两种口径之间做取舍时，
 * 需要同时看到代价。切模式不重新请求：一次核算把四个模块的两种口径都
 * 带来了。
 */
export default function RunSummaryPanel(props: RunSummaryPanelProps) {
  const {
    selection,
    estimate,
    running: busy,
    onModeChange,
    onFaceModelChange,
    faceModel = "quality-v2",
    faceModelSaving,
    faceModelSaveError,
    qualityReady = true,
    buffaloReady = true,
    embeddingStatusLoading,
  } = props;
  const { module: selectedModule, mode } = selection;
  const selectedFaceModelReady =
    faceModel === "buffalo_m" ? buffaloReady : qualityReady;
  const moduleEstimate = estimate?.modules.find(
    (item) => item.type === selectedModule,
  );
  const count = moduleEstimate?.[mode]?.count;
  return (
    <>
      {" "}
      {(selectedModule === "face" || selectedModule === "portrait") && (
        <SettingsGroup title="人物分析">
          <SettingsRow label="人脸模型">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <Menu
                label="人脸分析模型"
                trigger={
                  <Button
                    variant="secondary"
                    aria-label={`人脸分析模型 · ${faceModel === "buffalo_m" ? "标准" : "轻量"}`}
                    disabled={busy || faceModelSaving || embeddingStatusLoading}
                  >
                    {faceModel === "buffalo_m" ? "标准（Buffalo_m）" : "轻量"}
                  </Button>
                }
                items={[
                  {
                    id: "quality-v2",
                    label: "轻量",
                    checked: faceModel === "quality-v2",
                    disabled: !qualityReady,
                    onSelect: () => onFaceModelChange("quality-v2"),
                  },
                  {
                    id: "buffalo_m",
                    label: "标准（Buffalo_m）",
                    checked: faceModel === "buffalo_m",
                    disabled: !buffaloReady,
                    onSelect: () => onFaceModelChange("buffalo_m"),
                  },
                ]}
              />
              <span className="text-caption text-ink-3">
                {selectedFaceModelReady
                  ? faceModel === "buffalo_m"
                    ? "标准模型已就绪"
                    : "轻量模型已就绪"
                  : "所选模型未就绪，请在本机存储页签安装模型"}
              </span>
              {faceModelSaving ? (
                <span className="text-caption text-ink-3">
                  正在切换并重建人物索引…
                </span>
              ) : null}
              {faceModelSaveError ? (
                <span role="alert" className="text-caption text-danger">
                  模型切换失败，检查是否有正在运行的人脸任务后重试。
                </span>
              ) : null}
            </div>
          </SettingsRow>
        </SettingsGroup>
      )}
      <SettingsGroup title="本次规模">
        <div className="p-3 pl-0">
          {(!estimate?.libraryReady ||
            !estimate.modules.find((item) => item.type === selectedModule)
              ?.available ||
            props.error ||
            props.estimating) && (
            <Segmented
              label="处理方式"
              value={mode}
              disabled={busy}
              onChange={onModeChange}
              options={[
                { value: "incremental", label: "增量" },
                { value: "full", label: "全量" },
              ]}
            />
          )}
          <EstimateDetails {...props} />
          <p className="mt-2 text-caption text-ink-2">
            {moduleEstimate?.knownFileFailures
              ? `本次跳过 ${formatCount(moduleEstimate.knownFileFailures)} 张已有解析失败记录的图片。文件或分析器更新后会重新处理，也可在任务记录中重试失败项。`
              : modeHint(selectedModule, mode, props.moduleName)}
          </p>
        </div>
      </SettingsGroup>
      {!props.active && (
        <Button
          size="lg"
          className="mt-3 w-full"
          disabled={busy || props.startDisabled || count === 0}
          onClick={props.onStart}
        >
          开始分析 · {props.moduleName}
          {count === undefined ? "" : " · " + formatCount(count) + " 张"}
        </Button>
      )}
    </>
  );
}
function EstimateDetails({
  estimate,
  estimating: loading,
  error,
  selection,
  onRefresh,
  onModeChange,
  running: disabled,
}: RunSummaryPanelProps) {
  const { module, mode } = selection;
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
          本次规模核算失败，无法估算耗时，仍可直接开始分析。
        </p>
        <button
          type="button"
          className={buttonStyles({ variant: "secondary", size: "sm" })}
          onClick={onRefresh}
        >
          <RefreshIcon size={14} />
          重新核算
        </button>
      </div>
    );
  }

  if (!estimate) return <p className="text-caption text-ink-3">无法估算耗时</p>;

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
        {entry.name}· 整库 {formatCount(estimate.totalImages)} 张
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
                  className="!size-4 accent-accent"
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

function modeHint(
  type: AnalysisType,
  mode: AnalysisMode,
  moduleName: string,
): string {
  if (mode === "full") {
    return type === "metadata"
      ? "重新解析当前媒体库的全部图片"
      : `重新运行${moduleName}分析`;
  }
  return type === "metadata"
    ? "只处理新增、修改或解析器更新的图片"
    : "只处理新增或变更的图片";
}
