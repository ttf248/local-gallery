import { useEffect, useMemo, useRef, useState } from "react";
import type { ChinaTrip } from "../../api/aiJobs";
import { useChinaTripMedia } from "../../hooks/useChinaLocations";
import { usePickToggle } from "../../hooks/usePickToggle";
import { usePhotoStore, wallTargetHeight } from "../../store/photoStore";
import { PhotoViewer } from "../viewer";
import { useWallViewer } from "../../hooks/useWallViewer";
import { PhotoWall } from "../wall";
import { ChevronRightIcon } from "../../ui/icons";
import { ThumbImage } from "../common";
import TravelTripPreview from "./TravelTripPreview";
import type { MapRegion } from "../../utils/travelMap";

interface TravelTripsProps {
  /** 行程与停留，按时间倒序读。 */
  trips: ChinaTrip[];
  /** 当前选中的段。 */
  selectedTripId: string | null;
  /** 选中某一段。 */
  onSelect: (trip: ChinaTrip | null) => void;
  /** 归并粒度。取照片时必须带上，否则取到的不是这一段。 */
  granularity: string;
  /** 打开某个地点的详情页。 */
  onOpenPlace: (adcode: number) => void;
  /** 各地点的形状：预览里的轨迹图靠它画。 */
  regions: MapRegion[];
  /** 参照层：全国省界。 */
  backdrop?: MapRegion[];
}

/**
 * 卡片上最多摆几个地点。
 *
 * 一次出行能串十几个地方，全摆出来卡片就高得读不成一行。收起的时候只
 * 摆前几个，末尾报一句「还有 N 处」；展开时整条地点链都摆出来。
 */
const MAX_STOPS = 4;

/**
 * 浮层往下展开时至少要留出的高度。
 *
 * 浮层有一张地图加一张站点表，比卡片高得多。卡片靠下时往下展开会掉出
 * 视口 —— 那时候翻到卡片上方去。
 */
const PREVIEW_MIN_SPACE = 460;

/**
 * 行程目录：按时间倒序读的一段段行程。
 *
 * 每一段是一张卡片：日期与张数一行，地点链一行。两列并排 —— 一段行程
 * 本身只有一行高，一列排下来整页读起来是空的。
 *
 * 点开才就地展开照片 —— 一次读回几十段的全量照片既慢又没人看。
 *
 * 同时只展开一段：每段都能各自展开的话，整页长度不可控，几百段就是
 * 几万像素的滚动条。展开的那张卡片横跨两列，照片带与照片墙才有地方摆。
 */
