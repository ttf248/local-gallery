import type { MouseEvent, ReactNode } from "react";
import type { LibraryMediaItem } from "../../api/library";
import { CheckIcon, PlayFilledIcon, StarIcon } from "../../ui/icons";
import { ThumbImage, VideoCoverImage } from "../common";

interface Props {
  item: LibraryMediaItem;
  width: number;
  height: number;
  selected: boolean;
  selecting: boolean;
  picked: boolean;
  duration?: string;
  sourceLabel?: string;
  badge?: string;
  overlay?: ReactNode;
  action?: ReactNode;
  onOpen: () => void;
  onSelect?: (range: boolean) => void;
  onPick?: () => void;
  onVideoFocus: (active: boolean) => void;
  onContextMenu?: (event: MouseEvent<HTMLButtonElement>) => void;
}
export default function MediaTile({
  item,
  width,
  height,
  selected,
  selecting,
  picked,
  duration,
  sourceLabel,
  badge,
  overlay,
  action,
  onOpen,
  onSelect,
  onPick,
  onVideoFocus,
  onContextMenu,
}: Props) {
  const video = item.kind === "video";
  const reveal =
    "opacity-100 pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100";
  return (
    <div
      className={
        "photo-wall-tile group relative shrink-0 overflow-hidden rounded-tile hover:brightness-[1.04] " +
        (selected ? "bg-accent-soft" : "bg-media")
      }
      data-testid="media-tile"
      data-media-id={item.id}
      role={selecting ? "gridcell" : undefined}
      aria-selected={selecting ? selected : undefined}
      style={{ width, height }}
    >
      <div
        className={
          "h-full w-full transition-transform duration-slow " +
          (selected ? "scale-[.92]" : "motion-safe:group-hover:scale-[1.015]")
        }
      >
        {video ? (
          <VideoCoverImage
            fit="cover"
            videoPath={item.id}
            version={item.version}
            displayWidth={width}
            alt={item.name}
            loading="lazy"
          />
        ) : (
          <ThumbImage
            fileId={item.id}
            alt={item.name}
            loading="lazy"
            version={item.version}
            displayWidth={width}
            undecodable={item.undecodable}
            className="h-full w-full object-cover"
          />
        )}
        {overlay}
      </div>
      <button
        type="button"
        data-open
        aria-label={(video ? "播放 " : "查看 ") + item.name}
        aria-pressed={selecting ? selected : undefined}
        title={sourceLabel ? sourceLabel + " · " + item.name : item.name}
        className="absolute inset-0 z-0 h-full w-full focus-visible:ring-inset"
        onClick={(e) =>
          onSelect && (selecting || e.shiftKey)
            ? onSelect(e.shiftKey)
            : onOpen()
        }
        onContextMenu={onContextMenu}
        onPointerEnter={() => video && onVideoFocus(true)}
        onFocus={() => video && onVideoFocus(true)}
        onBlur={() => video && onVideoFocus(false)}
        onPointerLeave={() => video && onVideoFocus(false)}
      />
      <div
        data-testid="wall-tile-info"
        className={
          "tile-overlay pointer-events-none absolute inset-x-0 bottom-0 flex h-2/5 items-end justify-between gap-2 bg-gradient-to-t from-black/55 to-transparent px-2 pb-1.5 text-caption text-white transition-opacity " +
          reveal
        }
      >
        <span className="truncate">{sourceLabel || item.name}</span>
        {Boolean(item.width && item.height) && !video && (
          <span className="mouse-only touch:hidden shrink-0 tabular-nums">
            {item.width}×{item.height}
          </span>
        )}
      </div>
      {video && (
        <span className="pointer-events-none absolute bottom-1 right-1 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-caption text-white">
          <PlayFilledIcon size={10} />
          {duration ?? "视频"}
        </span>
      )}
      {badge && (
        <span className="opacity-100 pointer-fine:opacity-0 pointer-events-none absolute bottom-1 left-1 max-w-[calc(100%-8px)] truncate rounded bg-black/70 px-1.5 text-caption text-white group-hover:opacity-100 group-focus-within:opacity-100">
          {badge}
        </span>
      )}
      {action}
      {onSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={"选择「" + item.name + "」"}
          onClick={(e) => onSelect(e.shiftKey)}
          className={
            "absolute left-0 top-0 grid size-9 place-items-center " +
            (selecting ? "" : reveal)
          }
        >
          <span
            className={
              "grid size-[22px] place-items-center rounded-full border-[1.5px] text-white " +
              (selected
                ? "border-accent bg-accent"
                : "border-white bg-black/25")
            }
          >
            {selected && <CheckIcon size={14} />}
          </span>
        </button>
      )}
      {onPick && !selecting && (
        <button
          type="button"
          aria-pressed={picked}
          aria-label={"把 " + item.name + (picked ? " 移出精选" : " 加入精选")}
          title={picked ? "移出精选" : "加入精选"}
          className={
            "absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-black/55 text-white " +
            (picked ? "" : reveal)
          }
          onClick={onPick}
        >
          <StarIcon filled={picked} size={16} />
        </button>
      )}
    </div>
  );
}
