import ImageGallery from "./ImageGallery";
import { VideoPlayer } from "../viewer";
import type { ReaderController } from "./useReaderController";

export function ReaderCanvas({ reader }: { reader: ReaderController }) {
  const {
    current,
    dimensions,
    goToVideo,
    images,
    initialIndex,
    isVideo,
    next,
    onObserve,
    onInvalidate,
    pathParam,
    request,
    viewportRef,
    prev,
    pushToast,
    videoActivity,
    videoActivityKey,
    videos,
  } = reader;
  return (
    <>
      {/* 暗色画布层：让图片有「画廊」氛围 */}
      {/* flex flex-col 是关键：让 ImageGallery 内部的 `flex-1` + `min-h-0`
          容器拿到约束高度,连续模式才能在容器内纵向滚动,
          而不是被外层 overflow-hidden 裁掉。
          上下两条留白留给常驻的顶栏与页码条：它们不淡出，
          压在画面上就等于永久遮住这一页的开头与结尾。 */}
      <div
        className="absolute inset-0 flex flex-col"
        style={{
          paddingTop: "var(--reader-chrome-top)",
          paddingBottom: isVideo ? 0 : "var(--reader-chrome-bottom)",
        }}
      >
        {isVideo ? (
          <VideoPlayer
            src={current ?? ""}
            initialPositionSec={
              videoActivity.resume.key === videoActivityKey
                ? videoActivity.resume.seconds
                : undefined
            }
            onMetaLoaded={videoActivity.onMetaLoaded}
            onProgress={videoActivity.onProgress}
            onEnded={() => {
              // onEnded 只会在视频模式下触发（<VideoPlayer> 仅在 isVideo 时渲染）。
              // 从 URL 的 initialIndex 派生当前 item 索引。
              videoActivity.markCompleted();
              const cur = Math.max(
                0,
                Math.min(initialIndex, Math.max(0, videos.length - 1)),
              );
              if (cur < videos.length - 1) {
                goToVideo(cur + 1);
              } else {
                pushToast({
                  kind: "success",
                  message: "已看完 🎉",
                  ttl: 1500,
                });
              }
            }}
          />
        ) : (
          <ImageGallery
            images={images}
            dimensions={dimensions}
            key={pathParam}
            albumId={pathParam}
            request={request}
            viewportRef={viewportRef}
            onObserve={onObserve}
            onInvalidate={onInvalidate}
            onClickNavigate={(dir) => {
              if (dir === -1) prev();
              else if (dir === 1) next();
            }}
          />
        )}
      </div>
    </>
  );
}
