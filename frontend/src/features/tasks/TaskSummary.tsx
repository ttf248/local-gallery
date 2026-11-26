import { Button } from "../../ui/Button";
import type {
  AIJob,
  AIJobEstimate,
  AIJobModule,
  AIWorkerStatus,
  AnalysisMode,
  AnalysisType,
  FaceModel,
} from "../../api/aiJobs";
import type { JobAction } from "../../hooks/useTaskCenter";
import { formatDateTime } from "../../utils/date";
import {
  estimateForModule,
  formatCount,
  formatEstimateDuration,
  formatTaskDuration,
  taskModeLabel,
  taskStageLabel,
  taskStatusLabel,
} from "../../utils/taskFormat";
import TaskStatusHero from "./TaskStatusHero";

interface Props {
  /** 当前活动任务；没有时是空闲态。 */
  active?: AIJob;
  /** 最近一次已结束的任务，用来给空闲态一点上下文。 */
  lastJob?: AIJob;
  loading: boolean;
  /** 启动或任务操作正在提交。 */
  busy: boolean;
  cancelling?: boolean;
  modules: AIJobModule[];
  /** 队列里等待的任务数；为空时是真正的空闲。 */
  queuedCount: number;
  /** 当前选中的模块与处理方式。 */
  selection: { module: AnalysisType; mode: AnalysisMode };
  /** 空闲时的规模核算：启动按钮要写清这次要处理多少张。 */
  estimate?: AIJobEstimate;
  onStart: () => void;
  onAction: (id: string, action: JobAction) => void;
  /** 本机 AI 环境：判断选中的模块能不能启动。 */
  embeddingStatus?: AIWorkerStatus;
  /** 人物分析是否启用（人脸模块要它才允许启动）。 */
  peopleEnabled: boolean;
  /** 当前使用的人脸模型。 */
  faceModel: FaceModel;
}

/**
 * 任务中心的状态摘要。
 *
 * 打开任务中心先要看到的是「现在在干什么、还剩多少、能做什么」，不是
 * 一堆模块芯片和一张核算表。所以这一块只放状态、数字与主要动作：
 * 运行时给进度与控制，空闲时给队列情况与启动入口。
 *
 * 配置（选哪个模块、增量还是全量）在它下面的运行表单里；这里只重复
 * 启动按钮需要的那几个数，不重复整套表单。
 */
