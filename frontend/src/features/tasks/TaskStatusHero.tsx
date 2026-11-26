import type { ReactNode } from "react";
import type { AIJob, AnalysisStatus } from "../../api/aiJobs";
import {
  formatCount,
  formatTaskDuration,
  formatTaskSpeed,
  jobProgressPercent,
} from "../../utils/taskFormat";
import { Badge } from "../../ui/Badge";
import { taskStatusTone } from "../../utils/taskFormat";

interface Props {
  title: string;
  status: AnalysisStatus | "idle";
  active?: AIJob;
  children: ReactNode;
  actions: ReactNode;
}

export default function TaskStatusHero({
  title,
  status,
  active,
  children,
  actions,
}: Props) {
  return (
    <section
      className="relative grid gap-4 rounded-[20px] bg-bg-elevated p-7 shadow-1 sm:grid-cols-[1fr_auto]"
      aria-label="状态摘要"
      data-status={status}
    >
      <div className="tasks-summary__description">
        <h2 className="flex items-center gap-2 text-title-2">
          <Badge variant="dot" tone={taskStatusTone(status)} />
          {title}
        </h2>
        {children}
      </div>
      <div className="tasks-summary__actions">{actions}</div>
      {active && <ActiveProgress job={active} />}
    </section>
  );
}

/**
 * 运行中的读数：进度条 + 五个关键数字。
 *
 * 「已处理 / 已跳过 / 失败 / 速度 / 预计剩余」是判断一次运行要不要继续
 * 的全部依据，其余信息（批次号、模型版本）在下面一行。
 */
function ActiveProgress({ job }: { job: AIJob }) {
  const percent = jobProgressPercent(job);
  const planned = job.planned ?? 0;
  const settled =
    job.status === "completed" ||
    job.status === "cancelled" ||
    job.status === "failed";

  return (
    <div className="mt-3 sm:col-span-2">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-page-sm font-medium tabular-nums text-fg">
            {percent}%
          </span>
          <span className="text-meta tabular-nums text-fg-muted">
            {planned > 0
              ? `${formatCount(job.completed)} / ${formatCount(planned)} 张`
              : settled
                ? "本次没有需要处理的图片"
                : "正在整理分析清单"}
          </span>
        </div>
      </div>

      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-bg-subtle"
        role="progressbar"
        aria-label="任务进度"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>

      <dl className="mt-4 grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-5">
        <Readout label="已处理" value={formatCount(job.processed)} />
        <Readout label="已跳过" value={formatCount(job.skipped)} />
        <Readout
          label="失败"
          value={formatCount(job.failed)}
          tone={job.failed > 0 ? "danger" : "default"}
        />
        <Readout label="速度" value={formatTaskSpeed(job.speedPerSecond)} />
        <Readout
          label="预计剩余"
          value={
            job.estimatedRemainingMs > 0
              ? formatTaskDuration(job.estimatedRemainingMs)
              : "—"
          }
        />
      </dl>

      {job.checkpoint.batch > 0 || job.recoveredAfterRestart ? (
        <p className="mt-3 flex flex-wrap items-center gap-x-4 text-meta text-fg-muted">
          <span>
            {job.checkpoint.batch > 0
              ? `已保存到第 ${formatCount(job.checkpoint.batch)} 批 · 位置 ${formatCount(job.checkpoint.offset)} / ${formatCount(job.total)}`
              : "尚无已提交批次，将从任务起点继续"}
          </span>
          {job.recoveredAfterRestart ? (
            <span className="font-medium text-fg">
              {job.checkpoint.batch > 0
                ? "服务重启后从此处续跑"
                : "服务重启后重新开始"}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

function Readout({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div>
      <dt className="text-meta text-fg-subtle">{label}</dt>
      <dd
        className={`mt-0.5 font-mono text-label font-medium tabular-nums ${
          tone === "danger" ? "text-danger" : "text-fg"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
