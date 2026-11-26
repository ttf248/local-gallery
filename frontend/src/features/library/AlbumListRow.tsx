import { Link } from "react-router-dom";
import type { CardData } from "./AlbumTile";
import { AlbumName, TypeChip, FavoriteButton } from "./AlbumCardParts";
import { useCardState, openTargetWord } from "./useCardState";
import CardCover from "./CardCover";
import {
  ClockIcon,
  FolderIcon,
  PlayFilledIcon,
  CheckIcon,
} from "../../ui/icons";
import { formatDuration } from "../../utils/format";
import { timeAgo } from "../../utils/date";
import { albumCountUnit } from "../../utils/workbench";
export default function AlbumListRow({
  data,
  showLastSeen,
  onToggleFavorite,
  showUnreadBadge,
}: {
  data: CardData;
  showLastSeen?: boolean;
  onToggleFavorite: () => void;
  showUnreadBadge: boolean;
}) {
  // 与 GridCard 一致：直接依赖 <img loading="lazy">，不重复自写 IO。
  // 进度、是否读完、未读标记、计数与作品名：与网格视图同源。
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
  // 漫画侧的列表行也是书架：缩略图是一本书（竖版 + 装订边）。
  const isComicContent = data.contentKind === "comic";
  // 作品名补在卷名前面：列表行写「第1卷」时，这一卷属于哪部作品
  // 看不出来 —— 与网格的书封、阅读器顶栏同一套写法。
  const rowTitle = card.series ? `${card.series} · ${label}` : label;

  return (
    // 列表行：缩略图压到 48px，行高固定 64px —— 一屏能扫到更多条目。
    // 行高必须固定：超宽屏下同一行的两张卡并排，行高不一致时下面那张
    // 卡片底部的分隔线会错位，看起来像两张卡片没对齐。
    // 行底加分隔线：整行铺满内容宽度时，没有分隔线的话标题与右侧数字之间
    // 会变成一大片空白，分隔线把它读成一张表。
    //
    // 字号：标题 14px，其余（类型 / 副标题 / 计数 / 进度）统一 13px ——
    // 与网格卡同一套层级。旧版列表用 12.5px，比网格卡低一档，两种视图
    // 放在一起看会像两套产品。
    <div className="relative group flex items-center border-b border-border-faint h-16">
      <Link
        to={data.linkTo ?? data.to}
        aria-label={`打开${openTargetWord(data)}“${data.displayTitle ?? data.title}”`}
        className="group flex flex-1 min-w-0 items-center gap-3.5 py-2 px-2.5 -mx-2.5 rounded-lg hover:bg-bg-subtle transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <div
          className={`relative h-12 shrink-0 overflow-hidden bg-bg-subtle ${
            isComicContent
              ? "album-thumb--book aspect-[2/3]"
              : /* 照片侧是方形：与网格里的方照同一套画幅，
                   竖版缩略图把照片裁成一条，读不出内容。 */
                "aspect-square rounded-tile"
          }`}
          data-testid="card-cover"
        >
          <CardCover data={data} loading="eager" compact />
          {data.coverKind === "video" && (
            <div className="pointer-events-none absolute top-1 right-1 inline-flex items-center gap-1 bg-bg-elevated/90 backdrop-blur text-fg text-badge font-medium px-1.5 h-5 rounded shadow-sm">
              <PlayFilledIcon size={9} className="text-accent" />
              {/* 时长未知时不显示数字：破折号看起来像"读不出来 / 坏了"。 */}
              {hasDuration && <span>{formatDuration(data.durationSec)}</span>}
            </div>
          )}
          {/* 状态角位（未读点）在列表视图改放到标题行：
              48px 的缩略图上塞不下标记，且标题行的文字更易扫读。 */}
        </div>

        {/* 溢出裁掉而不是压到右栏上：这一块可以缩到比内容更窄，
            但里面的进度读数不缩，窄列时它会直接盖住右侧的页数。 */}
        <div className="flex-1 min-w-0 overflow-hidden flex flex-col justify-center gap-1">
          <div className="text-label font-medium text-fg truncate flex items-center gap-1.5">
            <AlbumName name={rowTitle} />
            {unread && (
              <span
                className="inline-flex items-center gap-1 text-body font-medium text-fg-muted shrink-0"
                title={cardCopy.unreadTitle}
              >
                {/* 未读点用品牌色：它是「这一本还没翻开」的信号，
                    近黑的强调色在这里读起来只是一个句点。 */}
                <span
                  className="h-2 w-2 rounded-full bg-accent"
                  aria-hidden="true"
                />
                <span>{cardCopy.unreadTitle}</span>
              </span>
            )}
            {isFinished && isComicAlbum && (
              <span className="inline-flex items-center gap-0.5 text-body font-medium text-fg-muted shrink-0">
                <CheckIcon size={11} className="text-success" />
                <span>{cardCopy.finishedLabel}</span>
              </span>
            )}
          </div>
          {/* 第二行：副标题在左，进度轨道占中间的空位，位置在右。
              轨道只在真有进度时出现：一条永远空着的灰条压在短标题下面，
              读起来是标题的下划线，不是进度条。「还没翻开」这件事由
              标题行上的未读标记承担，不必再用一个空轨道说一遍。 */}
          <div className="text-body text-fg-subtle flex items-center gap-2 min-w-0 overflow-hidden">
            <TypeChip variant={data.variant} />
            {data.subtitle && (
              <span className="truncate max-w-[10rem] shrink">
                {data.subtitle}
              </span>
            )}
            {isComicAlbum && progressPct !== null && progressPct > 0 && (
              <>
                {/* 轨道给固定宽度，不占满整行：一条横贯半屏的空条
                    读起来是分隔线，不是进度条。 */}
                <span className="w-20 shrink-0 h-[3px] bg-bg-strong rounded-full overflow-hidden">
                  <span
                    className="block h-full bg-accent"
                    style={{
                      width: `${progressPct}%`,
                    }}
                  />
                </span>
                <span className="tabular-nums shrink-0 whitespace-nowrap">
                  {cardCopy.positionVerb} {data.progress!.index + 1} /{" "}
                  {data.progress!.total}
                </span>
              </>
            )}
            {data.sourceName && multiRoot && (
              <span className="text-fg-subtle inline-flex items-center gap-0.5 shrink-0">
                <FolderIcon size={11} className="shrink-0" />
                <span className="truncate">来自 {data.sourceName}</span>
              </span>
            )}
          </div>
        </div>

        {/* 右侧信息列：张数 / 最近查看固定右对齐，逐行对齐便于扫读。 */}
        <div className="shrink-0 w-24 sm:w-32 text-right flex flex-col items-end gap-1">
          <span className="text-body text-fg tabular-nums font-medium">
            {(() => {
              const media = card.counts;
              if (media) {
                return <span title={media.title}>{media.label}</span>;
              }
              return (
                <>
                  {data.count} {albumCountUnit(data.contentKind ?? "photo")}
                </>
              );
            })()}
          </span>
          {showLastSeen && data.lastSeenAt && (
            <span className="text-body text-fg-subtle inline-flex items-center gap-1">
              <ClockIcon size={11} className="shrink-0 text-fg-subtle" />
              <span>上次 {timeAgo(data.lastSeenAt)}</span>
            </span>
          )}
        </div>

        {(data.date || data.modTime) && (
          <time
            className="hidden w-24 shrink-0 text-right text-caption tabular-nums text-fg-subtle lg:block"
            dateTime={data.date || data.modTime}
          >
            {(data.date || data.modTime)?.slice(0, 10)}
          </time>
        )}
        <div className="text-fg-subtle hover-reveal group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity pr-1">
          <span className="text-body">›</span>
        </div>
      </Link>

      {/* 收藏星标：与链接平级，避免在 <a> 内嵌套按钮。 */}
      <FavoriteButton
        fav={Boolean(data.isFavorite)}
        label={data.displayTitle ?? data.title}
        onToggle={onToggleFavorite}
        className="shrink-0 mr-1"
      />
    </div>
  );
}
