import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { useNavVisibility } from "../hooks/useNavVisibility";
import { useLibraryActivitySummary } from "../hooks/useLibrary";
import {
  isNavEntryActive,
  navGroupsFor,
  MACHINE_GROUP,
  type NavEntry,
} from "../utils/navEntries";
import { currentTabRoute } from "../utils/pageTabs";
import { Badge } from "../ui/Badge";
import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { cx } from "../ui/cx";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon } from "../ui/icons";
import WorkbenchSwitch from "./WorkbenchSwitch";
import { AppearanceMenu } from "./AppearanceMenu";
import { BrandMark } from "./BrandMark";

function RailGroup({
  label,
  entries,
  collapsed,
  count,
}: {
  label: string;
  entries: NavEntry[];
  collapsed: boolean;
  count: number;
}) {
  const { mode } = useAppMode(),
    { pathname } = useLocation(),
    [focus, setFocus] = useState("");
  const active = entries.find((entry) =>
    isNavEntryActive(entry, pathname, mode),
  );
  const tabStop =
    entries.find((entry) => entry.key === focus) ?? active ?? entries[0];
  const tab = currentTabRoute(pathname);
  if (!entries.length) return null;
  return (
    <nav
      aria-label={label}
      className="grid gap-1"
      onKeyDown={(event) => {
        const links = Array.from(event.currentTarget.querySelectorAll("a"));
        const at = links.indexOf(document.activeElement as HTMLAnchorElement);
        const next =
          event.key === "ArrowDown"
            ? (at + 1) % links.length
            : event.key === "ArrowUp"
              ? (at + links.length - 1) % links.length
              : event.key === "Home"
                ? 0
                : event.key === "End"
                  ? links.length - 1
                  : -1;
        if (next >= 0) {
          event.preventDefault();
          links[next].focus();
        }
      }}
    >
      {!collapsed && (
        <p className="px-3 pb-1 text-caption text-ink-3">{label}</p>
      )}
      {entries.map((entry) => {
        const selected = entry === active,
          Icon = selected ? (entry.ActiveIcon ?? entry.Icon) : entry.Icon,
          badge = entry.key === "comic.unread" ? count : 0;
        const name =
          collapsed && badge
            ? entry.label + " · " + badge + " 卷"
            : entry.label;
        const link = (
          <Link
            key={entry.key}
            to={tab?.startsWith(entry.to + "/") ? tab : entry.to}
            aria-label={name}
            aria-current={selected ? "page" : undefined}
            tabIndex={tabStop === entry ? 0 : -1}
            onFocus={() => setFocus(entry.key)}
            className={cx(
              "relative flex h-10 w-full items-center gap-3 rounded-md text-label",
              collapsed ? "justify-center" : "px-3",
              selected
                ? "bg-raised font-semibold text-ink shadow-1"
                : "text-ink-2 hover:bg-sunken hover:text-ink",
            )}
          >
            <Icon size={20} />
            {!collapsed && (
              <span className="min-w-0 flex-1 truncate">{entry.label}</span>
            )}
            {badge > 0 &&
              (collapsed ? (
                <span className="absolute right-1 top-1 size-1.5 rounded-full bg-accent" />
              ) : (
                <Badge aria-label={"还有 " + badge + " 卷"}>{badge}</Badge>
              ))}
          </Link>
        );
        return collapsed ? (
          <Tooltip
            key={entry.key}
            content={name}
            side="right"
            className="w-full"
          >
            {link}
          </Tooltip>
        ) : (
          link
        );
      })}
    </nav>
  );
}
export default function NavRail({
  collapsed,
  onToggle,
  warningCount,
}: {
  collapsed: boolean;
  onToggle: () => void;
  warningCount: number;
}) {
  const { mode, setMode } = useAppMode(),
    { isVisible } = useNavVisibility();
  const count = useLibraryActivitySummary().data?.summary.unreadCount ?? 0;
  return (
    <aside
      aria-label="主导航"
      data-collapsed={collapsed}
      data-testid="nav-rail"
      className={cx(
        "group/rail z-rail flex h-full shrink-0 flex-col gap-6 overflow-y-auto bg-app px-3 pb-4 transition-[width] duration-slow",
        collapsed ? "w-rail-compact" : "w-rail",
      )}
    >
      <div>
        <div className="relative flex h-16 items-center justify-between gap-2 px-1">
          <div className="flex items-center gap-2">
            <BrandMark />
            {!collapsed && (
              <span className="whitespace-nowrap text-label font-semibold">
                Local Gallery
              </span>
            )}
          </div>
          <div
            className={cx(
              "opacity-0 group-focus-within/rail:opacity-100 group-hover/rail:opacity-100",
              collapsed && "absolute inset-x-0 flex justify-center bg-app",
            )}
          >
            <IconButton
              label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
              size="sm"
              onClick={onToggle}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </div>
        </div>
        <WorkbenchSwitch mode={mode} onChange={setMode} compact={collapsed} />
      </div>
      {[...navGroupsFor(mode), MACHINE_GROUP].map((group) => (
        <RailGroup
          key={group.key}
          label={group.label}
          collapsed={collapsed}
          count={count}
          entries={group.entries.filter(
            (entry) => !entry.mode || entry.locked || isVisible(entry.key),
          )}
        />
      ))}
      <footer className="mt-auto flex flex-wrap items-center gap-2">
        <AppearanceMenu />
        {warningCount > 0 && (
          <Link
            to="/settings/data"
            className="inline-flex min-h-10 items-center gap-1 text-warning"
            aria-label={"扫描告警，共 " + warningCount + " 条"}
          >
            <AlertIcon />
            {warningCount}
          </Link>
        )}
      </footer>
    </aside>
  );
}
