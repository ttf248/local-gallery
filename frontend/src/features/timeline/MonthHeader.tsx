import { SectionHeader } from "../../ui/SectionHeader";
import { Badge } from "../../ui/Badge";
import { Tooltip } from "../../ui/Tooltip";
import { timelineSourceLabel, type TimelineGroup } from "../../utils/timeline";
import type { TimelineDateSource } from "../../api/library";
export default function MonthHeader({ group }: { group: TimelineGroup }) {
  const source = (Object.keys(group.sources) as TimelineDateSource[])
    .map(timelineSourceLabel)
    .join("、");
  return (
    <div
      data-testid="timeline-group-header"
      className="flex items-center gap-2"
    >
      <SectionHeader sticky title={group.label} count={group.count + " 张"} />
      {group.note && (
        <Tooltip content={group.note + " · " + source}>
          <Badge data-testid="timeline-group-note" tabIndex={0}>
            {group.key === "unknown" ? "无拍摄时间" : "推断"}
          </Badge>
        </Tooltip>
      )}
    </div>
  );
}
