import type { ComponentProps } from "react";
import TimelineFilterPopover, {
  TimelineMediaControl,
} from "./TimelineFilterPopover";
import { DensityControl } from "../wall";
import type { WallDensity } from "../../store/photoStore";

type Props = ComponentProps<typeof TimelineFilterPopover> & {
  density: WallDensity;
  setDensity: (density: WallDensity) => void;
  onJump?: () => void;
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
}: Props) {
  return (
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
      <div className="hidden md:block">
        <DensityControl
          value={density}
          onChange={setDensity}
          presentation="popover"
        />
      </div>
      {onJump && (
        <button
          type="button"
          className="rounded-lg px-2 py-2 text-caption md:hidden"
          onClick={onJump}
        >
          跳转
        </button>
      )}
    </>
  );
}
