import { lazy, Suspense, useCallback, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { ApiError } from "../api/client";
import { usePicks } from "../hooks/usePicks";
import { useUIStore } from "../store/uiStore";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import PhotoWall from "../features/wall/PhotoWall";
import DensityControl from "../features/wall/DensityControl";
import EmptyState from "../features/common/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import { ContextMenu } from "../ui/ContextMenu";
import { useWallViewer } from "../hooks/useWallViewer";
import { useContextMenu } from "../hooks/useContextMenu";
import TimelineFilterPopover, {
  TimelineMediaControl,
} from "../features/timeline/TimelineFilterPopover";
import { Page } from "../shell/Page";
import { Sheet } from "../ui/Sheet";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { useAlbumSelection } from "../hooks/useAlbumSelection";
import { usePhotoCompare } from "../hooks/usePhotoCompare";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";
import PhotoSelectionBar from "../features/common/PhotoSelectionActions";
import { buildTimeRailMarks } from "../features/timeline/timeRailMarks";
import TimeRail from "../features/timeline/TimeRail";
import { PageHeader } from "../shell/PageHeader";
import MonthHeader from "../features/timeline/MonthHeader";
import MemoriesStrip from "../features/timeline/MemoriesStrip";
import {
  buildTimelineGroups,
  timelineGroupKey,
  timelineYearRange,
  type TimelineFilter,
} from "../utils/timeline";
import { albumRoute, homeRoute } from "../utils/path";
import { FolderIcon, GridIcon, LibraryIcon } from "../ui/icons";
import { useLibraryManifest } from "../hooks/useLibrary";
import { useHistoryCards } from "../hooks/useHistory";
import type { LibraryFeedItem } from "../api/library";

const PhotoCompare = lazy(() => import("../features/viewer/PhotoCompare"));
const PhotoViewer = lazy(() => import("../features/viewer/PhotoViewer"));

/**
 * 首屏读不出来时说清是哪一类失败。
 *
 * 断网、库变了、服务端出错，恢复办法各不相同：断网要检查连接，库变了
 * 要重新加载，服务端出错等一会儿再试。一句「加载失败」把这些都抹平了，
 * 用户只能反复点重试。
 */
function timelineErrorDescription(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) {
      return "媒体库刚刚变了，重新加载一次就好。";
    }
    if (error.status >= 500) {
      return "服务端读取时间线时出错了，稍后重试。";
    }
  }
  return "网络没有连上，检查连接后重试。";
}

/**
 * 照片工作台的首页：一条按时间下来的全库时间线。
 *
 * 这一页回答的问题是「我想看看照片」——不是「这个库由什么组成」。
 * 因此第一屏就是照片本身：按拍摄证据排下来的序列，往下滚就是往回走
 * 时间。想按目录翻的去相册，想按人物、地点、主题找的去发现。
 *
 * 三个位置说明它有多可信：
 *
 * - 每一段标题写着这段是几月，以及这段时间是拍出来的还是推断出来的；
 * - 「日期未知」的那一段单独摆着，不混进任何一年；
 * - 顶部的「年份 / 月份 / 照片还是视频」把筛选放在地址栏里，跳过去再
 *   退回来都还在原地。
 *
 * 时间来源的分布收在可展开的说明里：那是解释（哪些日期是猜出来的），
 * 不是这一屏的主内容，一直摊在筛选行下面会把注意力从照片上拽走。
 */
