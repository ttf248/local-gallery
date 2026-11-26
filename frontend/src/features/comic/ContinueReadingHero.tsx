import {buttonStyles} from "../../ui/buttonStyles";
import { Button } from "../../ui/Button";
import { Menu } from "../../ui/Menu";
import { ScrollRow } from "../../ui/ScrollRow";
import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useFavorites } from "../../hooks/useFavorites";
import { decodeFavPath, recentsRoute, unreadRoute } from "../../utils/path";
import { readingPercent } from "../../utils/continueReading";
import { comicCopy } from "../../utils/workbench";
import { AlbumTile as AlbumCard } from "../library";
import type { CardData } from "../library";
import Cover from "./Cover";
import {
  ArrowRightLineIcon,
  CheckIcon,
  CloseIcon,
} from "../../ui/icons";

interface UnreadHeroProps {
  cards: CardData[];
  count: number;
  onShuffle: () => void;
  onMarkRead: (card: CardData) => void;
}

// 未读区只出现在漫画工作台：照片那边没有未读这回事。
export function UnreadHero({
  cards,
  count,
  onShuffle,
  onMarkRead,
}: UnreadHeroProps) {
  const { favorites } = useFavorites();
  const favoriteIds = useMemo(() => new Set(favorites), [favorites]);
  const copy = comicCopy();
  // 面板只摆四本预览，标题上写的却是未读的总数。差额写出来，
  // 两个数字才对得上 —— 否则读者会以为少渲染了两本。
  const shownCards = useMemo(() => cards.slice(0, 4), [cards]);
  const remaining = Math.max(0, count - shownCards.length);
  return (
    <section
      className="min-w-0"
      data-testid="unread-hero"
      aria-labelledby="unread-heading"
    >
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="min-w-0 flex-1">
          <p className="page-eyebrow flex items-center gap-2 text-primary text-caption font-semibold tracking-[0.02em] mb-2">{copy.unreadEyebrow}</p>
          {/* 标题后接一条细线：这一段的内容到这里为止 —— 与时间线上的
              月份标题同一套写法。 */}
          <div className="flex items-baseline gap-3">
            <h2 id="unread-heading" className="section-title font-display text-heading leading-[1.4] font-semibold text-ink tracking-[-0.01em]">
              {copy.unreadTitle}{" "}
              <span className="font-sans text-body font-normal text-ink-2 ml-2 tabular-nums">
                {count} {copy.unreadCountLabel}
              </span>
            </h2>
            <span className="section-rule [flex:1_1_32px] h-[1px] self-center bg-line" aria-hidden />
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Menu label="未读操作" trigger={<Button variant="ghost" aria-label="未读操作">⋯</Button>}
            items={[{id:"random",label:copy.unreadButton,onSelect:onShuffle}]}/>

          <Link
            to={unreadRoute()}
            className={buttonStyles({variant:"ghost",size:"sm"})}
            aria-label={`查看全部${copy.unreadTitle}相册`}
          >
            全部 <ArrowRightLineIcon size={14} />
          </Link>
        </div>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(min(160px,100%),1fr))] gap-4 2xl:grid-cols-[repeat(auto-fill,minmax(200px,1fr))]">
        {shownCards.map((card) => (
          <AlbumCard
            key={card.id}
            data={{
              ...card,
              isFavorite: favoriteIds.has(decodeFavPath(card.to)),
            }}
            showUnreadBadge={false}
            /* 竖版书封（2:3），与网格和整页的书架语言一致。
               早先用 4:3 横幅：右栏因此比左栏矮一大截，两块面板
               读起来像两个产品；竖版之后两栏高度自然接近。 */
            coverRatio="2/3"
            overlayAction={
              <button
                type="button"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onMarkRead(card);
                }}
                className="size-8 touch:size-10 rounded-full bg-black/65 text-white flex items-center justify-center opacity-100 pointer-fine:opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 transition-opacity"
                title={`将「${card.title}」${copy.markFinishedLabel}`}
                aria-label={`将${card.title}${copy.markFinishedLabel}`}
              >
                <CheckIcon size={13} />
              </button>
            }
          />
        ))}
      </div>
      {/* 还剩几本没摆出来。写法与「继续阅读」面板的「还有 N 卷在读」
          同一套：总数与摆出来的数必须能对上。 */}
      {remaining > 0 && (
        <p className="hero-panel__muted text-ink-2 text-caption self-end mt-4">
          还有 {remaining} {copy.collectionUnit}
          {copy.unreadCountVerb}
        </p>
      )}
    </section>
  );
}

