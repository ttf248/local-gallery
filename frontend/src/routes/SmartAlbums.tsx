import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useSmartAlbumDirectory } from "../hooks/useSmartAlbums";
import SmartAlbumWall from "../components/album/SmartAlbumWall";
import AlbumGridSkeleton from "../components/album/AlbumGridSkeleton";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";

const DIMENSION_PARAM = "dimension";

/**
 * 跨文件夹专页只展示精选主题。详细分类仍由后台生成并用于推荐计算；
 * 目录分页只读已生成的推荐缓存，不在浏览时触发分析。
 */
export default function SmartAlbums() {
  const [searchParams, setSearchParams] = useSearchParams();
  const directory = useSmartAlbumDirectory("recommended", true);

  const items = directory.items;
  const isInitialLoading = directory.isLoading && items.length === 0;

  // 旧的分类深链统一回到精选推荐，避免页面和地址栏表达不同分类。
  useEffect(() => {
    if (!searchParams.has(DIMENSION_PARAM)) return;
    const params = new URLSearchParams(searchParams);
    params.delete(DIMENSION_PARAM);
    setSearchParams(params, { replace: true });
  }, [searchParams, setSearchParams]);

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
      // 提前一屏接上：等真的滑到底再请求，会有一次明显的空档。
      { rootMargin: "800px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="min-h-full pb-10">
      <h1 className="sr-only">精选推荐</h1>
      <div className="page-shell pt-4">
        {isInitialLoading ? (
          <AlbumGridSkeleton
            count={10}
            bare
            label="正在加载精选推荐…"
          />
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
            <SmartAlbumWall items={items} />
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
  );
}
