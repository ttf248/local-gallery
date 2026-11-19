import { Link, useLocation } from "react-router-dom";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ShuffleIcon,
} from "../common/Icon";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "../../store/uiStore";
import { useLibraryActivitySummary } from "../../hooks/useLibrary";
import { useAppMode } from "../../hooks/useAppMode";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/useMediaQuery";
import { useNavVisibility } from "../../hooks/useNavVisibility";
import { libraryApi } from "../../api/library";
import { albumRoute, homeRoute, unreadRoute } from "../../utils/path";
import {
  MACHINE_GROUP,
  navGroupsFor,
  type NavEntry,
  type NavGroup,
} from "../../utils/navEntries";
import { albumCountUnit, workbenchCopy } from "../../utils/workbench";
import { currentTabRoute, tabLabelFor } from "../../utils/pageTabs";
import ModeSwitch from "./ModeSwitch";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
}

/**
 * 侧栏。
 *
 * 层级是三段：**内容组**（这一侧的主导航）→ **整理组**（写操作，次级）→
 * **本机组**（任务中心与设置，属于机器不属于内容）。组内顺序即优先级，
 * 组间用一条细分隔线断开。
 *
 * 侧栏只做一件事：给出这一侧的去路。它不重复首页已经有的内容
 * （「接着看」只留在首页），也不承载全局动作 —— 随机翻阅是全局的，
 * 但它跟着当前工作台，因此留在这一侧栏的底部。
 *
 * 抽屉本体（<aside>）要拿到 ref：窄屏时它是模态抽屉，外壳要把焦点
 * 关在里面，并知道背景该 inert 谁。
 */
