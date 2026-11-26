import {PageHeader} from "../shell/PageHeader";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useListFilters } from "../hooks/useListFilters";
import { useUIStore } from "../store/uiStore";
import { useUnreadAlbums } from "../hooks/useUnreadAlbums";
import { useGalleryContextSync } from "../hooks/useGalleryContextSync";
import AlbumGrid from "../features/library/AlbumGrid";
import AlbumGridSkeleton from "../features/library/AlbumGridSkeleton";
import { ListFilterBar } from "../features/common/ListFilterBar";
import { EmptyState } from "../ui/EmptyState";
import {
  SparkleIcon,
  ShuffleIcon,
  FilterIcon,
} from "../ui/icons";
import type { GalleryContextEntry } from "../utils/galleryContext";
import { albumRoute, decodeFavPath, homeRoute } from "../utils/path";
import { compareDatesDesc } from "../utils/date";
import { compareByAdded } from "../utils/cardSorting";
import { useViewedSort } from "../hooks/useHistory";
import { comicCopy } from "../utils/workbench";

import { cardMatchesQuery } from "../utils/libraryCard";
import ViewedSortNotice from "../features/common/ViewedSortNotice";
import { SelectionToggle } from "../features/common/LibrarySelectionActions";

// 未读列表:跟 Recents / Favorites 同形,但源数据是「还没翻开过的相册」。
//
// 设计目标:
//  1. 一眼看到「还有 N 卷没看」,鼓励往下翻
//  2. 提供「随机一卷未读」快捷按钮,直接跳进第一本 — 配合用户「随便翻翻」
//     的核心场景
//  3. 全部看完时给一个明确「🎉 看完了」空态,而不是灰底 placeholder
export default function Unread() {
  const navigate = useNavigate();
  const viewMode = useUIStore((s) => s.viewMode);
  const {
    query,
    sortBy,
    setSortBy,
    minImageCount,
    setMinImageCount,
    reset: resetFilters,
  } = useListFilters();
  const pushToast = useUIStore((s) => s.pushToast);
  const { cards, count, total, isLoading } = useUnreadAlbums();
  const copy = comicCopy();
  const needsHistory = sortBy === "viewed" && cards.length > 0;
  const { query: historyQuery, compareViewed } = useViewedSort(needsHistory);

  const filtered = useMemo(() => {
    const list = cards
      .filter((it) => cardMatchesQuery(it, query))
      // 最小图数过滤(全局 filter)
      .filter((it) => {
        if (minImageCount <= 0) return true;
        return (it.count ?? 0) >= minImageCount;
      });
    switch (sortBy) {
      case "count":
        return list.sort((a, b) => b.count - a.count);
      case "added":
        return list.sort(
          (a, b) => compareByAdded(a, b) || a.title.localeCompare(b.title),
        );
      case "name":
        return list.sort((a, b) => a.title.localeCompare(b.title));
      case "recent":
        return list.sort(
          (a, b) =>
            compareDatesDesc(a.modTime, b.modTime) ||
            a.title.localeCompare(b.title),
        );
      case "viewed":
        return list.sort(
          (a, b) =>
            compareViewed(decodeFavPath(a.to), decodeFavPath(b.to)) ||
            a.title.localeCompare(b.title),
        );
      default:
        return list;
    }
  }, [cards, query, sortBy, minImageCount, compareViewed]);

  // 跨卷翻页(N / P)需要这个 list,跟 Recents/Favorites 一致
  const entries = useMemo<GalleryContextEntry[]>(
    () =>
      filtered.map((c) => ({
        key: c.to,
        to: c.to,
        name: c.title,
        parentName: c.parentName,
        imageCount: c.imageCount,
        videoCount: c.videoCount,
        contentKind: c.contentKind,
      })),
    [filtered],
  );
  useGalleryContextSync({ type: "unread" }, entries);

  function onShuffleUnread() {
    if (filtered.length === 0) {
      pushToast({ kind: "info", message: "没有未读相册可跳" });
      return;
    }
    const pick = filtered[Math.floor(Math.random() * filtered.length)];
    navigate(albumRoute("comic", decodeFavPath(pick.to)));
  }

  return (
    <div className="min-h-full">
      <div className="page-shell"><PageHeader
  title={copy.unreadPageTitle}
  actions={
          count > 0 && (
            <button
              onClick={onShuffleUnread}
              className="btn btn-sm btn-outline"
              title={`从${copy.unreadTitle}里随机挑一本`}
            >
              <ShuffleIcon size={11} />
              {copy.unreadButton}
            </button>
          )
        }
  meta={
          <p className="text-body text-ink-2 tabular-nums">
            {isLoading ? (
              // 加载中不要报「0 本」：那是"还没数出来"，不是"没有未读"。
              <span>正在统计未读相册…</span>
            ) : (
              <span>
                还有 <span className="text-ink">{count}</span>{" "}
                {copy.collectionUnit}
                {copy.unreadCountVerb}
                <span className="text-ink-3 mx-1.5">·</span>
                全库 <span className="text-ink">{total}</span>{" "}
                {copy.collectionUnit}
              </span>
            )}
          </p>
        }
/></div>

      {needsHistory && <ViewedSortNotice query={historyQuery} />}
      {count > 0 && (
        <ListFilterBar
          totalCount={filtered.length}
          sort={sortBy}
          onSortChange={setSortBy}
          minImageCount={minImageCount}
          onMinImageCountChange={setMinImageCount}
          trailing={<SelectionToggle />}
        />
      )}

      {isLoading && count === 0 ? (
        <AlbumGridSkeleton variant={viewMode} label="正在加载未读相册…" />
      ) : count === 0 ? (
        <EmptyState
          title={total === 0 ? "尚未加载图像库" : copy.unreadEmpty}
          description={
            total === 0
              ? "先去设置里指定一个媒体根目录，然后回来扫一遍就有了。"
              : copy.unreadEmptyHint
          }
          icon={<SparkleIcon size={20} />}
          action={
            total === 0 ? (
              <button
                onClick={() => navigate("/settings")}
                className="btn btn-primary"
              >
                去设置
              </button>
            ) : (
              <button
                onClick={() => navigate(homeRoute("comic"))}
                className="btn btn-outline"
              >
                回主页
              </button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="没有匹配的未读相册"
          description={query ? `没有匹配"${query}"的结果` : ""}
          icon={<FilterIcon size={20} />}
          action={
            <button
              onClick={resetFilters}
              className="btn btn-outline"
            >
              清除筛选
            </button>
          }
        />
      ) : (
        <section className="page-shell">
          <div className="pb-10">
            <AlbumGrid
              selectable
              items={filtered}
              variant={viewMode}
              showUnreadBadge={false}
            />
          </div>
        </section>
      )}
      <div className="h-12" />
    </div>
  );
}
