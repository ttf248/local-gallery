import { Badge } from "../../ui/Badge";
import { Tooltip } from "../../ui/Tooltip";
import { timelineSourceLabel, type TimelineGroup } from "../../utils/timeline";
import type { TimelineDateSource } from "../../api/library";
export default function MonthHeader({
  group,
  showYear,
}: {
  group: TimelineGroup;
  showYear?: boolean;
}) {
  const source = (Object.keys(group.sources) as TimelineDateSource[])
    .map(timelineSourceLabel)
    .join("、");
  return (
    <>
      {showYear && (
        <div aria-hidden className="mb-3 flex items-center gap-3 text-title">
          {group.year}
          <span className="h-px flex-1 bg-line" />
        </div>
      )}
      <div
        data-testid="timeline-group-header"
        className="flex flex-wrap items-baseline gap-x-2 gap-y-1"
      >
        <h2 className="text-heading">{group.label}</h2>
        <span className="text-caption tabular-nums text-ink-3">
          {group.count} 张
        </span>
        {group.note && (
          <Tooltip content={source}>
            <Badge data-testid="timeline-group-note" tabIndex={0}>
              {group.note}
            </Badge>
          </Tooltip>
        )}
      </div>
    </>
  );
}
