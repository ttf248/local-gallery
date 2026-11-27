import { settingsRoute } from "../utils/path";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { useNavVisibility } from "../hooks/useNavVisibility";
import {useNavBadges,type NavBadges} from "./useNavBadges";
import {useActiveJobSummary} from "../features/tasks/useActiveJobSummary";
import {TaskIndicator} from "./TaskIndicator";
import {SidebarSearch} from "./SidebarSearch";
import {
  isNavEntryActive,
  navGroupsFor,
  MACHINE_GROUP,
  type NavEntry,
} from "../utils/navEntries";
import { currentTabRoute } from "../utils/pageTabs";

import { IconButton } from "../ui/IconButton";
import { Tooltip } from "../ui/Tooltip";
import { cx } from "../ui/cx";
import { AlertIcon, ChevronLeftIcon, ChevronRightIcon, HelpIcon } from "../ui/icons";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { AppearanceMenu } from "./AppearanceMenu";


function RailGroup({
  label,
  entries,
  collapsed,
  badges,showLabel,
}: {
  label: string;
  entries: NavEntry[];
  collapsed: boolean;
  badges: NavBadges;showLabel:boolean;
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
      {!collapsed && showLabel && (
        <p className="px-3 pt-4 pb-1 text-caption font-medium text-ink-3">{label}</p>
      )}
      {entries.map((entry) => {
        const selected = entry === active,
          Icon = selected ? (entry.ActiveIcon ?? entry.Icon) : entry.Icon,
          badge = badges[entry.key] ?? 0;
        const unit = entry.key === "comic.unread" ? "卷" : "组";
        const name = badge ? entry.label+" · "+badge+" "+unit : entry.label;
        const link = (
          <Link
            key={entry.key}
            to={tab?.startsWith(entry.to + "/") ? tab : entry.to}
            aria-label={name}
            aria-current={selected ? "page" : undefined}
            tabIndex={tabStop === entry ? 0 : -1}
            onFocus={() => setFocus(entry.key)}
            className={cx(
              "relative flex h-[34px] w-full items-center gap-3 rounded-md text-label",
              collapsed ? "justify-center" : "px-3",
              selected
                ? "bg-selected font-semibold text-ink before:absolute before:left-0 before:h-4 before:w-[3px] before:rounded-sm before:bg-accent"
                : "text-ink-2 hover:bg-hover hover:text-ink",
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
                <span aria-label={"还有 "+badge+" "+unit} className="text-caption tabular-nums text-ink-2">{badge>999?"999+":badge}</span>
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
export default function Sidebar({
  collapsed,
  onToggle,
  warningCount,onSearch,onHelp,
}: {
  collapsed: boolean;
  onToggle: () => void;
  warningCount: number;onSearch:()=>void;onHelp:()=>void;
}) {
  const { mode, setMode } = useAppMode(),
    { isVisible } = useNavVisibility();
  const badges=useNavBadges(mode), summary=useActiveJobSummary();
  return (
    <aside
      aria-label="主导航"
      data-collapsed={collapsed}
      data-testid="nav-rail"
      className={cx(
        "group/rail z-rail flex h-full shrink-0 flex-col gap-1 overflow-y-auto bg-app p-3 transition-[width] duration-slow",
        collapsed ? "w-rail-compact" : "w-rail",
      )}
    >
      <WorkspaceSwitcher mode={mode} onChange={setMode} compact={collapsed} />
      <SidebarSearch collapsed={collapsed} onSearch={onSearch}/>
      {navGroupsFor(mode).map((group,index) => (
        <RailGroup
          key={group.key}
          label={group.label}
          collapsed={collapsed}
          badges={badges} showLabel={index>0}
          entries={group.entries.filter(
            (entry) => !entry.mode || entry.locked || isVisible(entry.key),
          )}
        />
      ))}
      <div className="mt-auto pt-3">
        <TaskIndicator summary={summary} collapsed={collapsed}/>
        <RailGroup label={MACHINE_GROUP.label} entries={MACHINE_GROUP.entries} collapsed={collapsed} showLabel badges={badges}/>
      </div>
      <footer className="flex flex-wrap items-center gap-1">
        <AppearanceMenu />
        <IconButton label="快捷键帮助" onClick={onHelp}><HelpIcon size={16}/></IconButton>
        <IconButton label={collapsed?"展开侧边栏":"折叠侧边栏"} onClick={onToggle} aria-keyshortcuts="Control+B Meta+B">{collapsed?<ChevronRightIcon size={16}/>:<ChevronLeftIcon size={16}/>}</IconButton>
        {warningCount > 0 && (
          <Link
            to={settingsRoute("storage", { hash: "library-index" })}
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
