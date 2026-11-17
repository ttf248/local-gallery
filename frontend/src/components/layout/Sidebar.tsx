import { Link, useLocation } from "react-router-dom";
import { forwardRef, useEffect, useMemo, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import {
  HomeIcon,
  SettingsIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ShuffleIcon,
  TasksIcon,
} from "../common/Icon";
import { useNavigate } from "react-router-dom";
import { useUIStore } from "../../store/uiStore";
import {
  useLibraryActivitySummary,
  useLibraryDashboard,
} from "../../hooks/useLibrary";
import { useHistoryCards } from "../../hooks/useHistory";
import { useAppMode } from "../../hooks/useAppMode";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/useMediaQuery";
import { useNavVisibility } from "../../hooks/useNavVisibility";
import { libraryApi } from "../../api/library";
import {
  albumRoute,
  homeRoute,
  recentsRoute,
  unreadRoute,
} from "../../utils/path";
import { navEntriesFor } from "../../utils/navEntries";
import RenditionImage from "../common/RenditionImage";
import { nodeSummaryToCard } from "../../utils/libraryCard";
import type { CardData } from "../album/AlbumGrid";
import { timeAgo } from "../../utils/date";
import {
  albumCountUnit,
  comicCopy,
  photoCopy,
  workbenchCopy,
} from "../../utils/workbench";
import {
  continueReadingTarget,
  readingPercent,
} from "../../utils/continueReading";
import { currentTabRoute, tabLabelFor } from "../../utils/pageTabs";
import ModeSwitch from "./ModeSwitch";

interface Props {
  collapsed: boolean;
  onToggle: () => void;
  mobileOpen?: boolean;
}

/** 侧栏里渲染一个入口所需的字段。 */
interface SidebarEntry {
  to: string;
  label: string;
  Icon: typeof HomeIcon;
}

// 本机组：任务中心与设置。它们不属于当前工作台，单独成组，
// 放在浏览组下面 —— 看完照片再管机器上的事，顺序不能反。
// 这两项不属于任何一侧，也不在设置页的开关范围内。
const SECONDARY_GROUP: SidebarEntry[] = [
  { to: "/tasks", label: "任务中心", Icon: TasksIcon },
  { to: "/settings", label: "设置", Icon: SettingsIcon },
];

// 侧栏：
// - 品牌区只留「图标 + Local Gallery」，不再叠一行 10px 副标题
// - 导航项统一 36px 高 / 13.5px 文字，选中态 = 亮一档的灰块 + 白字
// - 「随机」类操作沉到底部一组，与主导航分开，避免平铺抢注意力
// 抽屉本体（<aside>）要拿到 ref：窄屏时它是模态抽屉，外壳要把焦点
// 关在里面，并知道背景该 inert 谁。
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
  const photoGroup = useMemo(
    () =>
      navEntriesFor("photo").filter(
        (entry) => entry.locked || isVisible(entry.key),
      ),
    [isVisible],
  );
  const comicGroup = useMemo(
    () =>
      navEntriesFor("comic").filter(
        (entry) => entry.locked || isVisible(entry.key),
      ),
    [isVisible],
  );
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

  // 侧栏的「继续」区：漫画侧是在读进度，照片侧是上次打开过的那本。
  //
  // 两侧各有各的线索：漫画有页码与完成状态，照片只有访问历史。照片那边
  // 不显示进度条，也不出现「读完」字样 —— 照片没有读完这回事。
  const dashboard = useLibraryDashboard();
  const inProgress = useMemo(
    () =>
      mode === "comic" ? (dashboard.data?.dashboard.inProgress ?? []) : [],
    [dashboard.data, mode],
  );
  // 照片侧：最近看过的相册（访问历史里按当前侧收敛的那部分）。
  const resumeCards = useHistoryCards(mode, mode === "photo").cards;
  const resumeEntries = useMemo(() => {
    if (mode === "comic") {
      return inProgress.map((item) => ({
        ...nodeSummaryToCard(item.album),
        progress: { index: item.pageIndex, total: item.pageCount },
      }));
    }
    return resumeCards;
  }, [mode, inProgress, resumeCards]);
  const resumeFirst = resumeEntries[0] ?? null;
  const resumeTitle =
    mode === "comic" ? comicCopy().continueTitle : photoCopy().resumeTitle;
  const resumeCountLabel =
    mode === "comic"
      ? comicCopy().unfinishedCountLabel
      : photoCopy().resumeCountLabel;
  // 侧栏的计数单位跟着这一侧走：漫画说「卷还没读完」，
  // 照片说「本相册」。

  // 选中态：比侧栏亮一档的灰块 + 白字。
  // 侧栏是墨黑表面，选中态靠明度差而不是色相来区分，
  // 整条导航才不会被第二个颜色带跑。
  const navItemClass = (isActive: boolean) =>
    `nav-entry group ${collapsed ? "nav-entry--compact" : ""} ${isActive ? "is-active" : ""}`;

  // 当前所在页签：设置页与任务中心把分区放在页内的 tab 条上，
  // 侧栏不再挂二级菜单 —— 只在条目右边挂一枚当前页签名，
  // 让侧栏仍然能回答「我现在在这一页的哪一段」。
  const currentTabLabel = tabLabelFor(location.pathname);
  // 已经站在这一页时，入口指向当前页签：再点一次自己的入口不该把页签
  // 打回缺省那个。
  const tabRouteHere = currentTabRoute(location.pathname);

  // 选中态：路径完全相等才算命中。
  //
  // 两个模式的路径互为前缀（/photo 与 /photo/recents），用 startsWith
  // 会让「照片库」和「最近浏览」同时亮起来。首页是精确匹配，
  // 其余条目靠前缀命中（/photo/albums/… 归属于相册入口）。
  const isEntryActive = (entry: SidebarEntry) =>
    entry.to === homeRoute(mode)
      ? location.pathname === entry.to
      : location.pathname.startsWith(entry.to);

  const renderGroup = (
    title: string,
    group: SidebarEntry[],
    badgeFor: (entry: SidebarEntry) => number,
  ) => {
    return (
      <div className="mt-5 first:mt-0">
        {/* 折叠态不挂分组名：72px 的栏里「照片」两个字会竖着叠成两行，
            像渲染事故而不是标题。折叠后每个入口都有图标与提示，够了。 */}
        {!collapsed && (
          <div className="px-4 pb-1 flex items-center gap-2">
            <span className="text-meta tracking-wide transition-colors text-rail-fg">
              {title}
            </span>
          </div>
        )}
        {group.map((entry) => {
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
              key={`${entry.to}-${entry.label}`}
              className="flex items-center gap-2"
            >
              <Link
                to={to}
                className={`${navItemClass(isActive)} flex-1`}
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
                : "shrink-0 inline-flex items-center justify-center w-7 h-7 rounded-md text-rail-muted hover:text-rail-fg hover:bg-rail-hover transition-colors"
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
        {mode === "comic"
          ? renderGroup("漫画", comicGroup, (entry) =>
              entry.to === unreadRoute() ? unreadCount : 0,
            )
          : renderGroup("照片", photoGroup, () => 0)}
      </nav>

      {/* 「继续」区：紧跟浏览导航，填掉侧栏中段的空白。
          漫画侧是"正在翻的那本"，照片侧是"上次打开的那本"。
          两侧的措辞与线索各自成套，不共用一套词。

          这里只留当前这一本：完整列表由首页的首屏专区与「最近浏览 /
          最近阅读」页承担。侧栏再挂一份，既重复又把侧栏中段塞满。

          设置页与任务中心也摆这一块：它们的分区已经搬进页面内的 tab
          条，侧栏不再被二级菜单占满，而「接着看」是浏览的上下文，
          从任何页面都能跳回去接着翻。 */}
      {!collapsed && resumeFirst && (
        <div className="px-4 pt-1 pb-2 min-h-0">
          <div className="px-1 pb-2 flex items-baseline gap-2">
            <span className="text-meta text-rail-muted">{resumeTitle}</span>
            <span className="text-meta text-rail-muted tabular-nums">
              {resumeEntries.length} {resumeCountLabel}
            </span>
          </div>
          <ResumeMiniCard
            card={resumeFirst}
            onOpen={() => navigate(continueReadingTarget(resumeFirst))}
          />
          {resumeEntries.length > 1 && (
            <Link
              to={recentsRoute(mode)}
              className="mt-2 flex min-h-7 items-center gap-1 px-1 text-meta text-rail-muted hover:text-rail-fg transition-colors"
            >
              <span>
                还有 {resumeEntries.length - 1}{" "}
                {mode === "comic"
                  ? `${copy.collectionUnit}没${comicCopy().finishVerb}`
                  : "本相册"}
              </span>
              <ChevronRightIcon size={11} />
            </Link>
          )}
        </div>
      )}

      {/* 本机组：任务中心与设置。它们不属于当前工作台，单独成组，
          放在浏览组下面 —— 看完照片再管机器上的事，顺序不能反。 */}
      <nav aria-label="本机" className="px-4 pb-3 space-y-1.5">
        {renderGroup("本机", SECONDARY_GROUP, () => 0)}
      </nav>

      {/* 弹性留白：把次级入口压到侧栏底部，侧栏中段即使没有内容
          也是"底部对齐"的布局，而不是内容浮在中间。
          上限 64px：不封顶的话，1440×900 的窗口里这一段会空出三百多
          像素，读起来像侧栏中间破了个洞，而不是一条分隔带。 */}
      <div className="flex-1 min-h-8 max-h-16" />

      {/* 次级动作：随机翻题沉到底部，与导航之间用一条细分隔线断开 */}
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

        {/* 「随机未读」原本也在这里，与「未读」页 / 首页的"随机未读"重复,
            已移除 —— 同一动作只保留一个入口。 */}
      </div>
    </aside>
  );
});

export default Sidebar;

// 品牌方块：纯几何 + 字形，用琥珀品牌色 —— 全局唯一的彩色标记。
function Logo() {
  // 字母直接放在底板上（不再用一层绝对定位的兄弟节点盖上去）：
  // 兄弟节点的方式会让对比度检查工具读不到深色底板，把白字判成白底白字。
  return <div className="brand-mark">L</div>;
}

// 「接着看 / 继续读」迷你卡：侧栏常驻的那一条。
//
// 版式参照播放器的"正在播放"条：左侧封面缩略图 + 右侧标题与线索。
// 漫画侧点击回到上次看到的那一页，照片侧点击回到那本相册。
function ResumeMiniCard({
  card,
  onOpen,
}: {
  card: CardData;
  onOpen: () => void;
}) {
  const isComic = card.contentKind === "comic";
  const title = card.displayTitle ?? card.title;
  // 作品名补在卷名前面：侧栏这一小块只写「第1卷」，这一卷属于哪部
  // 作品看不出来 —— 与书封、列表行、阅读器顶栏同一套写法。
  const rowTitle =
    isComic && card.parentName && card.parentName !== title
      ? `${card.parentName} · ${title}`
      : title;
  const percent = readingPercent({
    index: card.progress?.index ?? 0,
    total: card.progress?.total ?? 0,
  });
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`${resumeLabel(card)}「${title}」`}
      className="mt-2 w-full rounded-lg bg-rail-hover hover:bg-rail-hover p-2 flex gap-2.5 items-center text-left transition-colors group/mini focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rail-accent"
    >
      <span
        className={`relative shrink-0 overflow-hidden bg-rail-hover block ${
          isComic ? "album-thumb--book w-9 h-12" : "rounded-md w-11 h-11"
        }`}
      >
        {card.coverPath ? (
          <RenditionImage
            fileId={card.coverPath}
            version={card.coverVersion}
            alt=""
            displayWidth={48}
            loading="lazy"
            className="w-full h-full object-cover object-[50%_30%]"
          />
        ) : null}
      </span>
      <span className="min-w-0 flex-1">
        {/* 标题直接起排：外层分组标题已经写了这一区的名字，
            这里再写一遍是重复信息。
            用 --fg-muted 而不是 --fg-subtle：卡片底色是 bg-rail-hover，
            fg-subtle 在这个底上只有 4.4:1（AA 要求 4.5:1）。 */}
        <span className="block text-body font-medium text-rail-fg truncate leading-tight group-hover/mini:text-rail-accent transition-colors">
          {rowTitle}
        </span>
        {/* 轨道与页码并排：轨道横贯整列时读作一条分隔线，
           压在书名下面尤其像下划线。缩到一截，跟页码并排，
           才读得出「进度条 + 读到哪里」。 */}
        <span className="mt-1.5 flex items-center gap-2 min-w-0">
          {/* 轨道只在真翻过几页时出现：一条永远空着的轨道在侧栏
              这一小块地方读起来就是一道多余的横线。「还没翻开」
              已经由标题行的未读标记承担。 */}
          {isComic && percent > 0 && (
            /* 轨道用半透明白：卡片底色本身就是 --rail-hover，
               轨道再用同一个色就等于没画，空的部分根本看不见。 */
            <span className="h-[3px] w-14 shrink-0 rounded-full bg-white/15 overflow-hidden">
              <span
                className="block h-full rounded-full bg-rail-accent"
                style={{ width: `${percent}%` }}
              />
            </span>
          )}
          <span className="text-meta text-rail-muted tabular-nums truncate">
            {resumeHint(card)}
          </span>
        </span>
      </span>
    </button>
  );
}

// 这一条属于哪一侧的动作名：漫画「继续阅读」，照片「接着看」。
function resumeLabel(card: CardData): string {
  return card.contentKind === "comic"
    ? comicCopy().continueTitle
    : photoCopy().resumeTitle;
}

// 这一条属于哪一侧的线索文案。
//
// 漫画给页码进度，照片给「上次浏览」的时间 —— 照片没有阅读位置，
// 说不出「读到第几张」。
function resumeHint(card: CardData): string {
  if (card.contentKind === "comic") {
    return `${comicCopy().positionVerb} ${(card.progress?.index ?? 0) + 1} / ${
      card.progress?.total ?? 0
    }`;
  }
  return card.lastSeenAt
    ? `${photoCopy().resumeLastSeenLabel} ${timeAgo(card.lastSeenAt)}`
    : photoCopy().resumeCountLabel;
}
