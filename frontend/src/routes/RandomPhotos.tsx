import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { usePicks } from "../hooks/usePicks";
import { useUIStore } from "../store/uiStore";
import { usePhotoStore, type WallDensity } from "../store/photoStore";
import PhotoMasonry from "../components/wall/PhotoMasonry";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { ShuffleIcon } from "../ui/icons";
import { albumRoute } from "../utils/path";
// 大图预览按需加载：这一页的首屏是照片，预览用不上。
const PhotoViewer = lazy(() => import("../components/wall/PhotoViewer"));

/**
 * 随手看看：全库随机抽出来的照片墙。
 *
 * 首页那面「随手看看」只是一条照片带 —— 它的职责是让人看见照片本身，
 * 不是让人看完照片。点标题进这一页，才是把随机这一批照片铺满整屏。
 *
 * 这一页里没有排序、没有筛选、没有「最近」：进来的每张照片都是随机
 * 抽的，往下滑会接着抽下一批。「换一批」换的是取材种子而不是重新请求
 * —— 同一个种子给同一批照片，重新请求有可能再抽到同一批，等于没换。
 */
export default function RandomPhotos() {
  const pushToast = useUIStore((s) => s.pushToast);
  const picks = usePicks();
  // 列宽跟相册页用同一个偏好：用户在相册页选过「紧凑」，这里不该
  // 又变回另一套疏密。
  const density = usePhotoStore((s) => s.density);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // 种子带一个自增序号：连点两次「换一批」也不会撞回同一批。
  const seedCounter = useRef(0);

  const [seed, setSeed] = useState(() => `random-${Date.now()}`);
  const feedQuery = useMemo(
    () => ({ kind: "photo" as const, scope: "stream" as const, seed }),
    [seed],
  );
  // 换批次时保留上一批照片：新一批到达之前墙上不闪空。
  const feed = useMediaFeed(feedQuery, true, { keepPrevious: true });

  const reshuffle = useCallback(() => {
    seedCounter.current += 1;
    setSeed(`random-${Date.now()}-${seedCounter.current}`);
    // 换了一批就该从头看：停在原来那张的位置上，看到的还是上一批。
    document.querySelector(".app-main")?.scrollTo({ top: 0 });
  }, []);

  const togglePick = useCallback(
    (id: string) => {
      void picks
        .toggle(id)
        .catch(() => pushToast({ kind: "error", message: "精选操作失败" }));
    },
    [picks, pushToast],
  );

  // 无限下拉：快滑到底时就把下一批接上，滑到底时照片已经在那里。
  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasNextPage = feed.hasNextPage ?? false;
  const isFetchingNextPage = feed.isFetchingNextPage;
  const fetchNextPage = feed.fetchNextPage;
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

  const refreshing = feed.isFetching && feed.items.length > 0;
  const items = feed.items;

  return (
    <div className="min-h-full pb-10">
      {/* 页头压成一条：这一页是往下滑的照片墙，页头占太高就把照片挤到
          下面去了。说明文字挪到墙的上方，随页面一起滚走。 */}
      <header className="sticky top-0 z-20 border-b border-border-faint bg-bg">
        <div className="page-shell flex items-center justify-between gap-4 py-3">
          <div className="flex min-w-0 items-baseline gap-3">
            <span className="page-eyebrow shrink-0">随手看看</span>
            <h1 className="page-title page-title--sm truncate">随机照片</h1>
          </div>
          <button
            type="button"
            className="btn btn-outline btn-sm shrink-0"
            onClick={reshuffle}
            disabled={refreshing}
          >
            <ShuffleIcon size={12} />
            <span>{refreshing ? "换一批…" : "换一批"}</span>
          </button>
        </div>
      </header>

      <div className="page-shell pt-4">
        <p className="mb-3 text-meta text-fg-muted">
          全是随机抽的：跨相册取照片，不按时间、不看最近。往下滑会接着抽下一批。
        </p>
        {feed.isError ? (
          <ErrorBanner className="rounded-xl p-6">
            随机照片读取失败，请重试。
          </ErrorBanner>
        ) : items.length === 0 && !feed.isLoading ? (
          <EmptyState
            title="照片库还是空的"
            description="扫一遍媒体目录，这里就有照片了。"
          />
        ) : (
          <>
            <PhotoMasonry
              items={items}
              targetColumnWidth={masonryColumnWidth(density)}
              onOpen={(_item, index) => setViewerIndex(index)}
              albumLabel={(item) => item.albumName}
              isPicked={(id) => picks.isPicked(id)}
              onTogglePick={(item) => togglePick(item.id)}
            />
            <div
              ref={sentinelRef}
              className="h-px"
              aria-hidden="true"
              data-testid="random-photos-sentinel"
            />
            {isFetchingNextPage ? (
              <p className="py-4 text-center text-meta text-fg-subtle">
                正在抽下一批…
              </p>
            ) : null}
          </>
        )}
      </div>

      {viewerIndex !== null && items[viewerIndex] && (
        <Suspense fallback={null}>
          <PhotoViewer
            items={items}
            index={viewerIndex}
            /* 这一墙的照片来自不同相册：标题说清出处，
               点一下就回到那本。 */
            albumName={items[viewerIndex].albumName}
            albumHref={albumRoute("photo", items[viewerIndex].albumId)}
            totalCount={items.length}
            onIndexChange={(index) => setViewerIndex(index)}
            onClose={() => setViewerIndex(null)}
            isPicked={picks.isPicked(items[viewerIndex].id)}
            onTogglePick={() => togglePick(items[viewerIndex].id)}
          />
        </Suspense>
      )}
    </div>
  );
}

/**
 * 瀑布流的列宽：跟照片墙的疏密偏好对得上。
 *
 * 紧凑的墙列多、每张窄；宽松的墙列少、每张大。
 */
function masonryColumnWidth(density: WallDensity): number {
  switch (density) {
    case "compact":
      return 190;
    case "large":
      return 340;
    default:
      return 260;
  }
}
