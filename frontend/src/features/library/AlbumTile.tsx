import { BookCover } from "./BookCover";
import AlbumListRow from "./AlbumListRow";
import { AlbumName, TypeChip, FavoriteButton } from "./AlbumCardParts";
import {
  useEffect,
  useRef,
  useState,
  type MouseEventHandler,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import { AlbumContextMenu } from "../album";
import { PropertiesDialog } from "../common";
import {
  FolderIcon,
  ReaderIcon,
  CheckIcon,
  ClockIcon,
  PlayFilledIcon,
} from "../../ui/icons";
import { HoverPreview } from "../common";
import { TranscodeStatusBadge } from "../common";
import { useUIStore, type ViewMode } from "../../store/uiStore";
import { timeAgo } from "../../utils/date";
import { formatDuration } from "../../utils/format";
import { favoriteResourceId } from "../../utils/path";
import { useToggleFavorite } from "../../hooks/useFavorites";
import { albumCountUnit, comicCopy } from "../../utils/workbench";
import { useCardState, openTargetWord } from "./useCardState";
import type { ContentKind } from "../../api/library";
import CardCover from "./CardCover";

export type CardVariant = "album" | "collection" | "smart";

export interface CardData {
  id: string;
  variant: CardVariant;
  // 原始名（来自后端 album.name）
  title: string;
  // 多根冲突时显示的"处理后"名；与 title 不同时说明带来源前缀
  displayTitle?: string;
  // 副标题（集合 / smart 通常为空；album 显示标签或路径 basename）
  subtitle?: string;
  /** variant='album' 时为图片数，其他变体时为子相册数。 */
  count: number;
  /** 视频数（仅 album 变体有意义）。0 或缺省按"无视频"渲染。 */
  videoCount?: number;
  /** 图片数（仅 album 变体有意义），与 videoCount 一起区分纯视频相册。 */
  imageCount?: number;
  /** 后端摘要中的修改时间，供列表的「最近改」排序使用。 */
  modTime?: string;
  /**
   * 业务日期（ISO）：拍摄时间 > 文件夹名日期 > 修改时间。
   * 「按拍摄时间」排序用它，缺省时退回 modTime —— 与后端「最近加入」
   * 是同一口径，不然首页专区与列表排序会对不上。
   */
  date?: string;
  coverPath: string;
  /** 集合 / 智能视图的代表封面，按顺序最多展示四张；为空时回退到 coverPath。 */
  covers?: string[];
  /**
   * 封面文件的内容版本号，与 coverPath / covers 一一对应。
   * 前端把它拼进封面 URL，服务端据此回 immutable，重复打开页面时
   * 封面一次网络请求都不发。
   */
  coverVersion?: string;
  coverVersions?: string[];
  /**
   * 封面源类型："image" / "video" / 不传（不传时由 coverPath 扩展名推断）。
   * 视频封面由前端浏览器抽帧 → 上传后才会显示首帧静态图（见 useVideoCover）。
   */
  coverKind?: "image" | "video";
  /**
   * 当 cover 是视频时，可附带总时长（秒）显示在角标。
   * 由调用方在用 <video> 探测后填入；非必填，缺省时角标只显示 ▶。
   */
  durationSec?: number;
  /**
   * 这份内容的规范地址（相册页 / 作品页）。
   *
   * 收藏、属性、复制链接、在文件管理器里打开都以它为准 —— 那些动作
   * 说的是「这一个东西」，地址得是它自己的。
   */
  to: string;
  /**
   * 卡片点击时实际去的地方。
   *
   * 缺省就是 `to`。相册页给集合卡换了一个：集合在相册页里是目录，
   * 点它应该在原地往下走一层，而不是跳去作品页再跳回来。
   */
  linkTo?: string;
  isFavorite?: boolean;
  // 阅读进度：index + total，用于显示百分比与定位条
  progress?: { index: number; total: number };
  // 上次阅读时间（ISO），用于悬停预览的「上次 X」展示
  lastSeenAt?: string | null;
  // 来源媒体根（多根扫描时填充）。前端用来显示 badge "来自 X"
  sourceRoot?: string;
  // 来源媒体根的 basename（直接给 UI 用）
  sourceName?: string;
  /**
   * 内容属性："photo"（照片）/ "comic"（漫画）。
   * 它继承自所属媒体目录，并决定相册用哪种交互打开。
   * 进度与「已读完」只在漫画属性下出现。
   */
  contentKind?: ContentKind;
  /** 所属系列（漫画侧按连载分组用）：相册直接上级集合的名字。 */
  parentName?: string;
}

interface Props {
  data: CardData;
  variant?: ViewMode;
  /** 显示「上次 X · 看到 Y/Z」行（仅 Recents 列表需要）。 */
  showLastSeen?: boolean;
  /** 列表容器统一持有菜单，独立卡片则在本地展示同一套操作。 */
  onContextMenu?: MouseEventHandler<HTMLDivElement>;
  /**
   * 封面右上角的额外操作（如「标记为已读」）。
   * 渲染在链接之外的浮层里，避免在 <a> 内嵌套按钮；仅网格视图支持。
   */
  overlayAction?: ReactNode;
  /**
   * 是否显示未读标记。在「未读」这类整页都是未读的列表里，
   * 每张卡都挂同一个标记只是噪音，直接关掉。
   */
  showUnreadBadge?: boolean;
  /**
   * 标题印在封面上（书封），而不是压在封面下面。
   *
   * 漫画工作台默认开启：书架上的每一本都该在封面上写着书名，
   * 一排封面才读得出「一排书」。首页首屏面板里的卡片是紧凑陈列，
   * 封面下方留一行标题更清楚，那里显式关掉。
   */
  titleOnCover?: boolean;
  /**
   * 封面画幅比例。
   * 默认 "4/3" 用于照片卡片；也支持 "2/3" 和 "16/9"。
   */
  coverRatio?: CoverRatio;
  /**
   * 计数行下面补一行说明（「那年今日」用它写命中的那一天）。
   *
   * 计数行是 nowrap 的：数量一长就把它挤到省略号后面。日期这种
   * 「这一张卡为什么在这儿」的信息得另起一行，才读得到。
   */
  note?: ReactNode;
  /**
   * 收藏星标常驻显示。
   *
   * 默认桌面端要 hover 才露出星标（界面退到背景）。但收藏页空态的
   * "从这里挑一个收藏"必须让星标一眼可见 —— 那条文案就是在教用户
   * 点星标，指着一个 hover 才出现的东西等于没说。
   */
  alwaysShowFavorite?: boolean;
  /**
   * 封面角上的徽章（最近浏览的时刻）。
   *
   * 压在封面左上角那一列：状态槽与它同列，两处信息不会互相盖住。
   * 徽章自己带底板，浅色封面上也读得清。
   */
  coverBadge?: ReactNode;
  /**
   * 藏起计数与来源，只留标题与时间。
   *
   * 「最近浏览」回答的是「我刚才在翻什么、什么时候翻的」：张数、视频
   * 数与目录类型是技术读数，摆在那里只会把这两个答案挤到边上。
   */
  hideMeta?: boolean;
}

export type CoverRatio = "2/3" | "16/9" | "4/3" | "1/1";

const COVER_RATIO_CLASS: Record<CoverRatio, string> = {
  "2/3": "aspect-[2/3]",
  "16/9": "aspect-video",
  "4/3": "aspect-[4/3]",
  "1/1": "aspect-square",
};

// 通用卡片：网格（统一 4:5 封面）/ 列表（横向缩略图 + 元数据）。
// 设计：
//  - 不画死板边框；hover 时给 cover 细微的明度变化 + 上浮
//  - 标题短截断 2 行；副标题只 1 行
//  - 阅读进度以底部细线 + 数字显示
//  - 智能集合有专属角标
//  - showLastSeen=true 时在标题下加一行「上次 X · 看到 Y/Z」
export default function AlbumTile({
  data,
  variant = "grid",
  showLastSeen,
  onContextMenu,
  overlayAction,
  showUnreadBadge = true,
  titleOnCover,
  coverRatio = "4/3",
  alwaysShowFavorite = false,
  note,
  coverBadge,
  hideMeta = false,
}: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [propertiesId, setPropertiesId] = useState<string | null>(null);
  const toggleFavorite = useToggleFavorite();
  const pushToast = useUIStore((s) => s.pushToast);
  const label = data.displayTitle ?? data.title;

  // 星标直接写收藏：失败时给出中文提示，不让失败静默。
  const onToggleFavorite = async () => {
    try {
      await toggleFavorite(favoriteResourceId(data));
      pushToast({
        kind: "success",
        message: data.isFavorite
          ? `已取消收藏「${label}」`
          : `已收藏「${label}」`,
        ttl: 1200,
      });
    } catch {
      pushToast({ kind: "error", message: "收藏失败，请稍后重试" });
    }
  };

  return (
    <div
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget
          .querySelector<HTMLAnchorElement>("a")
          ?.focus({ preventScroll: true });
        if (onContextMenu) onContextMenu(event);
        else setMenu({ x: event.clientX, y: event.clientY });
      }}
    >
      {variant === "list" ? (
        <AlbumListRow
          recentPhoto={hideMeta && showLastSeen}
          data={data}
          showLastSeen={showLastSeen}
          onToggleFavorite={onToggleFavorite}
          showUnreadBadge={showUnreadBadge}
        />
      ) : (
        <GridCard
          data={data}
          showLastSeen={showLastSeen}
          onToggleFavorite={onToggleFavorite}
          overlayAction={overlayAction}
          showUnreadBadge={showUnreadBadge}
          titleOnCover={titleOnCover}
          coverRatio={coverRatio}
          alwaysShowFavorite={alwaysShowFavorite}
          note={note}
          coverBadge={coverBadge}
          hideMeta={hideMeta}
        />
      )}
      {menu && (
        <AlbumContextMenu
          item={data}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onShowProperties={setPropertiesId}
        />
      )}
      {propertiesId && (
        <PropertiesDialog
          target={{ kind: "node", id: propertiesId }}
          onClose={() => setPropertiesId(null)}
        />
      )}
    </div>
  );
}

