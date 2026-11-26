import { isValidElement, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { useSafeBack } from "../utils/navigation";
import { workbenchCopy } from "../utils/workbench";
import { IconButton } from "../ui/IconButton";
import { Menu } from "../ui/Menu";
import { Kbd } from "../ui/Kbd";
import { cx } from "../ui/cx";
import { MoreHorizontalIcon, ChevronLeftIcon, SearchIcon } from "../ui/icons";
import { usePageChromeState } from "./PageChrome";
import { documentTitleFor } from "./documentTitle";
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
    { pathname } = useLocation(),
    back = useSafeBack(backTo ?? "/");
  const localSearch = isValidElement(search);
  const routeTitle = documentTitleFor(pathname, mode),
    fullTitle =
      title && !routeTitle.startsWith(title)
        ? title + " · " + routeTitle
        : routeTitle;
  useEffect(() => {
    document.title = fullTitle;
  }, [fullTitle]);
  return (
    <header
      data-testid="top-bar"
      className={cx(
        "top-bar sticky top-0 z-topbar grid h-topbar shrink-0 items-center gap-2 border-b px-[var(--page-gutter)]",
        localSearch
          ? "grid-cols-[auto_minmax(0,1fr)_auto]"
          : "grid-cols-[1fr_auto_auto] lg:grid-cols-[1fr_auto_1fr]",
        scrolled ? "border-line" : "border-transparent",
      )}
    >
      <div className="flex min-w-0 items-center gap-1">
        {backTo && (
          <IconButton label="返回" onClick={back}>
            <ChevronLeftIcon />
          </IconButton>
        )}
        {localSearch ? (
          <h1 className="sr-only whitespace-nowrap text-title-3 sm:not-sr-only sm:mr-3">
            {title}
          </h1>
        ) : (
          titleCollapsed && (
            <span className="truncate text-title-3">
              {title || routeTitle.split(" · ")[0]}
            </span>
          )
        )}
      </div>
      {localSearch
        ? search
        : search !== "none" && (
            <button
              type="button"
              aria-label="打开命令面板"
              aria-keyshortcuts="Control+K Meta+K /"
              data-command-trigger
              onClick={onSearch}
              className="flex h-10 w-10 items-center justify-center gap-3 rounded-full text-fg-muted lg:w-[clamp(280px,32vw,520px)] lg:justify-start lg:bg-bg-subtle lg:px-4"
            >
              <SearchIcon />
              <span className="hidden flex-1 text-left text-callout lg:block">
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