const Sidebar = forwardRef<HTMLElement, Props>(function Sidebar(
  { collapsed: collapsedProp, onToggle, mobileOpen = false },
  ref,
) {
  const navigate = useNavigate();
  const location = useLocation();
  const pushToast = useUIStore((s) => s.pushToast);
  const { mode, setMode } = useAppMode();
  const copy = workbenchCopy(mode);
  // 侧栏入口可按需收起（设置页的「导航」分区）：被收起的项不在侧栏占位，
  // 页面本身照样能通过别的链接到达 —— 收起的只是入口，不是功能。
  const { isVisible } = useNavVisibility();
  // 宽屏时模式切换在顶栏；窄屏侧栏就是抽屉，切模式留在抽屉里。
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

  const randomAlbum = useMutation({
    mutationFn: () => libraryApi.randomAlbums(mode),
    onSuccess: ({ albums }) => {
      const album = albums[0];
      if (album) navigate(albumRoute(mode, album.id));
    },
    onError: () => pushToast({ kind: "info", message: "没有可随机打开的相册" }),
  });

  const onShuffle = () => {
    if (!randomAlbum.isPending) randomAlbum.mutate();
  };

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

  // 选中态：路径完全相等才算命中。
  //
  // 两个模式的路径互为前缀（/photo 与 /photo/library），用 startsWith
  // 会让「首页」和「图库」同时亮起来。首页是精确匹配，其余条目靠前缀
  // 命中（/photo/albums/… 归属于图库）。
  const isEntryActive = (entry: NavEntry) =>
    entry.to === homeRoute(mode)
      ? location.pathname === entry.to
      : location.pathname.startsWith(entry.to);

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
      <div className="mt-5 first:mt-0">
        {/* 折叠态不挂分组名：72px 的栏里「照片」两个字会竖着叠成两行，
            像渲染事故而不是标题。折叠后每个入口都有图标与提示，够了。 */}
        {!collapsed && (
          <div className="px-4 pb-1 flex items-center gap-2">
            <span className="text-meta tracking-wide transition-colors text-rail-muted">
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
            <div
              key={entry.key}
              className="flex items-center gap-2"
            >
              <Link
                to={to}
                className={`nav-entry group ${collapsed ? "nav-entry--compact" : ""} ${isActive ? "is-active" : ""}`}
                aria-current={isActive ? "page" : undefined}
                title={`${entry.label}${tabLabel ? ` · ${tabLabel}` : ""}${badge > 0 ? ` · 还有 ${badge} ${albumCountUnit(mode)}` : ""}`}
              >
                <entry.Icon size={16} className="shrink-0" />
                {!collapsed && <span className="truncate">{entry.label}</span>}
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
              {/* 当前页签写在链接外面：它是这一页的状态，不是入口的名字。
                  链接的可访问名因此始终是「设置」「任务中心」。 */}
              {!collapsed && tabLabel && (
                <span
                  data-testid="nav-tab-label"
                  className="shrink-0 text-meta text-rail-muted"
                >
                  {tabLabel}
                </span>
              )}
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
      className={`app-sidebar scroll-thin flex flex-col shrink-0 overflow-y-auto transition-[width] duration-200 ease-out ${
        mobileOpen
          ? "fixed inset-y-0 left-0 z-50 w-[236px]"
          : `hidden lg:flex lg:static ${collapsed ? "w-[72px]" : "w-[236px]"}`
      }`}
    >
      <div
        className={`sidebar-brand relative flex items-center ${
          collapsed ? "justify-center px-2" : "justify-between"
        }`}
      >
        {
          !collapsed ? (
            <div className="flex items-center gap-2.5 min-w-0">
              <Logo />
              <div className="leading-none min-w-0 font-display font-semibold text-label truncate">
                Local Gallery
                <span className="block font-sans text-meta font-normal text-rail-muted mt-2">
                  本地影像档案
                </span>
              </div>
            </div>
          ) : null /* 折叠态下隐藏 logo,把整行让给展开按钮 */
        }
        {/* 折叠/展开按钮:
            折叠态是用户「想找回菜单」的关键时刻 —— 按钮必须一眼可见,
            所以用亮色填充的"药丸"按钮悬浮在右缘。
            侧栏是墨黑表面,应用级 --accent 在浅色主题下也是近黑,
            压上去看不见 —— 这里用侧栏专用的 --rail-accent。
            展开态时侧边栏本来就在视野里,按钮保持低调(灰图标 + hover 背景)
            即可,避免和品牌名挤。

            窄屏不渲染这一枚:那时侧栏是抽屉,宽度不由「折叠」决定 ——
            摆一个点不动的按钮,只会让人以为点完菜单会消失。 */}
        {isWide && (
          <button
            onClick={onToggle}
            aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
            title={collapsed ? "展开侧边栏 (Ctrl+B)" : "折叠侧边栏 (Ctrl+B)"}
            className={
              collapsed
                ? "group/toggle relative z-10 inline-flex items-center gap-0.5 h-7 pl-1.5 pr-2 whitespace-nowrap rounded-full bg-rail-accent text-rail-accent-fg shadow-md ring-1 ring-rail-accent/40 hover:ring-2 hover:ring-rail-accent/70 hover:scale-105 active:scale-95 transition-all"
                : "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-rail-muted hover:text-rail-hover hover:text-rail-fg transition-colors"
            }
          >
            {collapsed ? (
              <>
                <ChevronRightIcon
                  size={12}
                  className="transition-transform group-hover/toggle:translate-x-0.5"
                />
                {/* 折叠态只有 72px 宽：字压到 11.5px 并禁止换行，
                    否则「展开」会折成两行、被 60px 高的品牌栏裁掉一半。 */}
                <span className="text-badge font-semibold tracking-wide whitespace-nowrap">
                  展开
                </span>
              </>
            ) : (
              <ChevronLeftIcon size={14} />
            )}
          </button>
        )}
      </div>

      {/* 工作台模式切换：宽屏时它在顶栏左槽（与全局动作同层），
          窄屏顶栏放不下，改为留在这里 —— 侧栏在窄屏就是抽屉，
          打开抽屉即可切模式。两处互斥，DOM 里始终只有一份。 */}
      {!isWide && (
        <div className="px-4 pt-4">
          <ModeSwitch mode={mode} onChange={setMode} />
        </div>
      )}

      <nav ref={navRef} className="pt-5 pb-3 px-4 space-y-1.5">
        {groups.map((group) =>
          renderGroup(group, (entry) =>
            entry.to === unreadRoute() ? unreadCount : 0,
          ),
        )}
      </nav>

      {/* 本机组：任务中心与设置。它们不属于当前工作台，单独成组，
          排在浏览组之后 —— 看完照片再管机器上的事，顺序不能反。 */}
      <nav aria-label="本机" className="px-4 pb-3 space-y-1.5 border-t border-rail-line pt-4">
        {renderGroup(MACHINE_GROUP, () => 0)}
      </nav>

      {/* 弹性留白：把次级动作压到侧栏底部，侧栏中段即使没有内容
          也是"底部对齐"的布局，而不是内容浮在中间。
          上限 64px：不封顶的话，1440×900 的窗口里这一段会空出三百多
          像素，读起来像侧栏中间破了个洞，而不是一条分隔带。 */}
      <div className="flex-1 min-h-8 max-h-16" />

      {/* 次级动作：随机翻阅沉到底部，与导航之间用一条细分隔线断开。
          它是全局动作，但跟着当前工作台（照片这边开相册，漫画那边开卷）。 */}
      <div className="px-4 pb-3">
        <div className="h-px bg-rail-line mb-2" />
        <button
          onClick={onShuffle}
          disabled={randomAlbum.isPending}
          title={`${copy.randomLabel} (R)`}
          className={`w-full flex items-center gap-2.5 h-9 rounded-md text-body transition-colors ${
            collapsed ? "justify-center px-0" : "px-2.5"
          } text-rail-muted hover:bg-rail-hover hover:text-rail-fg disabled:opacity-50`}
        >
          <ShuffleIcon size={16} className="shrink-0" />
          {!collapsed && <span className="truncate">{copy.randomLabel}</span>}
        </button>
      </div>
    </aside>
  );
});

export default Sidebar;

/**
 * 品牌方块：纯几何 + 字形，用琥珀品牌色 —— 全局唯一的彩色标记。
 *
 * 字直接放在底板上（不再用一层绝对定位的兄弟节点盖上去）：
 * 兄弟节点的方式会让对比度检查工具读不到深色底板，把白字判成白底白字。
 */
function Logo() {
  return <div className="brand-mark">L</div>;
}
