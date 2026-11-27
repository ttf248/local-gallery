import { buttonStyles } from "../../ui/buttonStyles";
import { useConfirm } from "../common";
import { SettingsGroup } from "../../ui/SettingsList";
import type { AIJob } from "../../api/aiJobs";
import { formatDateTime } from "../../utils/date";
import { taskModeLabel, taskTitle } from "../../utils/taskFormat";
import { ChevronDownIcon, ChevronUpIcon, TrashIcon } from "../../ui/icons";
import { Badge } from "../../ui/Badge";

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
  const confirm = useConfirm();
  async function clearQueue() {
    if (
      await confirm({
        title: "清空等待队列",
        description: (
          <>
            {`取消队列中的 ${jobs.length} 项等待任务？当前任务不会受影响。`}{" "}
            原始文件会保留。
          </>
        ),
        confirmLabel: "清空队列",
        tone: "danger",
      })
    ) {
      onClear();
    }
  }

  if (!loading && jobs.length === 0)
    return (
      <section
        aria-label="等待队列"
        className="flex min-h-10 items-center gap-4 rounded-lg border border-line px-4"
      >
        <h2 className="text-body font-medium">等待队列 · 0 项</h2>
        <p className="text-caption text-ink-2">当前没有等待中的任务。</p>
      </section>
    );

  return (
    <SettingsGroup
      id="task-queue"
      title={"等待队列 · " + (loading ? "…" : jobs.length + " 项")}
    >
      <div className="flex justify-end pt-2 pr-4">
        <button
          type="button"
          className={buttonStyles({ variant: "secondary", size: "sm" })}
          disabled={loading || busy || jobs.length === 0}
          onClick={clearQueue}
        >
          清空队列
        </button>
      </div>

      <div className="tasks-section__body mt-3">
        {loading ? (
          <p className="tasks-empty py-3.5 px-0 text-caption text-ink-3">
            正在读取等待队列…
          </p>
        ) : (
          <ol className="tasks-list border-t border-t-line">
            {jobs.map((job, index) => (
              <li
                key={job.id}
                className="tasks-list__row flex flex-wrap items-center gap-y-2.5 gap-x-4 py-[11px] px-0 border-t border-t-line first:[border-top:0] tasks-queue-card [.tasks-list_&]:my-1.5 [.tasks-list_&]:py-2 [.tasks-list_&]:px-2.5 [.tasks-list_&]:border [.tasks-list_&]:border-line [.tasks-list_&]:rounded-md [.tasks-list_&]:bg-canvas"
                data-testid="task-queue-row"
              >
                <span className="w-7 shrink-0 text-right font-mono text-caption tabular-nums text-ink-3">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Badge variant="dot" tone="neutral" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-body font-medium text-ink">
                      {taskTitle(job)}
                    </span>
                    <span className="text-caption text-ink-2">
                      {taskModeLabel(job.mode)}
                    </span>
                  </div>
                  <p className="mt-1 text-caption text-ink-3">
                    {job.scheduled ? "每日计划" : "手动加入"} ·{" "}
                    {formatDateTime(job.createdAt)}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    className={buttonStyles({
                      variant: "secondary",
                      size: "sm",
                      className: "px-2",
                    })}
                    aria-label={`上移 ${taskTitle(job)}`}
                    title="上移"
                    disabled={busy || index === 0}
                    onClick={() => onMove(job.id, "up")}
                  >
                    <ChevronUpIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className={buttonStyles({
                      variant: "secondary",
                      size: "sm",
                      className: "px-2",
                    })}
                    aria-label={`下移 ${taskTitle(job)}`}
                    title="下移"
                    disabled={busy || index === jobs.length - 1}
                    onClick={() => onMove(job.id, "down")}
                  >
                    <ChevronDownIcon size={16} />
                  </button>
                  <button
                    type="button"
                    className={buttonStyles({
                      variant: "secondary",
                      size: "sm",
                      className: "px-2 text-danger",
                    })}
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
    </SettingsGroup>
  );
}