export default function PhotoTimeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const density = usePhotoStore((s) => s.density);
  const setDensity = usePhotoStore((s) => s.setDensity);
  const picks = usePicks();
  const menu = useContextMenu<LibraryFeedItem>();

  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const libraryHasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const sideHasContent = (manifest?.statistics.photoAlbumCount ?? 0) > 0;
  const otherSideHasContent = (manifest?.statistics.comicAlbumCount ?? 0) > 0;
  const hasContent = sideHasContent;

  const [visibleGroup, setVisibleGroup] = useState("");

  const filter = useMemo<TimelineFilter>(
    () => ({
      year: searchParams.get("year") ?? "",
      month: searchParams.get("month") ?? "",
      media: searchParams.get("media") ?? "",
    }),
    [searchParams],
  );

  // 月份只在年份之内有意义：年份不是数字（「日期未知」或空）时就不带月份。
  const isYearNumber = /^\d{4}$/.test(filter.year);
  const query = useMemo(
    () => ({
      kind: "photo" as const,
      scope: "timeline" as const,
      year: filter.year || undefined,
      month: isYearNumber && filter.month ? filter.month : undefined,
      media: filter.media || undefined,
    }),
    [filter, isYearNumber],
  );
  const feed = useMediaFeed(query);
  const items = feed.items;
  const selection = useAlbumSelection({
    albumId: "",
    albumName: "",
    items,
    scope: "timeline:" + searchParams.toString(),
  });
  const compare = usePhotoCompare<LibraryFeedItem>((item) => item.albumName);
  const [jumpOpen, setJumpOpen] = useState(false);
  const shortScreen = useMediaQuery("(max-height: 479px)");
  const marks = useMemo(
    () =>
      buildTimeRailMarks(feed.years, feed.unknown, {
        railHeight: shortScreen ? 479 : Infinity,
      }),
    [feed.years, feed.unknown, shortScreen],
  );

  // 筛选条件进地址栏：跳到某一年是一个能分享、能后退的地址。
  const applyFilter = useCallback(
    (next: TimelineFilter) => {
      const params = new URLSearchParams();
      if (next.year) params.set("year", next.year);
      if (next.month) params.set("month", next.month);
      if (next.media) params.set("media", next.media);
      setSearchParams(params);
    },
    [setSearchParams],
  );

  const groups = useMemo(() => buildTimelineGroups(items), [items]);

  // 每一段的数量取自年份索引，而不是已加载的那几页：
  // 墙上显示 128 张时，那一段本来就该有 128 张。
  const groupCount = useCallback(
    (key: string) => {
      if (key === "unknown") return feed.unknown;
      if (/^\d{4}$/.test(key)) {
        return feed.years.find((item) => item.year === Number(key))?.count ?? 0;
      }
      const [year, month] = key.split("-");
      const entry = feed.years.find((item) => item.year === Number(year));
      const found = entry?.months?.find((item) => item.month === Number(month));
      return found?.count ?? 0;
    },
    [feed.years, feed.unknown],
  );

  const groupOf = useCallback(
    (item: LibraryFeedItem) => timelineGroupKey(item),
    [],
  );
  const yearStarts = useMemo(
    () =>
      new Set(
        groups
          .filter(
            (group, i) =>
              group.year && i > 0 && group.year !== groups[i - 1].year,
          )
          .map((group) => group.key),
      ),
    [groups],
  );
  const groupHeader = useCallback(
    (key: string) => {
      const group = groups.find((entry) => entry.key === key);
      if (!group) return null;
      return (
        <MonthHeader
          showYear={!filter.year && yearStarts.has(key)}
          group={{ ...group, count: groupCount(key) || group.count }}
        />
      );
    },
    [groups, groupCount, filter.year, yearStarts],
  );

  const loadMore = useCallback(() => {
    feed.retryNextPage();
  }, [feed]);

  const togglePick = useCallback(
    (id: string) => {
      void picks
        .toggle(id)
        .catch(() => pushToast({ kind: "error", message: "精选操作失败" }));
    },
    [picks, pushToast],
  );

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items,
    total: feed.total,
    albumName: (item) => item.albumName,
    albumHref: (item) => albumRoute("photo", item.albumId),
    hasNextPage: feed.hasNextPage ?? false,
    isLoadingMore: feed.isFetchingNextPage,
    loadMoreError: feed.isFetchNextPageError,
    onLoadMore: loadMore,
    isPicked: picks.isPicked,
    onTogglePick: (item) => togglePick(item.id),
  });
  const viewer = wall.viewer;

  // 「接着看」：最近翻过的那本相册，一枚 chip 摆在这里就够。
  const resume = useHistoryCards("photo", hasContent).cards[0];

  const range = timelineYearRange(feed.years);

  // 这一侧没有内容：给出与「库里有内容但这一侧没有」不一样的引导。
  //
  // 空态摆在内容区而不是整页：页头仍然说清这是哪一侧、看到的是什么，
  // 用户才知道自己只是没有内容，而不是走错了地方。
  const emptyState =
    !hasContent && !manifestQuery.isLoading ? (
      libraryHasContent ? (
        <EmptyState
          title="照片这边还没有内容"
          description={
            otherSideHasContent
              ? "媒体目录都被设成了另一种内容属性。可以在设置里改属性，或者先去漫画那边看看。"
              : "媒体目录的内容属性与这一侧对不上。可以在设置里改属性。"
          }
          icon={<LibraryIcon size={20} />}
          action={
            <div className="flex items-center gap-3">
              <Link to="/settings/server" className="btn btn-outline">
                去设置里改属性
              </Link>
              {otherSideHasContent && (
                <Link to={homeRoute("comic")} className="btn btn-primary">
                  去漫画库看看
                </Link>
              )}
            </div>
          }
        />
      ) : (
        <EmptyState
          title="欢迎使用本地画廊"
          description="首次使用请先设置媒体目录，再开始扫描。目录离线时可在设置中修复。"
          icon={<LibraryIcon size={20} />}
          action={
            <div className="flex items-center gap-3">
              <Link to="/settings/server" className="btn btn-outline">
                设置媒体目录
              </Link>
              <Link to="/settings/data" className="btn btn-primary">
                去设置
              </Link>
            </div>
          }
        />
      )
    ) : null;

  return (
    <Page
      variant="gallery"
      className="page-shell flex h-full min-h-0 flex-col overflow-x-clip"
    >
      <PageHeader
        title="全部照片"
        meta={
          <span data-testid="timeline-meta">
            {feed.total.toLocaleString("zh-CN")} 张{range ? ` · ${range}` : ""}
          </span>
        }
        actions={
          hasContent && (
            <>
              <div className="hidden md:block">
                <TimelineMediaControl filter={filter} onChange={applyFilter} />
              </div>
              <TimelineFilterPopover
                years={feed.years}
                filter={filter}
                dateSources={feed.dateSources}
                datePrecisions={feed.datePrecisions}
                unknown={feed.unknown}
                onChange={applyFilter}
              />
              <div className="hidden md:block">
                <DensityControl
                  value={density}
                  onChange={setDensity}
                  presentation="popover"
                />
              </div>
              {marks.length > 0 && (
                <button
                  type="button"
                  className="rounded-lg px-2 py-2 text-caption md:hidden"
                  onClick={() => setJumpOpen(true)}
                >
                  跳转
                </button>
              )}
            </>
          )
        }
        toolbar={
          Boolean(filter.year || filter.media) && (
            <div className="flex gap-1.5">
              {filter.year && (
                <button
                  type="button"
                  className="ui-chip"
                  onClick={() =>
                    applyFilter({ ...filter, year: "", month: "" })
                  }
                >
                  {filter.year === "unknown"
                    ? "日期未知"
                    : `${filter.year} 年${filter.month ? ` ${filter.month} 月` : ""}`}{" "}
                  <span aria-hidden>×</span>
                </button>
              )}
              {filter.media && (
                <button
                  type="button"
                  className="ui-chip"
                  onClick={() => applyFilter({ ...filter, media: "" })}
                >
                  {filter.media === "video" ? "视频" : "照片"}{" "}
                  <span aria-hidden>×</span>
                </button>
              )}
            </div>
          )
        }
      />

      {hasContent && !filter.year && !filter.month && !filter.media && (
        <MemoriesStrip resume={resume} />
      )}
      <Sheet
        label="跳转年份"
        side="bottom"
        open={jumpOpen}
        onClose={() => setJumpOpen(false)}
      >
        <h2 className="mb-4 text-title-3">跳转年份</h2>
        <div className="grid grid-cols-3 gap-2">
          {marks
            .filter((mark) => mark.level !== "month")
            .map((mark) => (
              <button
                type="button"
                className="rounded-lg bg-bg-subtle p-2"
                key={mark.key}
                onClick={() => {
                  applyFilter({ ...filter, year: mark.key, month: "" });
                  setJumpOpen(false);
                }}
              >
                {mark.label}
              </button>
            ))}
        </div>
      </Sheet>
      <div className="timeline-wall flex min-h-0 flex-1 flex-col pb-2">
        {/* 后续分页失败：已加载的照片仍然能翻，失败的是没取到的那一段。
            提示条说清影响范围，并给一个重试的手柄。 */}
        {feed.isFetchNextPageError ? (
          <div className="relative z-popover pb-2">
            <ErrorBanner
              kind="warning"
              onRetry={loadMore}
              retrying={feed.isFetchingNextPage}
            >
              {feed.cursorInvalidated
                ? "媒体库刚刚变了，这一页的位置已经失效。重新加载会从头开始。"
                : "后续照片加载失败，已加载的照片仍可浏览。"}
            </ErrorBanner>
          </div>
        ) : null}
        {emptyState ??
          (feed.isError && items.length === 0 ? (
            <EmptyState
              title="时间线加载失败"
              description={timelineErrorDescription(feed.error)}
              action={
                <button
                  type="button"
                  className="btn btn-outline"
                  onClick={() => void feed.refetch()}
                  disabled={feed.isFetching}
                >
                  重新加载
                </button>
              }
            />
          ) : items.length === 0 && !feed.isLoading ? (
            <EmptyState
              title="这一段没有照片"
              description="换一个年份或月份看看，或者回到整条时间线。"
              dense
              action={
                <button
                  className="btn btn-outline"
                  onClick={() =>
                    applyFilter({ year: "", month: "", media: "" })
                  }
                >
                  看整条时间线
                </button>
              }
            />
          ) : feed.isLoading ? (
            <div
              aria-label="正在按时间排列照片"
              role="status"
              className="overflow-hidden"
            >
              {[0, 1, 2].map((section) => (
                <div key={section} className="pt-8">
                  <div className="mb-3 h-4 w-28 animate-pulse rounded bg-bg-subtle" />
                  {[0, 1].map((row) => (
                    <div key={row} className="mb-1 flex h-32 gap-1">
                      {[3, 2, 4, 3].map((width, i) => (
                        <div
                          key={i}
                          style={{ flex: width + ((section + row + i) % 3) }}
                          className="animate-pulse rounded-tile bg-bg-subtle"
                        />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <PhotoWall
              key={searchParams.toString()}
              items={items}
              total={feed.total}
              targetHeight={wallTargetHeight(density)}
              hasNextPage={feed.hasNextPage ?? false}
              isLoadingMore={feed.isFetchingNextPage}
              loadMoreError={feed.isFetchNextPageError}
              onLoadMore={loadMore}
              onOpen={(_item, index) => wall.open(index)}
              /* 跨相册的墙：照片要说出自己出自哪本相册。 */
              albumLabel={(item) => item.albumName}
              /* 按月份分段：每一段标题写清是几月、时间是怎么来的。 */
              groupOf={groupOf}
              groupHeader={groupHeader}
              onVisibleGroupChange={setVisibleGroup}
              /* 整库级别的墙不铺占位槽：跳到远处看到的是一屏灰格子，而且那些格子要把整库都取回来才填得上。 */
              showPlaceholders={false}
              selecting={selection.active}
              isSelected={selection.isSelected}
              onToggleSelect={selection.toggle}
              isPicked={picks.isPicked}
              onTogglePick={(item) => togglePick(item.id)}
              scrollToIndex={wall.focusIndex}
              onContextMenu={menu.open}
            />
          ))}
        {!emptyState && (
          <TimeRail
            marks={marks}
            activeKey={visibleGroup || filter.year}
            onCommit={(mark) => {
              const [year, month] = mark.key.split("-");
              applyFilter({
                ...filter,
                year,
                month: month ? String(Number(month)) : "",
              });
            }}
          />
        )}
      </div>

      {selection.active && (
        <PhotoSelectionBar
          selected={selection.entries}
          pickedCount={selection.pickedCount}
          onAddPicks={selection.addToPicks}
          onRemovePicks={selection.removeFromPicks}
          onCompare={compare.compareSelected}
          onExit={() => usePhotoSelectionStore.getState().clear()}
          busy={selection.busy}
        />
      )}
      {menu.menu && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          items={[
            {
              id: "open",
              label: "查看大图",
              icon: <GridIcon size={14} />,
              onSelect: () => {
                const index = items.findIndex(
                  (item) => item.id === menu.menu?.item.id,
                );
                if (index >= 0) wall.open(index);
              },
            },
            {
              id: "album",
              label: "在相册中打开",
              icon: <FolderIcon size={14} />,
              onSelect: () => {
                if (menu.menu)
                  navigate(albumRoute("photo", menu.menu.item.albumId));
              },
            },
            {
              id: "pick",
              label: picks.isPicked(menu.menu.item.id)
                ? "移出精选"
                : "加入精选",
              onSelect: () => {
                if (menu.menu) togglePick(menu.menu.item.id);
              },
            },
          ]}
          onClose={menu.close}
        />
      )}

      {viewer && (
        <Suspense fallback={null}>
          <PhotoViewer
            {...viewer}
            compareOpen={Boolean(compare.pair)}
            comparePinned={compare.pin?.id === viewer.items[viewer.index]?.id}
            onToggleCompare={() => compare.togglePin(items[viewer.index])}
          />
        </Suspense>
      )}
      {compare.pair && (
        <Suspense fallback={null}>
          <PhotoCompare
            left={compare.pair[0]}
            right={compare.pair[1]}
            leftPicked={picks.isPicked(compare.pair[0].id)}
            rightPicked={picks.isPicked(compare.pair[1].id)}
            onClose={compare.close}
            onSwap={compare.swap}
          />
        </Suspense>
      )}
    </Page>
  );
}
