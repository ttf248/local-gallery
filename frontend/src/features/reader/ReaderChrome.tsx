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
    showSwitchNotif,
    total,
    videos,
    workbenchMode,
  } = reader;
  const group =
    mode === "double" && !isVideo
      ? spreadAt(index, total, reader.coverOffset)
      : [index];
  const start =
    mode === "continuous"
      ? (reader.observation?.atTop ?? index === 0)
      : group[0] <= 0;
  const end =
    mode === "continuous"
      ? (reader.observation?.atBottom ?? false)
      : group.at(-1) === total - 1;
  const prevAlbum = adjacentNames.prev
    ? () => void goAdjacent(-1, { notify: showSwitchNotif, albumsOnly: true })
    : undefined;
  const nextAlbum = reader.hasNextVolume
    ? () => void goAdjacent(1, { notify: showSwitchNotif, albumsOnly: true })
    : undefined;
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
      <div className="contents" {...reader.chrome.chromeFocusProps}>
        <GalleryHeader
          onToggleChrome={reader.chrome.toggle}
          onOpenSettings={() => setSettingsOpen(true)}
          name={headerName}
          index={
            mode === "double" && !isVideo
              ? spreadAt(index, total, reader.coverOffset)[0]
              : index
          }
          itemIndex={isVideo ? itemIndex : undefined}
          total={total}
          isFavorite={isFav}
          onBack={goBack}
          onToggleFavorite={onToggleFavorite}
          onToggleInfo={reader.toggleInfo}
          onToggleHelp={() => setShowHelp((v) => !v)}
          onPrev={prev}
          onNext={next}
          onPrevAlbum={prevAlbum}
          onNextAlbum={nextAlbum}
          onMenuChange={reader.setMenuOpen}
          fullscreen={reader.fullscreen}
          onSetCover={() => void onSetCover()}
          onClearCover={onClearCover}
          hasCustomCover={hasCustomCover}
          onToggleOverview={() => reader.toggleDrawer("pages")}
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

        {!isVideo && (
          <>
            <GalleryAlbumNav
              onPrevAlbum={prevAlbum}
              onNextAlbum={nextAlbum}
              prevLabel={adjacentNames.prev}
              nextLabel={adjacentNames.next}
            />
            <GalleryToolbar
              onChapters={() => reader.toggleDrawer("chapters")}
              singlePage={total === 1}
              onPrev={prev}
              onNext={next}
              atStart={start}
              atEnd={total === 1 && !reader.hasNextVolume}
              nextVolume={end && reader.autoSwitchAlbum && reader.hasNextVolume}
              onSettings={() => setSettingsOpen(true)}
            >
              <PageSlider
                total={total}
                index={group[0] ?? 0}
                onJump={jumpTo}
                images={images}
                double={mode === "double" && group.length === 2}
              />
            </GalleryToolbar>
          </>
        )}
      </div>
      {settingsOpen && (
        <ReaderSettingsSheet open onClose={() => setSettingsOpen(false)} />
      )}
    </>
  );
}
