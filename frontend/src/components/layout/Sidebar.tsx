import { Link, useLocation } from "react-router-dom";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ShuffleIcon,
  SearchIcon,
  AlertIcon,
  CloseIcon,
  HelpIcon,
  PeopleIcon,
  RefreshIcon,
} from "../common/Icon";
import { useUIStore } from "../../store/uiStore";
import { useLibraryActivitySummary } from "../../hooks/useLibrary";
import { useAppMode } from "../../hooks/useAppMode";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/useMediaQuery";
import { useNavVisibility } from "../../hooks/useNavVisibility";
import { homeRoute, libraryRoute, unreadRoute } from "../../utils/path";
import {
  MACHINE_GROUP,
  navGroupsFor,
  type NavEntry,
  type NavGroup,
} from "../../utils/navEntries";
import { albumCountUnit, workbenchCopy } from "../../utils/workbench";
import { currentTabRoute, tabLabelFor } from "../../utils/pageTabs";
import ModeSwitch from "./ModeSwitch";
import ThemeSwitcher from "../common/ThemeSwitcher";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
  onCloseMobile: () => void;
  onShuffle: () => void;
  shufflePending: boolean;
  onRefresh: () => void;
  warningCount: number;
}

const Sidebar = forwardRef<HTMLElement, Props>(function Sidebar(
  {
    collapsed: collapsedProp,
    onToggle,
    mobileOpen = false,
    onCloseMobile,
    onShuffle,
    shufflePending,
    onRefresh,
    warningCount,
  },
  ref,
) {
  const location = useLocation();
  const openCommand = useUIStore((s) => s.setCommandPaletteOpen);
  const faceBoxes = useUIStore((s) => s.showPersonFaceBoxes);
  const setFaceBoxes = useUIStore((s) => s.setShowPersonFaceBoxes);
  const personDetail = /^\/photo\/people\/[^/]+\/?$/.test(location.pathname);
  const { mode, setMode } = useAppMode();
  const copy = workbenchCopy(mode);
  // 侧栏入口可按需收起（设置页的「导航」分区）：被收起的项不在侧栏占位，
  // 页面本身照样能通过别的链接到达 —— 收起的只是入口，不是功能。
  const { isVisible } = useNavVisibility();
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
  // 折叠态（72px 的窄栏）只属于宽屏：窄屏侧栏是抽屉，宽度不由折叠决定。
  // 若把宽屏折叠过的状态带进抽屉，抽屉会既没有品牌名又没有展开按钮。
  const collapsed = isWide && collapsedProp;
  // 未读只属于漫画工作台：照片侧栏没有未读入口，也就没有它的徽标。
  const unreadCount =
    useLibraryActivitySummary().data?.summary.unreadCount ?? 0;
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!mobileOpen) return;
    navRef.current?.querySelector<HTMLElement>("a, button")?.focus();
  }, [mobileOpen]);

  // 侧栏的分组：当前工作台的内容组 + 整理组。
  const groups = useMemo(() => {
    const visible = navGroupsFor(mode).map((group) => ({
      ...group,
      entries: group.entries.filter(
        (entry) => entry.locked || isVisible(entry.key),
      ),
    }));
    return visible.filter((group) => group.entries.length > 0);
  }, [mode, isVisible]);

  // 两个模式的路径互为前缀（/photo 与 /photo/library），用 startsWith
  // 会让「首页」和「图库」同时亮起来。首页是精确匹配；相册详情虽不在
  // 书架/图库的 URL 下，也属于同一结构入口。
  const isEntryActive = (entry: NavEntry) => {
    if (entry.to === homeRoute(mode)) return location.pathname === entry.to;
    if (entry.to === libraryRoute(mode)) {
      return (
        location.pathname.startsWith(entry.to) ||
        location.pathname.startsWith(`${homeRoute(mode)}/albums/`)
      );
    }
    return location.pathname.startsWith(entry.to);
  };

  // 当前所在页签：设置页与任务中心把分区放在页内的 tab 条上，
  // 侧栏不再挂二级菜单 —— 只在条目右边挂一枚当前页签名，
  // 让侧栏仍然能回答「我现在在这一页的哪一段」。
  const currentTabLabel = tabLabelFor(location.pathname);
  // 已经站在这一页时，入口指向当前页签：再点一次自己的入口不该把页签
  // 打回缺省那个。
  const tabRouteHere = currentTabRoute(location.pathname);

  const renderGroup = (
    group: NavGroup,
    badgeFor: (entry: NavEntry) => number,
  ) => {
    return (
      <div className="mt-3 first:mt-0">
        {/* 折叠态不挂分组名：72px 的栏里「照片」两个字会竖着叠成两行，
            像渲染事故而不是标题。折叠后每个入口都有图标与提示，够了。 */}
        {!collapsed && (
          <div className="px-4 pb-1 flex items-center gap-2">
            <span className="text-meta transition-colors text-rail-muted">
              {group.label}
            </span>
          </div>
        )}
        {group.entries.map((entry) => {
          const isActive = isEntryActive(entry);
          const badge = badgeFor(entry);
          // 当前页签名只挂在这一页真正激活时：别的条目上写它会误导。
          const tabLabel = isActive ? currentTabLabel : undefined;
          const to =
            tabRouteHere && tabRouteHere.startsWith(`${entry.to}/`)
              ? tabRouteHere
              : entry.to;
          return (
            <div key={entry.key} className="flex items-center gap-2">
              <Link
                to={to}
                className={`nav-entry group ${collapsed ? "nav-entry--compact" : ""} ${isActive ? "is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                /* 挂着页签名时，链接的可访问名仍是入口本身（「设置」）——
                   页签是这一页的状态，不是入口的名字。 */
                aria-label={entry.label}
                title={`${entry.label}${tabLabel ? ` · ${tabLabel}` : ""}${badge > 0 ? ` · 还有 ${badge} ${albumCountUnit(mode)}` : ""}`}
              >
                <entry.Icon size={16} className="shrink-0" />
                {!collapsed && <span className="truncate">{entry.label}</span>}
                {/* 当前页签写在激活的这一格里面：它与入口名是一件事
                    （「设置 · 界面」），挂在格子外面会读成一个游离的词。
                    它做成一枚小标签：一格里的两件事各占一个位置。 */}
                {!collapsed && tabLabel && (
                  <span
                    data-testid="nav-tab-label"
                    className="shrink-0 rounded bg-rail-hover px-1.5 py-0.5 text-meta text-rail-fg/80"
                  >
                    {tabLabel}
                  </span>
                )}
                {!collapsed && badge > 0 && (
                  <span
                    className="inline-flex items-center justify-center min-w-[22px] h-[20px] px-1.5 rounded-full bg-rail-hover text-rail-fg text-meta font-semibold tabular-nums"
                    aria-label={`还有 ${badge} ${albumCountUnit(mode)}`}
                  >
                    {badge > 999 ? "999+" : badge}
                  </span>
                )}
                {collapsed && badge > 0 && (
                  <span
                    className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-rail-accent"
                    aria-hidden
                  />
                )}
              </Link>
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <aside
      ref={ref}
      aria-label="主导航"
      role={mobileOpen ? "dialog" : undefined}
      aria-modal={mobileOpen || undefined}
      data-collapsed={collapsed}
      className={`app-sidebar scroll-thin ${mobileOpen ? "app-sidebar--drawer" : "hidden lg:flex"}`}
    >
      <div className="sidebar-brand">
        {!collapsed && (
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="app-mark" aria-hidden>
              L
            </span>
            <span className="truncate font-semibold">Local Gallery</span>
          </div>
        )}
        {isWide ? (
          <button
            type="button"
            className="toolbar-icon"
            onClick={onToggle}
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            {collapsed ? (
              <ChevronRightIcon size={16} />
            ) : (
              <ChevronLeftIcon size={16} />
            )}
          </button>
        ) : (
          <button
            type="button"
            className="toolbar-icon"
            aria-label="关闭侧栏"
            onClick={onCloseMobile}
          >
            <CloseIcon size={17} />
          </button>
        )}
      </div>

      <div className="sidebar-controls">
        <ModeSwitch mode={mode} onChange={setMode} compact={collapsed} />
        <button
          type="button"
          className="sidebar-search"
          aria-label="打开命令面板"
          aria-keyshortcuts="Control+K Meta+K /"
          data-command-trigger
          onClick={() => openCommand(true)}
        >
          <SearchIcon size={16} className="shrink-0" />
          {!collapsed && (
            <>
              <span className="flex-1 truncate text-left">
                {mode === "comic" ? "搜索作品、标签…" : "搜索相册、画面…"}
              </span>
              <kbd className="kbd" aria-hidden>
                ⌘K
              </kbd>
            </>
          )}
        </button>
      </div>

      <nav ref={navRef} aria-label="工作台" className="sidebar-nav">
        {groups.map((group) =>
          renderGroup(group, (entry) =>
            entry.to === unreadRoute() ? unreadCount : 0,
          ),
        )}
      </nav>
      <nav aria-label="本机" className="sidebar-nav sidebar-nav--machine">
        {renderGroup(MACHINE_GROUP, () => 0)}
      </nav>

      <div className="sidebar-utilities">
        <button
          type="button"
          className="sidebar-shuffle ui-btn ui-btn--ghost"
          onClick={onShuffle}
          disabled={shufflePending}
          title={`${copy.randomLabel} (R)`}
          aria-label={copy.randomLabel}
        >
          <ShuffleIcon size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{copy.randomLabel}</span>}
        </button>
        <div className="sidebar-utility-icons">
          <ThemeSwitcher compact />
          <button
            type="button"
            className="toolbar-icon"
            title="快捷键帮助 (?)"
            aria-label="快捷键帮助"
            onClick={() => {
              if (mobileOpen) onCloseMobile();
              window.dispatchEvent(new Event("comic:open-help"));
            }}
          >
            <HelpIcon size={16} />
          </button>
          <button
            type="button"
            className="toolbar-icon"
            title="刷新缓存"
            aria-label="刷新缓存"
            onClick={onRefresh}
          >
            <RefreshIcon size={16} />
          </button>
          {personDetail && (
            <button
              type="button"
              className="toolbar-icon"
              aria-pressed={faceBoxes}
              title="显示当前人物的人脸框"
              aria-label="显示当前人物的人脸框"
              onClick={() => setFaceBoxes(!faceBoxes)}
            >
              <PeopleIcon size={16} />
            </button>
          )}
          {warningCount > 0 && (
            <Link
              to="/settings/data"
              className="sidebar-warning toolbar-icon"
              aria-label={`扫描告警，共 ${warningCount} 条`}
              title={`扫描告警 · ${warningCount}`}
            >
              <AlertIcon size={16} />
              <span className="ui-badge">
                {warningCount > 99 ? "99+" : warningCount}
              </span>
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
});

export default Sidebar;