// 卡片底部"X 张 / Y 个视频 / X 张 · Y 个视频"渲染。
//
// 仅 album 变体按图/视频分别展示；集合/smart 走 count + 计数单位（语义是子相册数）。
//
// 计数单位跟着这一张卡自己的属性走：照片说「张」，漫画说「页」——
// 漫画里一张图就是「一页」，与阅读器的「第 N 页」说法一致。

function GridCard({
  data,
  showLastSeen,
  onToggleFavorite,
  overlayAction,
  showUnreadBadge,
  titleOnCover,
  coverRatio,
  alwaysShowFavorite,
  note,
  coverBadge,
  hideMeta,
}: {
  data: CardData;
  showLastSeen?: boolean;
  onToggleFavorite: () => void;
  overlayAction?: ReactNode;
  showUnreadBadge: boolean;
  titleOnCover?: boolean;
  coverRatio: CoverRatio;
  alwaysShowFavorite: boolean;
  note?: ReactNode;
  coverBadge?: ReactNode;
  hideMeta?: boolean;
}) {
  // 直接渲染 <img loading="lazy">：浏览器原生懒加载比我们自写的 IO 简单且更可靠
  // （自写 IO 在 React 18 StrictMode dev mount-twice + 卡片树整体重渲染时容易
  // 错过首次 intersect，导致大量卡片永远停在占位符上）。
  // 悬停预览状态
  const [previewOn, setPreviewOn] = useState(false);
  const [previewRect, setPreviewRect] = useState<DOMRect | null>(null);
  const previewTimer = useRef<number | null>(null);
  // 进度、是否读完、未读标记、计数与作品名：网格与列表共用一份推导。
  const card = useCardState(data, showUnreadBadge);
  const {
    progressPct,
    isFinished,
    isComicAlbum,
    cardCopy,
    unread,
    multiRoot,
    hasDuration,
    label,
  } = card;
  // 标题印在封面上：漫画工作台的默认形态。书架上的书在封面上写着
  // 书名，一排封面才读得出「一排书」；照片工作台是展陈墙，标题仍然
  // 压在封面下方（展品说明牌）。
  const showTitleOnCover = titleOnCover ?? data.contentKind === "comic";
  // 作品名印在书名上方：漫画侧的卷名只写「第1卷」，一屏里两本「第1卷」
  // 分属不同作品，光看封面分不出谁是谁。真实书封就是这么排的 ——
  // 作品名在上，卷名在下。
  const coverSeries = showTitleOnCover ? card.series : undefined;

  // 悬停预览：350ms 后弹出，移出卡片或预览延迟 150ms 关闭。
  // （延迟是为了让用户能从卡片顺利移到预览上，预览是 portal 元素，
  //   鼠标在 card→preview 的过渡中会先触发 card mouseleave。）
  const closeTimer = useRef<number | null>(null);
  const onEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.matchMedia("(pointer: coarse)").matches) return;
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    const target = e.currentTarget;
    previewTimer.current = window.setTimeout(() => {
      setPreviewRect(target.getBoundingClientRect());
      setPreviewOn(true);
    }, 350);
  };
  const onLeave = () => {
    if (previewTimer.current !== null) {
      window.clearTimeout(previewTimer.current);
      previewTimer.current = null;
    }
    // 延迟关闭：给用户时间移到预览上
    closeTimer.current = window.setTimeout(() => {
      setPreviewOn(false);
      closeTimer.current = null;
    }, 150);
  };

  // 触摸设备长按 500ms 打开相同位置的上下文菜单。
  //
  // 长按之后的那次抬手不能算作点击 —— 否则用户长按看了预览，松手却又
  // 被带进相册。因此长按成功时记下一个标记，链接的 onClick 见到它就
  // 取消这次跳转。
  const pressTimer = useRef<number | null>(null);
  const longPressedRef = useRef(false);
  const onPressStart = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    if (e.pointerType === "mouse") return;
    const target = e.currentTarget;
    const { clientX, clientY } = e;
    pressTimer.current = window.setTimeout(() => {
      pressTimer.current = null;
      longPressedRef.current = true;
      target.dispatchEvent(
        new MouseEvent("contextmenu", {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
        }),
      );
    }, 500);
  };
  const onPressEnd = () => {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  };
  // 卸载时清理 timer
  useEffect(() => {
    return () => {
      if (previewTimer.current !== null)
        window.clearTimeout(previewTimer.current);
      if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
      if (pressTimer.current !== null) window.clearTimeout(pressTimer.current);
    };
  }, []);

  return (
    <div
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={onPressStart}
      onPointerUp={onPressEnd}
      onPointerCancel={onPressEnd}
      onPointerLeave={onPressEnd}
      /* 右键菜单与悬停预览不同时出现：两者都浮在指针附近，
         叠在一起时菜单被预览的大图压住，两边都读不清。
         这个处理器先跑（事件向上冒泡），外层再开菜单。
         还没到点的预览定时器也要撤掉 —— 否则它在菜单打开之后
         才把预览放出来，菜单照样被压住。 */
      onContextMenu={() => {
        if (previewTimer.current !== null) {
          window.clearTimeout(previewTimer.current);
          previewTimer.current = null;
        }
        setPreviewOn(false);
      }}
      className="album-tile [html[data-mode=comic]_&]:p-0 [html[data-mode=comic]_&]:[border:none] [html[data-mode=comic]_&]:rounded-0 [html[data-mode=comic]_&]:bg-transparent [html[data-mode=comic]_&:hover]:shadow-none [html[data-mode=comic]_&:hover]:[transform:none] touch:[html[data-mode=comic]_&:active]:shadow-none touch:[html[data-mode=comic]_&:active]:[transform:none] relative group select-none"
      data-testid="album-card"
    >
      <Link
        to={data.linkTo ?? data.to}
        onClick={(e) => {
          // 长按刚唤起过预览：这一下抬手不是「打开相册」。
          if (longPressedRef.current) {
            e.preventDefault();
            longPressedRef.current = false;
            return;
          }
          longPressedRef.current = false;
        }}
        aria-label={`打开${openTargetWord(data)}“${data.displayTitle ?? data.title}”`}
        className="group block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
      >
        <div
          data-stacked={data.variant === "collection" || undefined}
          className={
            data.variant === "collection"
              ? "relative isolate mb-3 before:absolute before:inset-x-2 before:-bottom-1.5 before:-z-10 before:h-full before:rounded-lg before:bg-sunken-strong after:absolute after:inset-x-4 after:-bottom-3 after:-z-20 after:h-full after:rounded-lg after:bg-sunken motion-safe:before:transition-transform motion-safe:after:transition-transform motion-safe:group-hover:before:translate-y-px motion-safe:group-hover:after:translate-y-px"
              : "relative"
          }
        >
          <div
            className={`album-tile__cover rounded-lg relative z-10 ${COVER_RATIO_CLASS[coverRatio]} bg-sunken overflow-hidden${
              showTitleOnCover
                ? " album-tile__cover--book book-binding rounded-[6px] shadow-cover transition duration-base motion-safe:group-hover:-translate-y-1"
                : ""
            }`}
            data-testid="card-cover"
          >
            {/* 封面：相册用一张主封面，集合与文件夹用最多四张代表图拼出
              「里面有什么」。视频封面同样裁切填满：方形画幅里保留 16:9
              的完整画面会上下留出两条黑边，读起来像一只空信箱。 */}
            <CardCover data={data} />
            {data.variant === "smart" && (
              <span
                aria-hidden="true"
                className="absolute bottom-2 left-2 rounded-full bg-theater-scrim px-2 text-label text-white"
              >
                #
              </span>
            )}

            {/* 封面左上角：状态槽。阅读状态（未读 / 已读完）与视频转码角标
              都在这一列，堆叠显示，互不遮挡。

              「已读完」原先放在右下角，和未读点分处两个角 —— 扫读一张
              卡片时，状态散在两个方向，要分别去找。两者互斥（未读与
              已读完不会同时成立），所以放进同一列不冲突。
              深色蒙版材质压在任何封面上都读得清（原来的实心绿块在
              深色主题 / 浅色封面上都会糊掉）。 */}
            {isFinished && isComicAlbum && (
              <div className="absolute right-12 top-2">
                <ReadChip />
              </div>
            )}
            <div className="absolute top-2 left-2 flex flex-col items-start gap-1">
              {coverBadge}
              {data.coverKind === "video" && (
                <TranscodeStatusBadge
                  videoPath={data.coverPath ?? ""}
                  size="sm"
                />
              )}
              {unread && <UnreadDot label={cardCopy.unreadTitle} />}
            </div>

            {/* 底部暗化蒙版（hover 时让进度条与徽章更清晰） */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none" />

            {/* 书名压条：标题印在封面上。书封上本来就有书名，
              网格因此读成一排书，而不是「一堆图片 + 一堆说明」。
              宽幅封面（首屏面板里的横版海报）用紧凑压条：两行标题
              会把半张封面压成一块黑。 */}
            {showTitleOnCover && (
              <BookCover
                label={label}
                coverSeries={coverSeries}
                compact={coverRatio === "16/9"}
              />
            )}
            {/* 阅读进度：百分比放深色蒙版 chip，进度条压在封面底边的暗色条上。
              以前整块用一层渐变蒙版，白字在亮封面（照片里的白墙、白纸）上
              会直接糊掉 —— 蒙版越往上越透明，而文字正好在透明那一侧。

              照片相册不显示百分比：它是「翻到了第几张」，不是「读完了一本」，
              百分比读数会让人误以为在读漫画。照片卡片只保留底边那条进度条，
              位置数字挪到元信息行。 */}
            {isComicAlbum && progressPct !== null && progressPct > 0 && (
              <>
                {/* 百分比 chip 只在标题不在封面上时出现：封面上已经有
                  书名压条，再压一枚百分比 chip，两层深色蒙版叠在
                  封面下缘会互相干扰。书封形态把百分比放进封面
                  下方的说明行，与计数读在一起。 */}
                {!isFinished && !showTitleOnCover && (
                  <div className="absolute bottom-2 left-2 inline-flex items-center gap-1 rounded-md bg-black/65 ring-1 ring-white/20 px-1.5 h-5 text-caption font-medium text-white shadow-1">
                    <ReaderIcon size={11} className="shrink-0" />
                    <span className="tabular-nums">{progressPct}%</span>
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 h-[3px] z-10 bg-black/55">
                  <div
                    className="h-full bg-white/90"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </>
            )}
          </div>
        </div>
        <div className="album-tile__meta [html[data-mode=comic]_&]:[padding:9px_0_5px] [padding:12px_0_7px] max-sm:px-0 min-w-0">
          {/* 标题印在封面上时，这里不再重复标题：同一句话在一张卡上
              说两遍，封面的书名会被下面的说明读成回声。 */}
          {!showTitleOnCover && (
            <div className="album-tile__title truncate text-subheading text-ink [overflow-wrap:anywhere]">
              <AlbumName name={label} />
            </div>
          )}
          {/* meta 行：数量是辅助信息（13px），与标题差一档。
              一屏几十张卡，15px 的数字与 16px 的标题挨在一起时两边
              互相抬价，数量读起来比名字还响。
              「藏起计数」的那一页（最近浏览）不摆这一行：那一页问的是
              「翻的是什么、什么时候翻的」，其余是技术读数。 */}
          {hideMeta ? null : (
            <div
              className={`text-caption tabular-nums flex items-center gap-1.5 min-w-0 ${
                showTitleOnCover ? "text-ink-2" : "text-ink-2 mt-1"
              }`}
            >
              <TypeChip variant={data.variant} />
              {(() => {
                const media = card.counts;
                if (media) {
                  // album 变体：按图/视频分别展示。
                  // 不允许换行 —— 「384 张 · 19 个视 频」这种断字很难看，
                  // 空间不够时应该让后面的来源副标题截断。
                  return (
                    <span
                      title={media.title}
                      className="shrink-0 whitespace-nowrap"
                    >
                      {/* 数量是书封下方唯一剩下的信息，用正文色；其余
                        补充信息退回次要色，层级才分得开。 */}
                      {showTitleOnCover ? (
                        <>
                          <span className="text-ink font-medium">
                            {media.lead}
                          </span>
                          {media.rest && (
                            <span className="text-ink-2"> · {media.rest}</span>
                          )}
                        </>
                      ) : (
                        media.label
                      )}
                    </span>
                  );
                }
                // collection / smart 变体：count + 计数单位（语义是子相册数）。
                // 单位跟卡片所属的那一侧走：照片侧「本」，漫画侧「卷」。
                return (
                  <span className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                    {data.variant === "collection" && <FolderIcon size={16} />}
                    {data.count} {albumCountUnit(data.contentKind ?? "photo")}
                  </span>
                );
              })()}
              {/* 阅读进度：书封形态下百分比放进说明行，与计数读在一起，
                封面上的书名压条不再压一枚 chip。 */}
              {showTitleOnCover &&
                isComicAlbum &&
                progressPct !== null &&
                progressPct > 0 &&
                !isFinished && (
                  <>
                    <span className="text-ink-3">·</span>
                    <span className="text-primary font-medium shrink-0 whitespace-nowrap">
                      已读 {progressPct}%
                    </span>
                  </>
                )}
              {data.subtitle && (
                <>
                  <span className="text-ink-3">·</span>
                  <span className="truncate">{data.subtitle}</span>
                </>
              )}
            </div>
          )}
          {/* 多根来源 badge：与标签副标题独立，作为视觉小标签放在元数据行。
              单一媒体根下每张卡片都挂同一句来源是噪音，multiRoot 为 false 时隐藏。 */}
          {data.sourceName && multiRoot && !hideMeta && (
            <div className="text-caption text-ink-3 mt-0.5 inline-flex items-center gap-1">
              <FolderIcon size={16} className="shrink-0" />
              <span className="truncate">来自 {data.sourceName}</span>
            </div>
          )}
          {note && (
            <div className="text-caption text-ink-2 mt-0.5 truncate">
              {note}
            </div>
          )}
          {showLastSeen && data.lastSeenAt && (
            <div
              className="text-caption text-ink-3 mt-0.5 tabular-nums flex items-center gap-1.5 truncate"
              title={`上次 ${timeAgo(data.lastSeenAt)}`}
            >
              <ClockIcon size={10} className="shrink-0 text-ink-3" />
              {isComicAlbum &&
                data.progress &&
                data.progress.total > 0 &&
                data.progress.index >= 0 && (
                  <>
                    <span>
                      {cardCopy.positionVerb} {data.progress.index + 1} /{" "}
                      {data.progress.total}
                    </span>
                    <span className="text-ink-3">·</span>
                  </>
                )}
              <span>上次 {timeAgo(data.lastSeenAt)}</span>
            </div>
          )}
        </div>
      </Link>

      {/* 封面右上角浮层：收藏星标 + 视频角标。
          放在 Link 之外：在 <a> 里嵌按钮既不合法，也会让 Enter 冒泡触发跳转。

          星标压在最上面（真正的角落）：收藏页空态教用户「点封面右上角的
          星标」，视频相册的角标若占住角落，星标就被挤到角标下面，
          文案指的地方与实际能点到的地方对不上。 */}
      <div className="absolute top-2 right-2 z-10 flex flex-col items-end gap-1">
        <FavoriteButton
          fav={Boolean(data.isFavorite)}
          label={data.displayTitle ?? data.title}
          onToggle={onToggleFavorite}
          alwaysVisible={alwaysShowFavorite}
        />
        {overlayAction}
        {data.coverKind === "video" && (
          <div className="pointer-events-none inline-flex items-center gap-1 bg-raised/90 text-ink text-caption font-medium px-1.5 h-5 rounded shadow-1">
            <PlayFilledIcon size={9} className="text-primary" />
            {/* 时长未知时不要显示 "—"：一个破折号看起来像"读不出来 / 坏了"，
                而不是"视频时长暂不可用"。只留播放图标。 */}
            {hasDuration && <span>{formatDuration(data.durationSec)}</span>}
          </div>
        )}
      </div>

      {/* 悬停预览（仅相册/合集；触摸设备不启用） */}
      {previewOn && previewRect && data.variant !== "smart" && (
        <HoverPreview
          data={data}
          anchorRect={previewRect}
          lastSeenAt={data.lastSeenAt}
          onPointerEnter={() => {
            // 鼠标进入预览时取消正在等待的关闭 timer
            if (closeTimer.current !== null) {
              window.clearTimeout(closeTimer.current);
              closeTimer.current = null;
            }
          }}
          onPointerLeave={onLeave}
        />
      )}
    </div>
  );
}

// ============================================================================
// 卡片状态表达（grid / list 共用同一套语义）
//
// 状态全部来自真实数据，不推断、不虚构：
//   未读 —— 从未打开过（没有阅读进度记录）。
//   在读 —— 已经翻开但还没看完（封面底部的进度条 + 百分比）。
//   已读 —— 已经翻到最后一页（封面右下角的「✓ 已读」chip）。
//
// 表达方式刻意做得安静：
//   - 封面左上角只放"待办"信号：未读是一颗不带文字的白点。
//     一页 78 张卡片各挂一个「新」字块只是噪音，点本身已经够用。
//   - 已读放在封面右下角，和左上角的"待办"分区隔开。
//   - 集合 / 标签是"类型"而不是状态，类型信息放在元信息行。
//
// chip 一律用"深色蒙版 + 浅色前景"的材质：封面可能是纯白、纯黑或任意
// 颜色，只有蒙版材质才能保证文字在所有封面上都读得清（浅色 chip 压在
// 白色封面上会整个消失）。
// ============================================================================

/** 是否给这张卡挂未读标记。
 *  未读只对漫画相册有意义：照片工作台没有阅读进度，也没有未读这回事。
 *  集合 / 智能视图是聚合视图，同样谈不上"翻开过"。
 *  showUnreadBadge=false 用于"整页都是未读"的列表：那里每张卡挂同一个
 *  标记纯属重复，未读状态由服务端筛选保证。 */
/** 未读：一颗白点 + 深色描边。
 *  白心在深色封面上直接可见，深色描边在白色封面上把点的轮廓兜住 ——
 *  两边都不需要额外的底板，也不会像一个空心的圆环按钮。 */
function UnreadDot({ label }: { label: string }) {
  return (
    <span
      className="inline-flex h-2 w-2 items-center justify-center rounded-full bg-white ring-1 ring-black/50 shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
      title={label}
    >
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * 已读：蒙版 chip + 绿色对勾。
 *
 * 只有漫画相册会渲染它：阅读进度与「读完」都属于漫画，
 * 照片侧不显示完成态。
 */
function ReadChip() {
  const title = comicCopy().finishedLabel;
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-black/65 ring-1 ring-white/20 px-1.5 h-5 text-caption font-medium text-white shadow-1"
      title={title}
    >
      <CheckIcon size={10} className="text-theater-success" />
      <span>{title}</span>
    </span>
  );
}
