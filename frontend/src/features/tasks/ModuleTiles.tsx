import { Menu } from "../../ui/Menu";
import { CheckIcon, MoreHorizontalIcon } from "../../ui/icons";
import type {
  AIJob,
  AIJobEstimate,
  AIJobModule,
  AnalysisMode,
  AnalysisType,
} from "../../api/aiJobs";
import {
  estimateForModule,
  formatCount,
  moduleReasonLabel, taskStatusLabel,
} from "../../utils/taskFormat";

interface Props {
  modules: AIJobModule[];
  selected: AnalysisType[];
  onToggle: (type: AnalysisType) => void;
  disabled?: boolean;
  locked?: AnalysisType[];
  label?: string;
  estimate?: AIJobEstimate;
  history?: AIJob[];
  mode?: AnalysisMode;
}

export default function ModuleTiles({
  modules,
  selected,
  onToggle,
  disabled = false,
  locked = [],
  label = "分析模块",
  estimate,
  history = [],
  mode = "incremental",
}: Props) {
  if (modules.length === 0) return null;

  return (
    <div className="grid gap-1" role="group" aria-label={label}>
      {modules.map((module) => {
        const isSelected = selected.includes(module.type);
        const isLocked = locked.includes(module.type);
        const isDisabled = disabled || !module.installed || isLocked;
        const readiness = !module.installed
          ? moduleReasonLabel(module.reason ?? "") || "未就绪"
          : isLocked
            ? "需先启用人物分析"
            : "就绪";
        const amount = estimateForModule(estimate, module.type, mode);
        const previous = history.find((job) => job.type === module.type);
        return (
          <div key={module.type} className="relative min-w-0">
            <button
              type="button"
              title={module.name + " · " + readiness}
              aria-label={module.name}
              aria-pressed={isSelected}
              disabled={isDisabled}
              onClick={() => onToggle(module.type)}
              className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 rounded-lg border-2 border-transparent bg-raised pl-7 pr-11 text-left shadow-1 aria-pressed:border-accent disabled:opacity-50"
            >
              {isSelected && (
                <CheckIcon
                  size={14}
                  aria-hidden="true"
                  className="absolute left-2 text-accent"
                />
              )}
              <span className="text-label font-medium">{module.name}</span>
              <span className="text-body tabular-nums">
                {amount ? formatCount(amount.count) : "—"}
                <small className="ml-1 text-caption">张</small>
              </span>
              <span className="flex items-center gap-1 text-caption text-ink-2">
                <span
                  aria-hidden="true"
                  className={
                    "size-1.5 shrink-0 rounded-full " +
                    (!module.installed || isLocked
                      ? "bg-ink-3"
                      : previous?.status === "failed"
                        ? "bg-danger"
                        : "bg-success")
                  }
                />
                {!module.installed
                  ? "不可用：" + readiness
                  : isLocked ? readiness : previous?.status === "failed"
                    ? "上次失败"
                    : readiness}
              </span>
            </button>
            <Menu
              label={module.name + "详情"}
              align="end"
              className="absolute right-1 top-1/2 -translate-y-1/2"
              trigger={
                <button
                  type="button"
                  className="grid size-8 place-items-center rounded-md text-ink-2"
                  aria-label={module.name + "详情"}
                >
                  <MoreHorizontalIcon size={15} />
                </button>
              }
              items={[
                {
                  type: "label",
                  label:module.name,
                },
                {
                  type: "label",
                  label: previous
                    ? "上次 · " + taskStatusLabel(previous.status)
                    : readiness,
                },
              ]}
            />
          </div>
        );
      })}
    </div>
  );
}
