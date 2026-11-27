import { spreadAt } from "./readerLayout";
import { ReaderSettingsSheet } from "./ReaderSettingsSheet";
import PageSlider from "./PageSlider";
import GalleryHeader from "./GalleryHeader";
import GalleryToolbar from "./GalleryToolbar";
import GalleryAlbumNav from "./GalleryAlbumNav";
import type { ReaderController } from "./useReaderController";

export function ReaderChrome({ reader }: { reader: ReaderController }) {
  const { settingsOpen, setSettingsOpen } = reader;
  const {
    adjacentNames,
    chromeVisible,
    goAdjacent,
    goBack,
    goToVideo,
    hasCustomCover,
    headerName,
    images,
    index,
    isFav,
    isVideo,
    itemIndex,
    jumpTo,
    mode,
    next,
    onClearCover,
    onSetCover,
    onToggleFavorite,
    openWorkbench,
    prev,
    progressFailure,
    progressKey,
    retryProgress,
    retryingProgress,
    setShowHelp,
    setShowInfo,
    setShowOverview,
    showSwitchNotif,
    toolbarVisible,
    total,
    videos,
    workbenchMode,
  } = reader;
  return (
    <>
      {/* 顶部常驻条：返回 / 名称 / 页码 / 全屏 / 菜单 */}
      {progressFailure?.key === progressKey && (
        <div
          role="alert"
          className="absolute top-20 left-3 right-3 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-md border border-theater-border reader-glass p-3 text-body text-white/85 shadow-3"
        >
          <span>
            {progressFailure.operation === "restore"
              ? "无法恢复上次进度，已暂停保存，避免覆盖原记录。"
              : "阅读进度未保存，请重试。"}
          </span>
          <button
            type="button"
            disabled={retryingProgress}
            onClick={() => void retryProgress()}
            className="shrink-0 rounded border border-white/20 px-3 py-1 text-white/85 hover:bg-white/10 disabled:opacity-50"
          >
            {retryingProgress ? "重试中…" : "重试进度"}
          </button>
        </div>
      )}
      <GalleryHeader
        onOpenSettings={() => setSettingsOpen(true)}
        name={headerName}
        index={
          mode === "double" && !isVideo ? spreadAt(index, total)[0] : index
        }
        itemIndex={isVideo ? itemIndex : undefined}
        total={total}
        isFavorite={isFav}
        onBack={goBack}
        onToggleFavorite={onToggleFavorite}
        onToggleInfo={() => setShowInfo((v) => !v)}
        onToggleHelp={() => setShowHelp((v) => !v)}
        onPrev={prev}
        onNext={next}
        onPrevAlbum={() =>
          void goAdjacent(-1, { notify: showSwitchNotif, albumsOnly: true })
        }
        onNextAlbum={() =>
          void goAdjacent(1, { notify: showSwitchNotif, albumsOnly: true })
        }
        onSetCover={() => void onSetCover()}
        onClearCover={onClearCover}
        hasCustomCover={hasCustomCover}
        onToggleOverview={() => setShowOverview((v) => !v)}
        workbenchMode={workbenchMode}
        onOpenWorkbench={openWorkbench}
        onJumpToFirst={isVideo ? () => goToVideo(0) : () => jumpTo(0, "menu")}
        onJumpToLast={
          isVideo
            ? () => {
                if (videos.length > 0) goToVideo(videos.length - 1);
              }
            : () => jumpTo(images.length - 1, "menu")
        }
      />

      {/* 阅读控制：底部浮动工具条（翻页 / 模式 / 适配 / 缩放 / 旋转）。
            它压在画面上，常驻会一直挡着画，所以空闲后淡出，鼠标靠近
            底部就回来；位置信息交给常驻的顶部条与底部页码条。
            视频模式不显示（视频有原生 controls）。 */}
      {!isVideo && (
        <GalleryToolbar
          onPrev={prev}
          onNext={next}
          atStart={index <= 0}
          atEnd={index >= images.length - 1}
          visible={toolbarVisible}
        />
      )}

      {/* 跨卷导航：画面左侧竖排，低频但需要常驻可见 */}
      {!isVideo && (
        <GalleryAlbumNav
          visible={chromeVisible}
          onPrevAlbum={() =>
            void goAdjacent(-1, { notify: showSwitchNotif, albumsOnly: true })
          }
          onNextAlbum={() =>
            void goAdjacent(1, { notify: showSwitchNotif, albumsOnly: true })
          }
          prevLabel={adjacentNames.prev}
          nextLabel={adjacentNames.next}
        />
      )}

      {/* 底部进度条 + 跳转：常驻显示。
            它是被动信息（当前在第几张）+ 长相册的主要导航手段（拖拽刮擦 +
            浮出缩略图条），按 idle 淡出会让用户在一本 300 张的漫画里
            彻底失去位置感 —— 而它本身只占 44px。
            视频模式下隐藏（<video> 自带 controls）。 */}
      {!isVideo && (
        <div className="reader-bottom-chrome absolute bottom-0 inset-x-0 z-10">
          <PageSlider
            total={images.length}
            index={
              mode === "double" && !isVideo ? spreadAt(index, total)[0] : index
            }
            onJump={jumpTo}
            images={images}
            double={mode === "double"}
          />
        </div>
      )}
      {settingsOpen && (
        <ReaderSettingsSheet open onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
