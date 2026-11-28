import { ChapterEndBanner } from "./ChapterEndBanner";
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
      <div className="reader-stage flex min-h-0 min-w-0 flex-col">
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
            footer={<ChapterEndBanner reader={reader} />}
            dimensions={dimensions}
            key={pathParam}
            albumId={pathParam}
            onJump={reader.jumpTo}
            request={request}
            viewportRef={viewportRef}
            onObserve={onObserve}
            onInvalidate={onInvalidate}
            onClickNavigate={(dir) => {
              if (dir === 0) reader.chrome.toggle();
              else if (dir === -1) prev();
              else if (dir === 1) next();
            }}
          />
        )}
      </div>
    </>
  );
}