export default function TaskSummary({
  active,
  lastJob,
  loading,
  busy,
  cancelling,
  modules,
  queuedCount,
  selection,
  estimate,
  onStart,
  onAction,
  embeddingStatus,
  peopleEnabled,
  faceModel,
}: Props) {
  if (loading) {
    return (
      <div className="tasks-summary ui-surface" aria-busy="true">
        <div className="min-w-0 flex-1">
          <div className="h-4 w-40 ui-skeleton animate-pulse" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-bg-subtle" />
        </div>
      </div>
    );
  }

  const stateText = active
    ? `${taskStatusLabel(active.status)} · ${jobModuleName(active.type, modules)}`
    : queuedCount > 0
      ? `队列等待中 · ${queuedCount} 项`
      : lastJob?.status === "failed"
        ? "上次运行失败"
        : "队列空闲";

  const currentEstimate = estimateForModule(
    estimate,
    selection.module,
    selection.mode,
  );

  /* 能不能启动：模块没装好、模型没就绪、人物分析没开 —— 这几种情况
     都给一句人话，禁用按钮不该只有一个灰掉的按钮。 */
  const embeddingReady = Boolean(
    embeddingStatus?.runtimeReady && embeddingStatus.modelValid,
  );
  const faceModelReady = Boolean(
    faceModel === "buffalo_m"
      ? embeddingStatus?.faceModels?.buffalo_m?.ready
      : (embeddingStatus?.faceModels?.["quality-v2"]?.ready ??
          embeddingStatus?.modules?.face?.ready),
  );
  const blockedReason = startBlockedReason({
    module: selection.module,
    embeddingReady,
    faceModelReady,
    peopleEnabled,
  });

  return (
    <TaskStatusHero
      title={stateText}
      active={active}
      status={
        active?.status ??
        (queuedCount > 0
          ? "pending"
          : lastJob?.status === "failed"
            ? "failed"
            : "idle")
      }
      actions={
        <>
          {!active && lastJob?.status === "failed" && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => onAction(lastJob.id, "retry")}
            >
              重试失败项
            </Button>
          )}
          {active ? (
            <>
              {active.status === "running" ? (
                <button
                  type="button"
                  className="btn btn-sm btn-outline"
                  disabled={busy}
                  onClick={() => onAction(active.id, "pause")}
                >
                  暂停
                </button>
              ) : null}
              {active.status === "paused" || active.status === "pending" ? (
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={busy}
                  onClick={() => onAction(active.id, "resume")}
                >
                  继续
                </button>
              ) : null}
              <Button
                variant="secondary"
                size="sm"
                loading={cancelling}
                disabled={busy}
                onClick={() => onAction(active.id, "cancel")}
              >
                取消任务
              </Button>
            </>
          ) : (
            <>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={busy || Boolean(blockedReason)}
                onClick={onStart}
                title={blockedReason}
              >
                开始分析
                {currentEstimate
                  ? ` · ${formatCount(currentEstimate.count)} 张`
                  : ""}
              </button>
              {currentEstimate ? (
                /* 估不出来就明说估不出来：按钮上只有张数，没有时间，
                 用户会以为点下去马上就完。 */
                <span className="tasks-summary__hint">
                  {formatEstimateDuration(currentEstimate.estimatedDurationMs)}
                </span>
              ) : null}
              {blockedReason ? (
                <span className="tasks-summary__hint">{blockedReason}</span>
              ) : null}
            </>
          )}
        </>
      }
    >
      {active ? (
        <>
          <p className="tasks-summary__facts">
            <span>{taskStageLabel(active.stage)}</span>
            <span>
              设备：{active.computeDevice === "gpu" ? "NVIDIA GPU" : "CPU"}
            </span>
            {active.type === "face" && active.faceModel ? (
              <span>
                模型：
                {active.faceModel === "buffalo_m" ? "Buffalo_m" : "quality-v2"}
              </span>
            ) : null}
            <span>
              {taskModeLabel(active.mode)} · 开始{" "}
              {formatDateTime(active.startedAt ?? active.createdAt)} · 已运行{" "}
              {formatTaskDuration(active.elapsedMs)}
            </span>
          </p>
        </>
      ) : (
        <p className="tasks-summary__facts">
          {lastJob ? (
            lastJob.status === "failed" ? (
              /* 上一次跑砸了是最该先看见的事：写在状态这一行，
                   不用翻到任务记录里去找原因。 */
              <span className="text-danger">
                {jobModuleName(lastJob.type, modules)} ·{" "}
                {lastJob.error ?? "原因见任务记录"}
              </span>
            ) : (
              <span>
                上次运行 {formatDateTime(lastJob.createdAt)} ·{" "}
                {taskModeLabel(lastJob.mode)} · 完成{" "}
                {formatCount(lastJob.completed ?? lastJob.processed)} 张
              </span>
            )
          ) : (
            <span>还没有在本机运行过分析。</span>
          )}
        </p>
      )}
    </TaskStatusHero>
  );
}

function jobModuleName(type: AnalysisType, modules: AIJobModule[]): string {
  return modules.find((module) => module.type === type)?.name ?? type;
}

/**
 * 选中的模块现在能不能启动；不能时给一句原因。
 *
 * 没有原因就返回空串：启动按钮不该无缘无故地灰着。
 */
function startBlockedReason({
  module,
  embeddingReady,
  faceModelReady,
  peopleEnabled,
}: {
  module: AnalysisType;
  embeddingReady: boolean;
  faceModelReady: boolean;
  peopleEnabled: boolean;
}): string {
  if (module === "embedding" && !embeddingReady) {
    return "本机语义模型未就绪，先在「本机存储」页签装好模型。";
  }
  if (module === "face") {
    if (!peopleEnabled) {
      return "人物分析未启用，先在「每日计划」页签打开。";
    }
    if (!faceModelReady) {
      return "所选人脸模型未就绪，先在「本机存储」页签装好模型。";
    }
  }
  return "";
}
