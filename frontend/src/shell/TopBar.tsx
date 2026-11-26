import { isValidElement, useEffect } from "react";
import { useAppMode } from "../hooks/useAppMode";
import { hasAppHistory, useSafeBack } from "../utils/navigation";
import { workbenchCopy } from "../utils/workbench";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { Kbd } from "../ui/Kbd";
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
export function TopBar({
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
        "top-bar sticky top-0 z-topbar grid h-topbar shrink-0 items-center gap-2 border-b px-[var(--gutter)]",
        localSearch
          ? "grid-cols-[auto_minmax(0,1fr)_auto]"
          : "grid-cols-[1fr_auto_auto] lg:grid-cols-[1fr_auto_1fr]",
        scrolled ? "border-line" : "border-transparent",
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
            <span className="truncate text-heading">
              {title || routeTitle.split(" · ")[0]}
            </span>
          )
        )}
      </div>
      {localSearch
        ? search
        : (meta?.chrome.search ?? "global") === "global" &&
          search !== "none" && (
            <button
              type="button"
              aria-label="打开命令面板"
              aria-keyshortcuts="Control+K Meta+K /"
              data-command-trigger
              onClick={onSearch}
              className="flex h-10 w-10 items-center justify-center gap-3 rounded-full text-ink-2 lg:w-[clamp(280px,32vw,520px)] lg:justify-start lg:bg-sunken lg:px-4"
            >
              <SearchIcon />
              <span className="hidden flex-1 text-left text-label lg:block">
                {mode === "photo" ? "搜索相册、画面与文字" : "搜索作品与标签"}
              </span>
              <span className="hidden lg:block">
                <Kbd keys={["Mod", "K"]} />
              </span>
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
            ...(localSearch
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
