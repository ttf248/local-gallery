import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type {
  AlbumFilterFacets,
  AlbumFilterUnresolved,
} from "../../api/library";
import { FilterIcon } from "../common/Icon";
import {
  albumFilterCount,
  type AlbumFilterState,
} from "../../utils/albumFilter";
import AlbumFilterPanel from "./AlbumFilterPanel";

interface Props {
  compact?: boolean;
  state: AlbumFilterState;
  facets?: AlbumFilterFacets;
  facetsLoading?: boolean;
  facetsError?: boolean;
  retryingFacets?: boolean;
  onRetryFacets?: () => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  /** 当前条件下的照片数。 */
  resultCount: number;
  /** 这本相册里的照片数（不含视频）。 */
  photoCount: number;
  /** 因缺少依据而没能参与筛选的照片数。 */
  unresolved: AlbumFilterUnresolved;
  /** 折叠后藏起来的照片数与组数。 */
  grouped: number;
  groupedGroups: number;
  onChange: (next: AlbumFilterState) => void;
  onClear: () => void;
}

/**
 * 照片墙的筛选条。
 *
 * 它只占一行：照片墙的页头每一行都是照片的位置，筛选入口不能自己
 * 占一行。条件生效时给一枚计数，结果数与「没被算进来」的数量一并
 * 摆在旁边 —— 说不清后一个数字，筛选结果就会被当成全貌。
 */
