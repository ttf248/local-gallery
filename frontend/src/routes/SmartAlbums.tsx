import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSmartAlbumDirectory } from "../hooks/useSmartAlbums";
import { useMediaQuery, ULTRAWIDE_LAYOUT_QUERY } from "../hooks/useMediaQuery";
import SmartAlbumWall from "../components/album/SmartAlbumWall";
import AlbumGridSkeleton from "../components/album/AlbumGridSkeleton";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import Segmented from "../components/common/Segmented";
import type { SmartAlbumSort } from "../api/albums";

const DIMENSION_PARAM = "dimension";
const SORT_PARAM = "sort";

/** 排序方式与它在标题栏上的说法。 */
const SORT_OPTIONS: { value: SmartAlbumSort; label: string }[] = [
  { value: "time", label: "时间最新" },
  { value: "photos", label: "照片最多" },
  { value: "quality", label: "推荐最强" },
];

/** 认出排序参数：认不出来的按「时间最新」处理。 */
function readSort(value: string | null): SmartAlbumSort {
  const found = SORT_OPTIONS.find((option) => option.value === value);
  return found?.value ?? "time";
}

/**
 * 跨文件夹专页只展示精选主题。详细分类仍由后台生成并用于推荐计算；
 * 目录分页只读已生成的推荐缓存，不在浏览时触发分析。
 *
 * 这一页是排序的特例：它排的是跨相册的一组主题，按相册分块排出来的是
 * 「这本相册最近拍过什么」，与主题本身的新旧无关 —— 因此整面墙按用户
 * 选的方式排：组内最新一张照片的拍摄时间、照片张数或推荐强度。
 */
export default function SmartAlbums() {
  const [searchParams, setSearchParams] = useSearchParams();
  const sort = readSort(searchParams.get(SORT_PARAM));
  const directory = useSmartAlbumDirectory("recommended", true, { sort });
  // 超宽档（≥2240px）上这一页是「左叙述、右陈列」的两栏版式，
  // 陈列区因此窄一截 —— 列宽跟着放大，每张卡才不至于挤成一条。
  const ultrawide = useMediaQuery(ULTRAWIDE_LAYOUT_QUERY);

  const items = directory.items;
  const isInitialLoading = directory.isLoading && items.length === 0;

  // 旧的分类深链统一回到精选推荐，避免页面和地址栏表达不同分类。
  useEffect(() => {
    if (!searchParams.has(DIMENSION_PARAM)) return;
    const params = new URLSearchParams(searchParams);
    params.delete(DIMENSION_PARAM);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

  // 排序写进地址栏：这一页是唯一有排序的页面，复制链接要带上排序。
  function changeSort(next: SmartAlbumSort) {
    if (next === sort) return;
    const params = new URLSearchParams(searchParams);
    params.set(SORT_PARAM, next);
    setSearchParams(params, { replace: true });
  }

  // 无限下拉：快滑到底时就把下一批接上，滑到底时分组已经在那里。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasNextPage = directory.hasNextPage ?? false;
  const isFetchingNextPage = directory.isFetchingNextPage;
  const fetchNextPage = directory.fetchNextPage;
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        if (!hasNextPage || isFetchingNextPage) return;
        void fetchNextPage();
      },
      // 提前一屏接上：等真的滑到底再请求，会出现一次明显的空档。
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-full pb-10">
      <div className="page-shell pt-4">
        {/* 两栏骨架：≥2240px 上左边是叙述（标题与排序），右边是墙；
            窄一些时它是 display: contents，版式与原来一模一样。 */}
        <div className="page-layout">
          <aside className="page-layout__aside">
            {/* 标题栏：这一页只有精选推荐，没有分类页签；排序是这一页唯一的
                操作，放在标题这一行的右端。 */}
            {/* 对齐方式写在样式表里：工具类在 utilities 层，超宽档那条
                媒体查询压不住它（那一档要改成上下两行、左对齐）。 */}
            <div className="mb-4 flex flex-wrap justify-between gap-3 page-layout__titlebar">
              <div className="min-w-0">
                <p className="page-eyebrow">智能相册</p>
                <h1 className="page-title page-title--sm">精选推荐</h1>
              </div>
              <Segmented
                label="推荐主题排序"
                value={sort}
                onChange={changeSort}
                options={SORT_OPTIONS}
              />
            </div>
          </aside>
          <div className="page-layout__main">
            {isInitialLoading ? (
              <AlbumGridSkeleton count={10} bare label="正在加载精选推荐…" />
            ) : directory.isError && items.length === 0 ? (
              <ErrorBanner
                className="rounded-xl"
                onRetry={() => void directory.refetch()}
                retrying={directory.isLoading}
              >
                精选推荐暂时读不出来。
              </ErrorBanner>
            ) : items.length === 0 ? (
              <EmptyState
                title="暂时没有精选推荐"
                description="精选推荐至少 12 张、至少两类线索一致，且不与所在文件夹重复；没有合适结果时可以留空。"
                icon={<span aria-hidden="true">✦</span>}
                dense
              />
            ) : (
              <>
                {/* 一面连续的墙：分组不再按来源相册切块。
                新算法下每本相册往往只有一条推荐，分块会退化成一条只挂
                一张卡的窄带，右侧四列全空。来源相册写在卡片上。 */}
                <SmartAlbumWall
                  items={items}
                  targetColumnWidth={ultrawide ? 300 : 260}
                />
                <div
                  ref={sentinelRef}
                  className="h-px"
                  aria-hidden="true"
                  data-testid="smart-albums-sentinel"
                />
                {isFetchingNextPage ? (
                  <p className="py-4 text-center text-meta text-fg-subtle">
                    正在接下一批…
                  </p>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
