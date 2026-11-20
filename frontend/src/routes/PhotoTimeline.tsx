import { lazy, Suspense, useCallback, useMemo } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { usePicks } from "../hooks/usePicks";
import { useUIStore } from "../store/uiStore";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import PhotoWall from "../components/wall/PhotoWall";
import EmptyState from "../components/common/EmptyState";
import ContextMenu from "../components/album/ContextMenu";
import { useWallViewer } from "../hooks/useWallViewer";
import { useContextMenu } from "../hooks/useContextMenu";
import TimelineToolbar from "../components/timeline/TimelineToolbar";
import TimelineGroupHeader from "../components/timeline/TimelineGroupHeader";
import OnThisDayStrip from "../components/timeline/OnThisDayStrip";
import {
  buildTimelineGroups,
  timelineGroupKey,
  timelineYearRange,
  type TimelineFilter,
} from "../utils/timeline";
import {
  albumRoute,
  homeRoute,
  libraryRoute,
  randomPhotosRoute,
} from "../utils/path";
import { FolderIcon, GridIcon, LibraryIcon } from "../components/common/Icon";
import { useLibraryManifest } from "../hooks/useLibrary";
import { useHistoryCards } from "../hooks/useHistory";
import type { LibraryFeedItem } from "../api/library";

const PhotoViewer = lazy(() => import("../components/wall/PhotoViewer"));

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
 */
export default function PhotoTimeline() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const density = usePhotoStore((s) => s.density);
  const picks = usePicks();
  const menu = useContextMenu<LibraryFeedItem>();

  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const libraryHasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const sideHasContent = (manifest?.statistics.photoAlbumCount ?? 0) > 0;
  const otherSideHasContent = (manifest?.statistics.comicAlbumCount ?? 0) > 0;
  const hasContent = sideHasContent;

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
      const [year, month] = key.split("-");
      const entry = feed.years.find((item) => item.year === Number(year));
      const found = entry?.months.find((item) => item.month === Number(month));
      return found?.count ?? 0;
    },
    [feed.years, feed.unknown],
  );

  const groupOf = useCallback(
    (item: LibraryFeedItem) => timelineGroupKey(item),
    [],
  );
  const groupHeader = useCallback(
    (key: string) => {
      const group = groups.find((entry) => entry.key === key);
      if (!group) return null;
      return (
        <TimelineGroupHeader group={{ ...group, count: groupCount(key) }} />
      );
    },
    [groups, groupCount],
  );

  const loadMore = useCallback(() => {
    void feed.fetchNextPage({ cancelRefetch: false });
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
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border-faint bg-bg">
        <div className="page-shell">
          <div className="album-bar">
            <div className="min-w-0 flex-1">
              <p className="page-eyebrow">照片</p>
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 className="album-bar__title truncate">按时间浏览</h1>
                <div className="album-bar__meta tabular-nums">
                  <span>
                    <span className="text-fg font-medium">{feed.total}</span> 张
                  </span>
                  {range ? (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span>{range}</span>
                    </>
                  ) : null}
                  {feed.isFetchingNextPage ? (
                    <>
                      <span className="text-fg-subtle">·</span>
                      <span className="text-fg-subtle">正在加载下一批</span>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={libraryRoute("photo")}
                className="btn btn-sm btn-outline"
              >
                相册
              </Link>
              <Link to={randomPhotosRoute()} className="btn btn-sm btn-outline">
                随手看看
              </Link>
            </div>
          </div>
          {hasContent ? (
            <div className="pb-3 pt-2">
              <TimelineToolbar
                years={feed.years}
                filter={filter}
                dateSources={feed.dateSources}
                unknown={feed.unknown}
                onChange={applyFilter}
              />
            </div>
          ) : null}
        </div>
      </header>

      {/* 回忆与继续：一条窄窄的入口，不与时间线抢主视觉。 */}
      {hasContent ? (
        <div className="page-shell shrink-0 border-b border-border-faint py-2">
          <div className="flex flex-wrap items-center gap-3">
            <OnThisDayStrip enabled={hasContent} />
            {resume ? (
              <Link
                to={resume.to}
                className="chip"
                title="回到最近翻过的那本相册"
              >
                接着看 · {resume.title}
              </Link>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="page-shell min-h-0 flex-1 pb-2">
        {emptyState ??
          (feed.isError && items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-body text-fg-muted">
              时间线加载失败，请重试。
            </div>
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
            <div className="flex h-full items-center justify-center text-body text-fg-muted">
              正在按时间排列照片…
            </div>
          ) : (
            <PhotoWall
              items={items}
              total={feed.total}
              targetHeight={wallTargetHeight(density)}
              hasNextPage={feed.hasNextPage ?? false}
              isLoadingMore={feed.isFetchingNextPage}
              onLoadMore={loadMore}
              onOpen={(_item, index) => wall.open(index)}
              /* 跨相册的墙：照片要说出自己出自哪本相册。 */
              albumLabel={(item) => item.albumName}
              /* 按月份分段：每一段标题写清是几月、时间是怎么来的。 */
              groupOf={groupOf}
              groupHeader={groupHeader}
              /* 整库级别的墙不铺占位槽：跳到远处看到的是一屏灰格子，而且那些格子要把整库都取回来才填得上。 */
              showPlaceholders={false}
              isPicked={picks.isPicked}
              onTogglePick={(item) => togglePick(item.id)}
              scrollToIndex={wall.focusIndex}
              onContextMenu={menu.open}
            />
          ))}
      </div>

      {menu.menu && (
        <ContextMenu
          x={menu.menu.x}
          y={menu.menu.y}
          items={[
            {
              id: "open",
              label: "查看大图",
              icon: <GridIcon size={12} />,
            },
            {
              id: "album",
              label: "在相册中打开",
              icon: <FolderIcon size={12} />,
            },
          ]}
          onSelect={(id) => {
            const target = menu.menu!.item;
            menu.close();
            if (id === "open") {
              const index = items.findIndex((it) => it.id === target.id);
              if (index >= 0) wall.open(index);
              return;
            }
            if (id === "album") {
              navigate(albumRoute("photo", target.albumId));
            }
          }}
          onClose={menu.close}
        />
      )}

      {viewer && (
        <Suspense fallback={null}>
          <PhotoViewer {...viewer} />
        </Suspense>
      )}
    </div>
  );
}
