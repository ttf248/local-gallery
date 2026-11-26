import {useMediaQuery,WIDE_LAYOUT_QUERY} from "../hooks/useMediaQuery";
import { isValidElement, useEffect } from "react";
import { useAppMode } from "../hooks/useAppMode";
import { hasAppHistory, useSafeBack } from "../utils/navigation";
import { workbenchCopy } from "../utils/workbench";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";

import { cx } from "../ui/cx";
import { MoreHorizontalIcon, ChevronLeftIcon, SearchIcon } from "../ui/icons";
import { usePageChromeState } from "./PageChrome";
import { useRouteMeta, documentTitle } from "../app/routeMeta";
import { libraryRoute } from "../utils/path";
interface Props {
  scrolled: boolean;
  onSearch: () => void;
  onHelp: () => void;
  onRefresh: () => void;
  onScan: () => void;
  onShuffle: () => void;
  canScan: boolean;
  shufflePending: boolean;
}
export function CanvasTopBar({
  scrolled,
  onSearch,
  onHelp,
  onRefresh,
  onScan,
  onShuffle,
  canScan,
  shufflePending,
}: Props) {
  const { title, backTo, titleCollapsed, actions, search } =
      usePageChromeState(),
    { mode } = useAppMode(),
    route = useRouteMeta();
  const wide=useMediaQuery(WIDE_LAYOUT_QUERY);
  const meta = route?.meta ?? null,
    params = route?.params ?? {};
  const configuredBack = meta?.chrome.back;
  const fallback =
    backTo ??
    (configuredBack === "history"
      ? libraryRoute(mode)
      : configuredBack?.(params));
  // 深链的上级由相册数据决定，交给页内的上下文返回入口。
  const showBack = backTo || (configuredBack === "history" ? hasAppHistory() : configuredBack);
  const back = useSafeBack(fallback ?? "/");
  const localSearch = meta?.chrome.search === "local" && isValidElement(search);
  const routeTitle = documentTitle(meta, params, mode);
  const fullTitle = documentTitle(meta, params, mode, title);
  useEffect(() => {
    document.title = fullTitle;
  }, [fullTitle]);
  return (
    <header
      data-testid="top-bar"
      className={cx(
        "top-bar sticky top-0 z-topbar grid h-topbar bg-canvas/80 backdrop-blur-xl backdrop-saturate-150 shrink-0 items-center gap-2 border-b px-gutter",
        localSearch
          ? "grid-cols-[auto_minmax(0,1fr)_auto]"
          : "grid-cols-[minmax(0,1fr)_auto_auto]",
        scrolled ? "border-line-subtle" : "border-transparent",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {showBack && (
          <IconButton label="返回" onClick={back}>
            <ChevronLeftIcon />
          </IconButton>
        )}
        {localSearch ? (
          <h1 className="sr-only whitespace-nowrap text-heading sm:not-sr-only sm:mr-3">
            {title}
          </h1>
        ) : (
          titleCollapsed && (
            <span className="truncate text-subheading motion-safe:animate-[fadeIn_180ms_linear]">
              {title || routeTitle.split(" · ")[0]}
            </span>
          )
        )}
      </div>
      {localSearch
        ? search
        : !wide && (meta?.chrome.search ?? "global") === "global" &&
          search !== "none" && (
            <button
              type="button"
              aria-label="打开命令面板"
              aria-keyshortcuts="Control+K Meta+K /"
              data-command-trigger
              onClick={onSearch}
              className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-hover lg:hidden"
            ><SearchIcon size={20}/>
            </button>
          )}
      <div className="col-end-4 flex min-w-0 items-center justify-end gap-2">
        {actions}
        <Menu
          label="更多操作"
          align="end"
          trigger={
            <IconButton
              label="更多操作"
              data-command-trigger={localSearch || undefined}
            >
              <MoreHorizontalIcon />
            </IconButton>
          }
          items={[
            ...(!wide && localSearch
              ? [{ id: "commands", label: "打开命令面板", onSelect: onSearch }]
              : []),
            {
              id: "shuffle",
              label: workbenchCopy(mode).randomLabel,
              shortcut: "R",
              onSelect: onShuffle,
              disabled: shufflePending,
            },
            {
              id: "help",
              label: "快捷键帮助",
              shortcut: "?",
              onSelect: onHelp,
            },
            { id: "refresh", label: "刷新媒体库", onSelect: onRefresh },
            {
              id: "scan",
              label: "重新扫描",
              shortcut: "Ctrl+S",
              onSelect: onScan,
              disabled: !canScan,
            },
          ]}
        />
      </div>
    </header>
  );
}
