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
  moduleReasonLabel,
  taskStatusLabel,
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

export default function ModuleChips({
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
    <div className="task-module-matrix" role="group" aria-label={label}>
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
          <button
            key={module.type}
            type="button"
            aria-label={module.name}
            aria-pressed={isSelected}
            disabled={isDisabled}
            onClick={() => onToggle(module.type)}
            className="task-module-card"
            title={`${module.name} · ${readiness}`}
          >
            <span className="task-module-card__name">{module.name}</span>
            <span className="task-module-card__state">
              <span
                aria-hidden
                className="task-module-card__dot"
                data-ready={module.installed && !isLocked}
              />
              {readiness}
            </span>
            {amount && (
              <span className="task-module-card__count">
                {formatCount(amount.count)} 张待处理
              </span>
            )}
            {previous && (
              <span className="task-module-card__state">
                上次 · {taskStatusLabel(previous.status)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