export default function TravelTrips({
  trips,
  selectedTripId,
  onSelect,
  granularity,
  onOpenPlace,
  regions,
  backdrop,
}: TravelTripsProps) {
  const groups = useMemo(() => {
    // 倒序：最近的出行排在最前面。年份由行程的开始时间决定，所以排好
    // 行程，年份自然也是倒序。
    const sorted = [...trips].sort((a, b) =>
      a.startedAt < b.startedAt ? 1 : a.startedAt > b.startedAt ? -1 : 0,
    );
    const result: { year: string; trips: ChinaTrip[] }[] = [];
    for (const trip of sorted) {
      const year = trip.startedAt.slice(0, 4);
      const last = result[result.length - 1];
      if (last && last.year === year) last.trips.push(trip);
      else result.push({ year, trips: [trip] });
    }
    return result;
  }, [trips]);

  if (trips.length === 0) {
    return (
      <p className="py-12 text-center text-body text-ink-2">
        这段时间还没有拍出带位置的行程。
      </p>
    );
  }

  return (
    <div className="travel-trips mt-[22px]">
      {groups.map((group) => (
        <section key={group.year} className="travel-trips__group [.travel-trips\_\_group_+_&]:mt-[18px]">
          <h3 className="travel-trips__year sticky top-0 z-[5] py-1.5 font-display text-body font-medium text-ink-2 bg-canvas">{group.year}</h3>
          <ul className="travel-trips__list grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr] [&>li[data-selected=true]]:col-[1_/_-1]">
            {group.trips.map((trip) => (
              <li
                key={trip.id}
                data-selected={selectedTripId === trip.id ? "true" : undefined}
              >
                <TravelTripCard
                  trip={trip}
                  selected={selectedTripId === trip.id}
                  onSelect={() =>
                    onSelect(selectedTripId === trip.id ? null : trip)
                  }
                  granularity={granularity}
                  onOpenPlace={onOpenPlace}
                  regions={regions}
                  backdrop={backdrop}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

interface TravelTripCardProps {
  trip: ChinaTrip;
  selected: boolean;
  onSelect: () => void;
  granularity: string;
  onOpenPlace: (adcode: number) => void;
  regions: MapRegion[];
  backdrop?: MapRegion[];
}

/**
 * 一段行程。
 *
 * 收着的时候是一张卡片：日期与张数一行，地点链一行。展开后是这一段的
 * 照片：一条照片带，再往下是整段的照片墙。
 *
 * 悬停（或焦点落进来）时，底下浮出一张轨迹图：这一段去过的地方按次序
 * 连成一条带箭头的线，每一站标着序号。
 */
function TravelTripCard({
  trip,
  selected,
  onSelect,
  granularity,
  onOpenPlace,
  regions,
  backdrop,
}: TravelTripCardProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewAbove, setPreviewAbove] = useState(false);
  const cardRef = useRef<HTMLElement | null>(null);
  const density = usePhotoStore((state) => state.density);
  const picks = usePickToggle();

  // 浮层往下展开还是往上翻：卡片靠下时往下会掉出视口。
  const openPreview = () => {
    const element = cardRef.current;
    if (element) {
      const rect = element.getBoundingClientRect();
      const below = window.innerHeight - rect.bottom;
      setPreviewAbove(below < PREVIEW_MIN_SPACE && rect.top > below);
    }
    setPreviewOpen(true);
  };

  // 只有这一段被展开或被点开时才去取照片。
  //
  // 取照片不能带时间区间：段是按「粒度 + 间隔」切出来的，列表与照片
  // 端点必须用同一套口径，否则按下标取到的不是这一段。
  // 预览开着时这一段的媒体要留着：用户可能先看照片再取消选中这一段，
  // 媒体一撤，照片就没了。
  const [viewerHeld, setViewerHeld] = useState(false);
  const media = useChinaTripMedia(
    selected || viewerHeld ? trip.index : null,
    granularity,
  );
  const items = useMemo(
    () => media.data?.pages.flatMap((page) => page.items) ?? [],
    [media.data],
  );
  const total = media.data?.pages[0]?.total ?? items.length;

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items,
    total,
    albumName: (item) => item.albumName,
    hasNextPage: media.hasNextPage ?? false,
    isLoadingMore: media.isFetchingNextPage,
    loadMoreError: media.isFetchNextPageError,
    onLoadMore: () => void media.fetchNextPage({ cancelRefetch: false }),
    isPicked: picks.isPicked,
    onTogglePick: (item) => picks.toggle(item.id),
  });
  const viewer = wall.viewer;

  // 照片带是整段均匀取样的，可能落在第一页之外：还没取到就继续取下一页，
  // 否则点后半段的照片会毫无反应。
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = media;
  useEffect(() => {
    if (wall.openId === null || wall.index !== null) return;
    if (!hasNextPage || isFetchingNextPage) return;
    void fetchNextPage({ cancelRefetch: false });
  }, [
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    wall.openId,
    wall.index,
  ]);

  // 收起时只摆前几个地点；展开后整条链都摆出来。
  const stops = selected ? trip.stops : trip.stops.slice(0, MAX_STOPS);
  const hiddenStops = trip.stops.length - stops.length;

  return (
    <section
      className="travel-trip-card relative py-3 px-0"
      ref={cardRef}
      data-selected={selected ? "true" : undefined}
      aria-label={`${trip.startedAt} 至 ${trip.endedAt}`}
      onMouseEnter={openPreview}
      onMouseLeave={() => setPreviewOpen(false)}
      onFocus={openPreview}
      onBlur={(event) => {
        // 焦点还在这张卡里就别收：地点链上的按钮挨个 Tab 时预览要留着。
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setPreviewOpen(false);
        }
      }}
    >
      <div className="travel-trip-card__head flex items-baseline justify-between gap-2.5">
        <button
          type="button"
          onClick={onSelect}
          aria-pressed={selected}
          className="travel-trip-card__date [.travel-trip-card[data-selected=true]_&]:text-primary inline-flex items-baseline min-h-8 touch:min-h-10 rounded-sm font-mono text-body tabular-nums text-ink text-left hover:text-primary touch:active:text-primary"
          aria-label={`${trip.startedAt} 至 ${trip.endedAt}，${trip.dayCount} 天，${
            selected ? "收起这段的照片" : "看这段去了哪儿"
          }`}
        >
          <span className="travel-trip-card__range">
            {trip.startedAt}
            {trip.endedAt !== trip.startedAt ? ` – ${trip.endedAt.slice(5)}` : ""}
          </span>
        </button>

        <span className="travel-trip-card__meta inline-flex [flex:none] items-baseline gap-2.5 text-caption text-ink-2">
          <span
            className={
              trip.kind === "stay"
                ? "travel-trip-card__kind tracking-[0.08em] text-ink-2 travel-trip-card__kind--stay text-ink-3"
                : "travel-trip-card__kind tracking-[0.08em] text-ink-2"
            }
          >
            {trip.kind === "stay" ? "停留" : "行程"}
          </span>
          <span className="tabular-nums">{trip.dayCount} 天</span>
          <span className="tabular-nums">{trip.photoCount.toLocaleString()} 张</span>
        </span>
      </div>

      <div className="travel-trip-card__route flex flex-wrap items-center gap-y-1 gap-x-1.5 min-w-0 mt-1.5">
        {stops.map((stop, index) => (
          <span key={`${stop.adcode}-${stop.at}`} className="flex items-center gap-1">
            {index > 0 ? (
              <ChevronRightIcon size={12} className="travel-trip-card__arrow [flex:none] text-ink-2" />
            ) : null}
            <button
              type="button"
              onClick={() => onOpenPlace(stop.adcode)}
              className="travel-trip-card__stop inline-flex items-baseline gap-1.5 min-h-8 touch:min-h-10 py-0.5 px-[9px] rounded-tile bg-sunken text-caption text-ink hover:bg-sunken-strong hover:text-primary touch:active:bg-sunken-strong touch:active:text-primary"
              title={`${stop.name} · ${stop.photoCount} 张`}
            >
              {stop.name}
              <span className="travel-trip-card__stop-count text-ink-2 tabular-nums">
                {stop.photoCount.toLocaleString()}
              </span>
            </button>
          </span>
        ))}
        {hiddenStops > 0 ? (
          <span className="travel-trip-card__more text-caption text-ink-3">还有 {hiddenStops} 处</span>
        ) : null}
      </div>

      {/* 悬停时浮出来的轨迹图：这一段按次序走过哪些地方。 */}
      {previewOpen ? (
        <div
          className={
            previewAbove
              ? "travel-trip-card__preview absolute top-[calc(100%_+_6px)] left-0 z-30 w-[min(460px,100%)] [padding:12px_14px_14px] border border-line rounded-tile bg-raised [backdrop-filter:blur(16px)_saturate(1.4)] shadow-2 pointer-events-none sm:w-[460px] sm:[.travel-trips\\_\\_list>li:nth-child(even)_&]:right-0 sm:[.travel-trips\\_\\_list>li:nth-child(even)_&]:left-auto travel-trip-card__preview--above top-auto bottom-[calc(100%_+_6px)]"
              : "travel-trip-card__preview absolute top-[calc(100%_+_6px)] left-0 z-30 w-[min(460px,100%)] [padding:12px_14px_14px] border border-line rounded-tile bg-raised [backdrop-filter:blur(16px)_saturate(1.4)] shadow-2 pointer-events-none sm:w-[460px] sm:[.travel-trips\\_\\_list>li:nth-child(even)_&]:right-0 sm:[.travel-trips\\_\\_list>li:nth-child(even)_&]:left-auto"
          }
          role="group"
          aria-label="这一段的行程轨迹"
        >
          <TravelTripPreview
            trip={trip}
            regions={regions}
            backdrop={backdrop}
          />
        </div>
      ) : null}

      {selected ? (
        <>
          {trip.bandResourceIds.length > 0 ? (
            <div className="travel-trip-card__band flex gap-1 h-24 mt-2.5 overflow-x-auto [scrollbar-width:thin]">
              {trip.bandResourceIds.map((id) => (
                <button
                  key={id}
                  type="button"
                  className="travel-trip-card__photo [flex:1_1_0] min-w-[104px] overflow-hidden rounded-[6px] bg-media [&_img]:block [&_img]:w-full [&_img]:h-full [&_img]:object-cover [&_img]:transition [&_img]:duration-base [&:hover_img]:[transform:scale(1.03)] touch:[&:active_img]:[transform:scale(1.03)]"
                  onClick={() => {
                    setViewerHeld(true);
                    wall.openById(id);
                  }}
                  aria-label="看这一段的照片"
                >
                  <ThumbImage
                    fileId={id}
                    alt=""
                    displayWidth={240}
                    className="h-full w-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}

          <div className="travel-trip-card__grid mt-2.5 h-[min(62vh,620px)] overflow-hidden rounded-tile">
            {media.isError ? (
              <p className="py-8 text-center text-body text-ink-2">
                这一段的照片暂时读不出来。
              </p>
            ) : items.length === 0 && !media.isLoading ? (
              <p className="py-8 text-center text-body text-ink-2">
                这一段没有照片。
              </p>
            ) : (
              <PhotoWall
                items={items}
                total={total}
                targetHeight={wallTargetHeight(density)}
                hasNextPage={media.hasNextPage ?? false}
                isLoadingMore={media.isFetchingNextPage}
                onLoadMore={() => void media.fetchNextPage({ cancelRefetch: false })}
                onOpen={(_item, index) => {
                  setViewerHeld(true);
                  wall.open(index);
                }}
                albumLabel={(item) => item.albumName}
                isPicked={picks.isPicked}
                onTogglePick={(item) => picks.toggle(item.id)}
              />
            )}
          </div>
        </>
      ) : null}

      {viewer ? (
        <PhotoViewer
          {...viewer}
          onClose={() => {
            setViewerHeld(false);
            wall.close();
          }}
        />
      ) : null}
    </section>
  );
}