interface ContinueHeroProps {
  cards: CardData[];
  onContinue: (card: CardData) => void;
  onRemove: (card: CardData) => void;
  onClearAll: () => void;
}

// 继续阅读区只出现在漫画工作台：照片那边不记录阅读位置。
export function ContinueReadingHero({
  cards,
  onContinue,
  onRemove,
  onClearAll,
}: ContinueHeroProps) {
  const featured = cards[0];
  if (!featured) return null;
  const rest = cards.slice(1, 4);
  const copy = comicCopy();
  // 所属作品：卷名只写「第1卷」时，主角这一栏要说得清是哪一部。
  const series =
    featured.parentName &&
    featured.parentName !== (featured.displayTitle ?? featured.title)
      ? featured.parentName
      : undefined;
  return (
    <section
      className="min-w-0"
      data-testid="continue-hero"
      aria-labelledby="continue-heading"
    >
      <div className="flex items-center gap-3 flex-wrap">
        <h2 id="continue-heading" className="section-title font-display text-heading leading-[1.4] font-semibold text-ink tracking-[-0.01em]">
          {copy.continueTitle}
        </h2>
        <span className="hero-panel__muted text-ink-2 text-caption tabular-nums">
          {cards.length} {copy.unfinishedCountLabel}
        </span>
        <span className="section-rule [flex:1_1_32px] h-[1px] self-center bg-line" aria-hidden />
        <button
          type="button"
          onClick={onClearAll}
          className="hero-panel__muted text-ink-2 text-caption inline-flex items-center gap-1 min-h-8 touch:min-h-10 px-1 rounded"
          title={copy.markAllTitle}
        >
          <CloseIcon size={12} />
          清空
        </button>
      </div>
      <div className="relative isolate mt-4 grid min-w-0 grid-cols-[minmax(110px,.8fr)_minmax(0,1fr)] items-center gap-4 overflow-hidden rounded-xl bg-sunken p-4 sm:grid-cols-[clamp(160px,14vw,240px)_minmax(0,1fr)] sm:gap-8 sm:p-8">
        {featured.coverPath && <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 scale-125 blur-[48px] saturate-[1.2]"><Cover card={featured}/></div>}
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 bg-canvas/70"/>
        <StagePoster card={featured} onClick={() => onContinue(featured)} />
        <div className="min-w-0">
          {/* 作品名压在卷名上方：卷名只写「第1卷」时，这一卷属于哪部
              作品看不出来 —— 与书封、阅读器顶栏同一套写法。 */}
          {series && (
            <p className="hero-panel__muted text-ink-2 text-caption mt-1 text-caption tracking-[0.06em]">
              {series}
            </p>
          )}
          <h3 className="line-clamp-2 text-display">
            {featured.displayTitle ?? featured.title}
          </h3>
          <StageInfo
            card={featured}
            onContinue={() => onContinue(featured)}
            onRemove={() => onRemove(featured)}
          />
        </div>
      </div>
      {rest.length > 0 && (
        <section className="mt-8">
          <h3 className="mb-3 text-heading">在读</h3>
          <ScrollRow label="在读">
            {rest.map((card) => (
              <QueueItem
                key={card.id}
                card={card}
                onOpen={() => onContinue(card)}
                onRemove={() => onRemove(card)}
              />
            ))}
          </ScrollRow>
        </section>
      )}
      {cards.length > 4 && (
        <Link
          to={recentsRoute("comic")}
          className="hero-panel__muted text-ink-2 text-caption inline-flex items-center gap-2 self-end mt-4 min-h-8 touch:min-h-10"
        >
          还有 {cards.length - 4} {copy.collectionUnit}在读{" "}
          <ArrowRightLineIcon size={12} />
        </Link>
      )}
    </section>
  );
}

function StagePoster({
  card,
  onClick,
}: {
  card: CardData;
  onClick: () => void;
}) {
  const copy = comicCopy();
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${copy.continueTitle}「${card.title}」`}
      className="book-binding relative aspect-[2/3] w-full max-w-[240px] overflow-hidden rounded-[6px] shadow-cover"
    >
      <Cover card={card} large />
    </button>
  );
}

function StageInfo({
  card,
  onContinue,
  onRemove,
}: {
  card: CardData;
  onContinue: () => void;
  onRemove: () => void;
}) {
  const { index = 0, total = 0 } = card.progress ?? {};
  const percent = readingPercent({ index, total });
  const copy = comicCopy();
  return (
    <div className="mt-4">
      {/* 只报页码，不报百分比：「读到 1 / 5」说的是「翻到第几页」，
          「已读 0%」说的是「离结尾还有多远」—— 两个数并排时会互相
          打脸（读到第 1 页，已读却是 0%）。下面的进度条已经把百分比
          画出来了。 */}
      {/* 轨道与页码并排、缩到一截：横贯整列的空条读作一条分隔线，
          压在页码下面尤其像下划线。侧栏的续读卡也是这个写法。 */}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <p className="hero-panel__muted text-ink-2 text-caption tabular-nums">
          {copy.positionVerb} {index + 1} / {total}
        </p>
        {/* 空轨道不出现：刚翻开第一页时进度是 0%，一条全灰的横条
            压在页码右边读起来像下划线，而不是进度条。「还没翻开」
            由页码本身说清楚了。侧栏、列表行与悬停预览都是同一规则。 */}
        {percent > 0 && (
          <div
            /* 窄屏下轨道缩到一截：与页码并排才读得出「进度条 + 读到哪里」。
               独占一行时它就是一条分隔线。 */
            className="h-1 w-24 sm:w-40 shrink-0 rounded-full bg-primary/20 overflow-hidden"
            role="progressbar"
            aria-valuenow={percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`「${card.title}」${copy.continueTitle}进度`}
          >
            <div
              className="h-full bg-primary rounded-full transition-[width]"
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <Button size="lg" onClick={onContinue}>
          {copy.continueButton} <ArrowRightLineIcon size={14} />
        </Button>
        <button
          type="button"
          onClick={onRemove}
          className={buttonStyles({variant:"ghost",size:"sm"})}
          title={`将「${card.title}」${copy.markFinishedLabel}`}
          aria-label={`将${card.title}${copy.markFinishedLabel}`}
        >
          <CheckIcon size={13} />
          <span className="hidden sm:inline">{copy.markFinishedLabel}</span>
        </button>
      </div>
    </div>
  );
}

function QueueItem({
  card,
  onOpen,
  onRemove,
}: {
  card: CardData;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const copy = comicCopy();
  // 作品名补在卷名前面：队列里只写「第2卷」时，这一卷属于哪部作品
  // 看不出来 —— 与书封、列表行、侧栏同一套写法。
  const label = card.displayTitle ?? card.title;
  const series =
    card.parentName && card.parentName !== label ? card.parentName : undefined;
  const queueTitle = series ? `${series} · ${label}` : label;
  return (
    <div className="group relative w-[140px] shrink-0">
      <button
        type="button"
        className="block w-full text-left"
        onClick={onOpen}
        aria-label={`${copy.continueTitle}「${queueTitle}」`}
      >
        <span className="relative mb-2 block aspect-[2/3] overflow-hidden rounded-[6px] shadow-cover">
          <Cover card={card} />
          {card.progress && <span className="absolute bottom-0 left-0 h-[3px] bg-primary" style={{width:readingPercent(card.progress)+"%"}}/>}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-body font-medium">
            {queueTitle}
          </span>
          <span className="hero-panel__muted text-ink-2 text-caption block mt-1 tabular-nums">
            {copy.positionVerb} {(card.progress?.index ?? 0) + 1} /{" "}
            {card.progress?.total ?? 0}
          </span>
        </span>
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="hero-queue__remove max-sm:opacity-100 absolute right-[-5px] top-[-5px] grid place-items-center size-8 touch:size-10 rounded-full bg-canvas text-ink-2 opacity-0 group-hover:opacity-100 touch:opacity-100 focus-visible:opacity-100"
        title={`将「${card.title}」${copy.markFinishedLabel}`}
        aria-label={`将${card.title}${copy.markFinishedLabel}`}
      >
        <CheckIcon size={12} />
      </button>
    </div>
  );
}
