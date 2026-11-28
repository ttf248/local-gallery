import { settingsRoute } from "../../utils/path";
import { Link } from "react-router-dom";
import { buttonStyles } from "../../ui/buttonStyles";
import { Button } from "../../ui/Button";
import type { AIJob, AIJobModule, AnalysisType } from "../../api/aiJobs";
import type { JobAction } from "../../hooks/useTaskCenter";
import { formatDateTime } from "../../utils/date";
import {
  formatCount,
  taskUnit,
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
  onAction: (id: string, action: JobAction) => void;
}

export default function TaskSummary({
  active,
  lastJob,
  loading,
  busy,
  cancelling,
  modules,
  queuedCount,
  onAction,
}: Props) {
  if (loading) {
    return (
      <div
        className="tasks-summary flex flex-wrap items-start justify-between gap-y-3.5 gap-x-6 p-[clamp(13px,2.2vw,23px)] border border-line rounded-xl bg-sunken [&[data-status=failed]]:[border-color:color-mix(in_srgb,var(--danger)_32%,var(--line))] ui-surface border border-line rounded-xl bg-sunken touch:[&_button]:min-h-11 touch:[&_button]:min-w-11"
        aria-busy="true"
      >
        <div className="min-w-0 flex-1">
          <div className="h-4 w-40 ui-skeleton rounded-tile bg-sunken-strong animate-pulse" />
          <div className="mt-2 h-3 w-2/3 animate-pulse rounded-full bg-sunken" />
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
            <>
              <Link
                className={buttonStyles({ variant: "secondary", size: "sm" })}
                to={settingsRoute("tasks", {
                  query: { job: lastJob.id },
                  hash: "task-history",
                })}
              >
                查看原因
              </Link>
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                onClick={() => onAction(lastJob.id, "retry")}
              >
                重试{jobModuleName(lastJob.type, modules)}失败项
              </Button>
            </>
          )}
          {active ? (
            <>
              {active.status === "running" ? (
                <button
                  type="button"
                  className={buttonStyles({ variant: "secondary", size: "sm" })}
                  disabled={busy}
                  onClick={() => onAction(active.id, "pause")}
                >
                  暂停
                </button>
              ) : null}
              {active.status === "paused" || active.status === "pending" ? (
                <button
                  type="button"
                  className={buttonStyles({ variant: "primary", size: "sm" })}
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
          ) : null}
        </>
      }
    >
      {active ? (
        <>
          <p className="tasks-summary__facts flex flex-wrap gap-y-0.5 gap-x-4 mt-[7px] text-caption text-ink-2">
            <span>{taskStageLabel(active.stage)}</span>
            <span>等待 {queuedCount} 项</span>
            <span>
              设备：{active.computeDevice === "gpu" ? "GPU" : "CPU"}
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
        <p className="tasks-summary__facts flex flex-wrap gap-y-0.5 gap-x-4 mt-[7px] text-caption text-ink-2">
          {lastJob ? (
            lastJob.status === "failed" ? (
              /* 上一次跑砸了是最该先看见的事：写在状态这一行，
                   不用翻到任务记录里去找原因。 */
              <span className="text-danger">
                {jobModuleName(lastJob.type, modules)} · 失败{" "}
                {formatCount(lastJob.failed)} {taskUnit(lastJob.type)} ·{" "}
                {lastJob.error ?? "原因见任务记录"}
              </span>
            ) : (
              <span>
                上次运行 {formatDateTime(lastJob.createdAt)} ·{" "}
                {taskModeLabel(lastJob.mode)} · 完成{" "}
                {formatCount(lastJob.completed ?? lastJob.processed)}{" "}
                {taskUnit(lastJob.type)}
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
