import { lazy, Suspense, useCallback, useMemo, useRef, useState } from "react";
import { useMediaFeed } from "../hooks/useMediaFeed";
import { usePicks } from "../hooks/usePicks";
import { useUIStore } from "../store/uiStore";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import PhotoWall from "../components/wall/PhotoWall";
import PageHeading from "../components/common/PageHeading";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import { ShuffleIcon } from "../components/common/Icon";
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
 * 抽的。「换一批」换的是取材种子而不是重新请求 —— 同一个种子给同一批
 * 照片，重新请求有可能再抽到同一批，等于没换。
 */
export default function RandomPhotos() {
  const pushToast = useUIStore((s) => s.pushToast);
  const picks = usePicks();
  // 墙的疏密跟相册页用同一个偏好：用户在相册页选过「紧凑」，这里不该
  // 又变回另一套疏密。
  const density = usePhotoStore((s) => s.density);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  // 种子带一个自增序号：连点两次「换一批」也不会撞回同一批。
  const seedCounter = useRef(0);

  const [seed, setSeed] = useState(() => `random-${Date.now()}`);
  const feedQuery = useMemo(
    () => ({ kind: "photo" as const, scope: "random" as const, seed }),
    [seed],
  );
  // 换批次时保留上一批照片：新一批到达之前墙上不闪空。
  const feed = useMediaFeed(feedQuery, true, { keepPrevious: true });

  const reshuffle = useCallback(() => {
    seedCounter.current += 1;
    setSeed(`random-${Date.now()}-${seedCounter.current}`);
  }, []);

  const togglePick = useCallback(
    (id: string) => {
      void picks
        .toggle(id)
        .catch(() => pushToast({ kind: "error", message: "精选操作失败" }));
    },
    [picks, pushToast],
  );

  const refreshing = feed.isFetching && feed.items.length > 0;
  const items = feed.items;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border-faint bg-bg">
        <div className="px-[clamp(20px,3vw,48px)]">
          <PageHeading
            contained
            eyebrow="随手看看"
            title="随机照片"
            description="全是随机抽的：跨相册取照片，不按时间、不看最近。换一批换的是取材种子，因此一定换得掉。"
            action={
              <button
                type="button"
                className="btn btn-outline"
                onClick={reshuffle}
                disabled={refreshing}
              >
                <ShuffleIcon size={12} />
                <span>{refreshing ? "换一批…" : "换一批"}</span>
              </button>
            }
          />
        </div>
      </header>

      <div className="min-h-0 flex-1 px-[clamp(20px,3vw,48px)] pb-2">
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
          <PhotoWall
            items={items}
            total={items.length}
            targetHeight={wallTargetHeight(density)}
            hasNextPage={false}
            isLoadingMore={false}
            onLoadMore={() => {}}
            onOpen={(_item, index) => setViewerIndex(index)}
            albumLabel={(item) => item.albumName}
            isPicked={(id) => picks.isPicked(id)}
            onTogglePick={(item) => togglePick(item.id)}
          />
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
