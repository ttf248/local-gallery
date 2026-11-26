import type { ComponentProps, ReactNode } from "react";
import TimelineFilterPopover, {
  TimelineMediaControl,
} from "./TimelineFilterPopover";
import { DensityControl } from "../wall";
import type { WallDensity } from "../../store/photoStore";

import { PageToolbar } from "../../shell/PageToolbar";
import { Button } from "../../ui/Button";
import { FilterChip } from "../../ui/FilterChip";
import {
  timelinePrecisionLabel,
  timelineSourceLabel,
} from "../../utils/timeline";

type Props = ComponentProps<typeof TimelineFilterPopover> & {
  density: WallDensity;
  setDensity: (density: WallDensity) => void;
  onJump?: () => void;
  onSelect: () => void;
  selecting: boolean;
  resume?: ReactNode;
};

export function TimelineToolbar({
  years,
  filter,
  dateSources,
  datePrecisions,
  unknown,
  onChange,
  density,
  setDensity,
  onJump,
  onSelect,
  selecting,
  resume,
}: Props) {
  return (
    <PageToolbar
      label="时间线工具"
      start={
        <>
          <div className="hidden md:block">
            <TimelineMediaControl filter={filter} onChange={onChange} />
          </div>
          <TimelineFilterPopover
            years={years}
            filter={filter}
            dateSources={dateSources}
            datePrecisions={datePrecisions}
            unknown={unknown}
            onChange={onChange}
          />
          {onJump && (
            <Button variant="ghost" className="md:hidden" onClick={onJump}>
              跳转
            </Button>
          )}
        </>
      }
      end={
        <>
          {resume}
          <div className="hidden md:block">
            <DensityControl value={density} onChange={setDensity} />
          </div>
          <Button
            variant="secondary"
            aria-pressed={selecting}
            onClick={onSelect}
          >
            {selecting ? "退出选择" : "选择"}
          </Button>
        </>
      }
    >
      {(filter.year || filter.media || filter.source || filter.precision) && (
        <>
          {filter.year && (
            <FilterChip
              label={
                filter.year === "unknown"
                  ? "日期未知"
                  : `${filter.year} 年${filter.month ? " " + filter.month + " 月" : ""}`
              }
              onRemove={() => onChange({ ...filter, year: "", month: "" })}
            />
          )}
          {filter.media && (
            <FilterChip
              label={filter.media === "video" ? "视频" : "照片"}
              onRemove={() => onChange({ ...filter, media: "" })}
            />
          )}
          {filter.source && (
            <FilterChip
              label={timelineSourceLabel(filter.source)}
              onRemove={() => onChange({ ...filter, source: undefined })}
            />
          )}
          {filter.precision && (
            <FilterChip
              label={timelinePrecisionLabel(filter.precision)}
              onRemove={() => onChange({ ...filter, precision: undefined })}
            />
          )}
        </>
      )}
    </PageToolbar>
  );
}