export default function AlbumFilterBar({
  state,
  compact = false,
  facets,
  facetsLoading,
  facetsError,
  retryingFacets,
  onRetryFacets,
  filterOpen,
  onFilterOpenChange,
  resultCount,
  photoCount,
  unresolved,
  grouped,
  groupedGroups,
  onChange,
  onClear,
}: Props) {
  const count = albumFilterCount(state);
  const filtered = count > 0;
  /* 折叠也是「墙上少了东西」：折叠开着时也要报出现在墙上的张数，
     否则用户看着 136 张照片，条上却写着 159 张。 */
  const reduced = filtered || state.collapse === true;
  const missing = unresolved.total;
  const collapseUsable =
    !facets ||
    (facets.similarity.available && facets.similarity.groupCount > 0);
  const collapseKnown = facets?.similarity.available === true;

  const collapseControl = (!collapseKnown || collapseUsable) && (
    <button
      type="button"
      onClick={() => onChange({ ...state, collapse: !state.collapse })}
      disabled={!collapseUsable}
      aria-pressed={state.collapse === true}
      title={
        collapseUsable
          ? "把相似的照片折成一组，只在墙上留代表照片"
          : "这本相册里还没有相似照片的分析结果"
      }
      className={`ui-btn ui-btn--ghost ${
        state.collapse
          ? "bg-accent/12 text-accent"
          : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      折叠相似
    </button>
  );
  const summary =
    reduced || missing > 0 ? (
      <span className="text-meta tabular-nums text-fg-subtle">
        {reduced ? (
          <>
            {resultCount} / {photoCount} 张
          </>
        ) : null}
        {missing > 0 && (
          <span className="ml-1 text-fg-muted">· {missing} 张未纳入</span>
        )}
        {state.collapse && grouped > 0 && (
          <span className="ml-1 text-fg-muted">
            · 折叠 {groupedGroups} 组 / {grouped} 张
          </span>
        )}
      </span>
    ) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <FilterDropdown
        label="筛选"
        count={count}
        open={filterOpen}
        onOpenChange={onFilterOpenChange}
        panel={
          <>
            <AlbumFilterPanel
              state={state}
              facets={facets}
              facetsLoading={facetsLoading}
              facetsError={facetsError}
              retryingFacets={retryingFacets}
              onRetryFacets={onRetryFacets}
              onChange={onChange}
              onClear={onClear}
              /* 面板底下报的是「照片」：视频不参与筛选，没条件时也不该
               混进这个数里。 */
              resultCount={reduced ? resultCount : photoCount}
            />
            {compact && <div className="lg:hidden">{collapseControl}</div>}
          </>
        }
      />

      {/* 相似折叠只在真有相似组时才摆出来：没有可折叠的东西时，
          给一个点了没反应的开关键只是噪音。 */}
      {compact ? (
        <div className="hidden lg:block">{collapseControl}</div>
      ) : (
        collapseControl
      )}

      {/* 张数只在「墙上真的少了东西」时才报：页头已经写着这本相册有
          多少张，这里再写一遍是同一句话说两遍。而「13 / 20 张」这种
          读数只有筛过或折叠过才带新消息 —— 那时它说的不是重复，
          而是「现在墙上这些是从多少里挑出来的」。 */}
      {compact ? <span className="hidden xl:inline">{summary}</span> : summary}

      {filtered && (
        <button
          type="button"
          className={
            compact
              ? "hidden lg:inline-flex ui-btn ui-btn--ghost"
              : "btn-text text-meta text-fg-muted hover:text-fg"
          }
          onClick={onClear}
        >
          清除
        </button>
      )}
    </div>
  );
}

interface DropdownProps {
  label: string;
  count: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  panel: ReactNode;
  dialogLabel?: string;
}

/**
 * 一个轻量的下拉：点按钮开面板，点外面或按 Esc 关上。
 *
 * 不用通用的 Popover：那一族是菜单（role=menu、方向键在菜单项间跳），
 * 筛选面板是一块内容，语义与键盘行为都不一样。
 *
 * 面板挂在视口上，不挂在按钮上：按钮在窄屏上贴着内容区的右边，
 * 面板右对齐到按钮就会有一半掉出屏幕。位置量出来再夹到视口里。
 */
export function FilterDropdown({
  label,
  count,
  open,
  onOpenChange,
  panel,
  dialogLabel = "筛选照片",
}: DropdownProps) {
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus({ preventScroll: true });
    const onPointerDown = (event: MouseEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      if (menuRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      onOpenChange(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onOpenChange, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const update = () => {
      const trigger = triggerRef.current;
      const menu = menuRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      const width = menu?.offsetWidth ?? 320;
      const height = menu?.offsetHeight ?? 420;
      const margin = 8;
      let left = rect.right - width;
      if (left < margin) left = margin;
      if (left + width > window.innerWidth - margin) {
        left = window.innerWidth - margin - width;
      }
      let top = rect.bottom + 6;
      if (top + height > window.innerHeight - margin) {
        const above = rect.top - 6 - height;
        top =
          above >= margin
            ? above
            : Math.max(margin, window.innerHeight - margin - height);
      }
      setPosition((previous) =>
        previous &&
        Math.abs(previous.top - top) < 0.5 &&
        Math.abs(previous.left - left) < 0.5
          ? previous
          : { top, left },
      );
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`ui-btn ui-btn--ghost inline-flex items-center gap-1.5 text-meta focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
          count > 0
            ? "bg-accent/12 text-accent"
            : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
        }`}
      >
        <FilterIcon size={13} />
        {label}
        {count > 0 && (
          <span className="rounded-full bg-accent/20 px-1.5 text-badge tabular-nums text-accent">
            {count}
          </span>
        )}
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            role="dialog"
            aria-label={dialogLabel}
            tabIndex={-1}
            style={{
              position: "fixed",
              /* 位置量出来之前先挂在屏外：面板始终在 DOM 里，
               量得到真实尺寸；布局阶段再把它挪到该在的地方。 */
              top: position?.top ?? -9999,
              left: position?.left ?? -9999,
              zIndex: 35,
            }}
            className="ui-popover w-[360px] max-w-[calc(100vw-16px)] max-h-[calc(100dvh-16px)] overflow-y-auto p-3"
          >
            {panel}
          </div>,
          document.body,
        )}
    </div>
  );
}
