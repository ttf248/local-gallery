import { useConfirm } from "../common";
import { useState } from "react";
import type { AIJob, FaceModel } from "../../api/aiJobs";
import { formatDateTime } from "../../utils/date";
import {
  formatCount,
  formatTaskDuration,
  formatTaskSpeed,
  taskFieldLabel,
  taskModeLabel,
  taskResultLabel,
  taskStatusLabel,
  taskTitle,
} from "../../utils/taskFormat";
import { EmptyState } from "../common";
import { ChevronDownIcon } from "../../ui/icons";
import FailureGroupList from "./FailureGroupList";
import JobOutputSummary from "./JobOutputSummary";
import { Badge } from "../../ui/Badge";
import { taskStatusTone } from "../../utils/taskFormat";

interface Props {
  jobs: AIJob[];
  /** 有任务在跑时不能重试：后端同一时间只允许一个活动任务。 */
  retryDisabled: boolean;
  busy: boolean;
  onRetry: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

/** 任务记录：每一行一次任务，展开后是它的规格、产出与失败项。 */
export default function JobHistoryPanel({
  jobs,
  retryDisabled,
  busy,
  onRetry,
  onDelete,
  onClear,
}: Props) {
  const confirm = useConfirm();
  const [filter, setFilter] = useState<HistoryFilter>("all");
  // 展开态：只有展开的记录才去取它的产物占用。details 本身仍由浏览器
  // 控制（受控写法会让展开延迟到 React 状态回写，用户点下去要等一拍
  // 才看到内容），这里只监听 toggle 事件记住谁开着。
  const [expandedIds, setExpandedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );

  function handleToggle(jobId: string, open: boolean) {
    setExpandedIds((current) => {
      if (current.has(jobId) === open) return current;
      const next = new Set(current);
      if (open) next.add(jobId);
      else next.delete(jobId);
      return next;
    });
  }
  const counts: Record<HistoryFilter, number> = {
    all: jobs.length,
    completed: jobs.filter((job) => job.status === "completed").length,
    failed: jobs.filter((job) => job.status === "failed").length,
    cancelled: jobs.filter((job) => job.status === "cancelled").length,
  };
  const visibleJobs =
    filter === "all" ? jobs : jobs.filter((job) => job.status === filter);

  async function clearHistory() {
    if (
      jobs.length > 0 &&
      (await confirm({title:"清理已结束记录",description:<>{`删除全部 ${jobs.length} 条已结束任务记录？分析结果和索引数据会保留。`} 原始文件会保留。</>,confirmLabel:"清理记录",tone:"danger"}))
    ) {
      onClear();
    }
  }

  return (
    <section className="tasks-section mt-4 p-[clamp(12px,2vw,22px)] border border-line rounded-tile bg-raised" aria-labelledby="task-history-heading">
      <div className="tasks-section__head flex flex-wrap items-start justify-between gap-y-2.5 gap-x-5">
        <div className="min-w-0">
          <h2 id="task-history-heading" className="tasks-section__title font-display text-body font-semibold text-ink">
            任务记录
          </h2>
          <p className="tasks-section__desc mt-[3px] text-caption leading-[1.6] text-ink-3 max-w-[68ch]">
            每次已结束的任务的耗时、产出与失败原因都在这里。删除记录只清理任务日志，
            不会删除已生成的元数据、向量、文字或人脸结果。
          </p>
        </div>
        {jobs.length > 0 ? (
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={busy}
            onClick={clearHistory}
          >
            清理已结束记录
          </button>
        ) : null}
      </div>

      <div className="tasks-section__body mt-3">
        {jobs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 pb-3">
            {HISTORY_FILTERS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={`btn btn-sm ${filter === value ? "btn-primary" : "btn-outline"}`}
                aria-pressed={filter === value}
                onClick={() => setFilter(value)}
              >
                {label}{" "}
                <span className="ml-1 font-mono tabular-nums">
                  {counts[value]}
                </span>
              </button>
            ))}
          </div>
        ) : null}

        {visibleJobs.length === 0 ? (
          <EmptyState size="inline"
            title={
              jobs.length === 0 ? "还没有已结束的任务" : "没有符合条件的记录"
            }
            description={
              jobs.length === 0
                ? "运行一次分析后，耗时、产出和失败原因会显示在这里。"
                : "选择其他状态查看任务记录。"
            }
          />
        ) : (
          <div className="tasks-list border-t border-t-line">
            {visibleJobs.map((job) => (
              <details
                key={job.id}
                onToggle={(event) =>
                  handleToggle(job.id, event.currentTarget.open)
                }
                className="group border-t border-line first:border-t-0"
                data-testid="task-history-row"
                data-job-id={job.id}
              >
                <summary className="flex cursor-pointer list-none items-start gap-3 py-3 [&::-webkit-details-marker]:hidden">
                  <Badge
                    variant="dot"
                    tone={taskStatusTone(job.status)}
                    className="mt-2"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-body font-medium text-ink">
                        {taskTitle(job)}
                      </span>
                      <span className="text-caption text-ink-2">
                        {taskModeLabel(job.mode)}
                      </span>
                      <span className="text-caption text-ink-3">
                        {taskStatusLabel(job.status)}
                      </span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-caption text-ink-3">
                      <span>{formatDateTime(job.createdAt)}</span>
                      <span>耗时 {formatTaskDuration(job.elapsedMs)}</span>
                      <span className="tabular-nums">
                        完成 {formatCount(job.completed)}
                      </span>
                      <span className="tabular-nums">
                        跳过 {formatCount(job.skipped)}
                      </span>
                      <span
                        className={`tabular-nums ${
                          job.failed > 0 ? "text-danger" : ""
                        }`}
                      >
                        失败 {formatCount(job.failed)}
                      </span>
                      {job.type === "face" ? (
                        <span>模型 {faceModelLabel(job.faceModel)}</span>
                      ) : null}
                    </div>
                  </div>
                  <ChevronDownIcon
                    size={16}
                    className="mt-1 shrink-0 text-ink-3 transition-transform group-open:rotate-180"
                  />
                </summary>

                <div className="border-t border-line pb-4 pt-4">
                  <dl className="grid max-w-2xl gap-x-8 sm:grid-cols-2">
                    <SpecRow
                      label="开始"
                      value={formatDateTime(job.startedAt)}
                    />
                    <SpecRow
                      label="结束"
                      value={formatDateTime(job.finishedAt)}
                    />
                    <SpecRow
                      label="耗时"
                      value={formatTaskDuration(job.elapsedMs)}
                    />
                    <SpecRow
                      label="速度"
                      value={formatTaskSpeed(job.speedPerSecond)}
                    />
                    <SpecRow
                      label="模块版本"
                      value={job.moduleVersion || "—"}
                      fullWidth
                    />
                    {job.type === "face" ? (
                      <SpecRow
                        label="使用模型"
                        value={faceModelLabel(job.faceModel)}
                        fullWidth
                      />
                    ) : null}
                  </dl>

                  {job.error ? (
                    <p className="mt-3 text-caption text-danger">
                      任务原因：{job.error}
                    </p>
                  ) : null}

                  <JobOutputSummary
                    jobId={job.id}
                    enabled={expandedIds.has(job.id)}
                  />

                  <OutputBreakdown job={job} />

                  {job.errors && job.errors.length > 0 ? (
                    <div className="mt-4">
                      <p className="mb-2 text-caption font-medium text-ink">
                        失败文件
                      </p>
                      <FailureGroupList errors={job.errors} />
                    </div>
                  ) : null}

                  <div className="mt-4 flex flex-wrap gap-2">
                    {job.status === "failed" ||
                    job.status === "cancelled" ||
                    job.failed > 0 ? (
                      <button
                        type="button"
                        className="btn btn-sm btn-outline"
                        disabled={retryDisabled}
                        onClick={() => onRetry(job.id)}
                      >
                        {job.status === "cancelled"
                          ? "重新运行未完成项"
                          : "仅重试失败项"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="btn btn-sm btn-outline text-danger"
                      disabled={busy}
                      onClick={async () => {if(await confirm({title:"删除任务记录",description:"仅删除这一条记录，分析结果和原始文件会保留。",confirmLabel:"删除记录",tone:"danger"}))onDelete(job.id);}}
                    >
                      删除任务记录
                    </button>
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

type HistoryFilter = "all" | "completed" | "failed" | "cancelled";

function faceModelLabel(model?: FaceModel): string {
  if (model === "quality-v2") return "YuNet + SFace（quality-v2）";
  if (model === "buffalo_m") return "SCRFD + ResNet50（Buffalo_m）";
  return "未知";
}

const HISTORY_FILTERS: { value: HistoryFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "completed", label: "已完成" },
  { value: "failed", label: "失败" },
  { value: "cancelled", label: "已取消" },
];

function SpecRow({
  label,
  value,
  fullWidth = false,
}: {
  label: string;
  value: string;
  fullWidth?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 border-b border-line py-1.5 ${fullWidth ? "sm:col-span-2" : ""}`}
    >
      <dt className="shrink-0 whitespace-nowrap text-caption text-ink-3">
        {label}
      </dt>
      <dd
        className={`min-w-0 font-mono text-caption tabular-nums text-ink ${fullWidth ? "break-all text-right" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

/** 这次任务的产出：解析结果分类与字段产出。 */
function OutputBreakdown({ job }: { job: AIJob }) {
  // 计数多的排前面；后端给的是无序表，顺序不能靠运气。
  const fields = Object.entries(job.fields ?? {}).sort(
    (left, right) => right[1] - left[1],
  );
  const results = Object.entries(job.results ?? {}).sort(
    (left, right) => right[1] - left[1],
  );
  if (results.length === 0 && fields.length === 0) return null;

  return (
    <div className="mt-4">
      <p className="text-caption font-medium text-ink">产出明细</p>
      <div className="mt-2 space-y-1.5">
        {results.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <span className="text-caption text-ink-3">
              {job.type === "metadata" ? "解析结果" : "处理结果"}
            </span>
            {results.map(([key, value]) => (
              <CountChip
                key={`result-${key}`}
                label={taskResultLabel(key)}
                value={value}
              />
            ))}
          </div>
        ) : null}
        {fields.length > 0 ? (
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            <span className="text-caption text-ink-3">提取字段</span>
            {fields.map(([key, value]) => (
              <CountChip
                key={`field-${key}`}
                label={taskFieldLabel(key)}
                value={value}
              />
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-caption">
      <span className="text-ink-3">{label}</span>
      <span className="font-mono tabular-nums text-ink">
        {formatCount(value)}
      </span>
    </span>
  );
}
