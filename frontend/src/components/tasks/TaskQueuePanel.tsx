import type { AIJob } from "../../api/aiJobs";
import { formatDateTime } from "../../utils/date";
import { taskModeLabel, taskTitle } from "../../utils/taskFormat";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "../../ui/icons";
import TaskStatusDot from "./TaskStatusDot";

interface Props {
  jobs: AIJob[];
  busy: boolean;
  loading: boolean;
  onMove: (id: string, direction: "up" | "down") => void;
  onCancel: (id: string) => void;
  onClear: () => void;
}

/**
 * 等待队列：可调整执行顺序，或取消单项/全部等待任务。
 *
 * 始终保留队列面板，让用户能在任务中心直接确认等待队列是否为空。
 */
export default function TaskQueuePanel({
  jobs,
  busy,
  loading,
  onMove,
  onCancel,
  onClear,
}: Props) {
  function clearQueue() {
    if (
      window.confirm(
        `取消队列中的 ${jobs.length} 项等待任务？当前任务不会受影响。`,
      )
    ) {
      onClear();
    }
  }

  return (
    <section className="tasks-section" aria-labelledby="task-queue-heading">
      <div className="tasks-section__head">
        <div className="min-w-0">
          <h2 id="task-queue-heading" className="tasks-section__title">
            等待队列 · {loading ? "…" : `${jobs.length} 项`}
          </h2>
          <p className="tasks-section__desc">
            按序启动多个模块后，后续任务会排在这里；顺序可以调整。
          </p>
        </div>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          disabled={loading || busy || jobs.length === 0}
          onClick={clearQueue}
        >
          清空队列
        </button>
      </div>

      <div className="tasks-section__body">
        {loading ? (
          <p className="tasks-empty">正在读取等待队列…</p>
        ) : jobs.length === 0 ? (
          <p className="tasks-empty">
            当前没有等待中的任务。按序启动多个模块后，后续任务会显示在这里。
          </p>
        ) : (
          <ol className="tasks-list">
            {jobs.map((job, index) => (
              <li
                key={job.id}
                className="tasks-list__row tasks-queue-card"
                data-testid="task-queue-row"
              >
                <span className="w-7 shrink-0 text-right font-mono text-meta tabular-nums text-fg-subtle">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <TaskStatusDot status="pending" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-label font-medium text-fg">
                      {taskTitle(job)}
                    </span>
                    <span className="text-meta text-fg-muted">
                      {taskModeLabel(job.mode)}
                    </span>
                  </div>
                  <p className="mt-1 text-meta text-fg-subtle">
                    {job.scheduled ? "每日计划" : "手动加入"} ·{" "}
                    {formatDateTime(job.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className="btn btn-sm btn-outline px-2"
                    aria-label={`上移 ${taskTitle(job)}`}
                    title="上移"
                    disabled={busy || index === 0}
                    onClick={() => onMove(job.id, "up")}
                  >
                    <ChevronUpIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline px-2"
                    aria-label={`下移 ${taskTitle(job)}`}
                    title="下移"
                    disabled={busy || index === jobs.length - 1}
                    onClick={() => onMove(job.id, "down")}
                  >
                    <ChevronDownIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-outline px-2 text-danger"
                    aria-label={`取消排队 ${taskTitle(job)}`}
                    title="取消排队"
                    disabled={busy}
                    onClick={() => onCancel(job.id)}
                  >
                    <TrashIcon size={15} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}
