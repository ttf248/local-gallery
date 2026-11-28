import { useEffect } from "react";
import { documentTitle, useRouteMeta } from "../app/routeMeta";
import ImageInfoPanel from "../features/viewer/ImageInfoPanel";
import HelpOverlay from "../features/common/HelpOverlay";
import ReaderDrawer from "../features/reader/ReaderDrawer";
import { ContextMenu } from "../ui/ContextMenu";
import {
  CloseIcon,
  ImageIcon,
  RefreshIcon,
  ArrowUpRightIcon,
} from "../ui/icons";
import { useReaderController } from "../features/reader/useReaderController";
import { ReaderCanvas } from "../features/reader/ReaderCanvas";
import { ReaderChrome } from "../features/reader/ReaderChrome";
import "../styles/reader.css";

export default function Reader() {
  const reader = useReaderController();
  const {
    albumSide,
    infoTarget,
    setInfoTarget,
    allowOsOpen,
    contextMenu,
    current,
    goAdjacent,
    goBack,
    hasCustomCover,
    hasNextVolume,
    headerName,
    images,
    index,
    isVideo,
    jumpTo,
    media,
    onClearCover,
    onOpenInExplorer,
    onSetCover,
    onSetWorkCover,
    pathParam,
    ready,
    reload,
    setContextMenu,
    setShowFinished,
    setShowHelp,
    setShowInfo,
    setShowOverview,
    showFinished,
    showHelp,
    showInfo,
    showOverview,
    showSwitchNotif,
  } = reader;
  const route = useRouteMeta();
  const title = documentTitle(
    route?.meta ?? null,
    route?.params ?? {},
    "comic",
    headerName,
  );
  useEffect(() => {
    document.title = title;
  }, [title]);
  if (!ready) {
    return (
      // 阅读器画布恒为深色：加载态、空态、失败态都跟着深色走，
      // 否则浅色主题下会先闪一屏白底，再跳到黑色画布。
      <div className="reader-shell flex flex-col h-full">
        {/* 顶部条：返回 / 名称（常驻） */}
        <div className="px-4 h-[calc(2.25rem+var(--safe-top))] pt-safe-top text-caption text-white/60 border-b border-white/10 bg-theater-surface/60 flex items-center gap-3">
          <button
            type="button"
            onClick={goBack}
            className="px-1.5 py-0.5 rounded hover:bg-white/10 text-white/60 hover:text-white"
            aria-label="返回"
          >
            ←
          </button>
          <span className="font-medium text-white/85 truncate">
            {headerName}
          </span>
        </div>
        <div className="flex-1 flex items-center justify-center px-6">
          {media.status === "no-album" ? (
            <div className="text-center">
              <div className="font-display text-heading font-semibold text-white/90">
                无可显示的图片
              </div>
              <div className="text-body text-white/50 mt-1.5">
                未指定相册路径
              </div>
            </div>
          ) : media.status === "empty" || media.status === "error" ? (
            <div className="text-center max-w-sm">
              <div className="font-display text-heading font-semibold text-white/90 mb-2">
                {media.status === "empty"
                  ? isVideo
                    ? "这个相册没有视频"
                    : "这个相册没有图片"
                  : "加载失败"}
              </div>
              <div className="text-body leading-relaxed text-white/60 mb-6">
                {media.status === "empty"
                  ? isVideo
                    ? "可以换个相册，或检查视频是否已被移动/删除。"
                    : "可以换个相册，或检查文件是否已被移动/删除。"
                  : media.error}
              </div>
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  className="px-4 h-9 text-body rounded-md border border-white/15 bg-white/10 hover:bg-white/15 text-white/85 transition-colors"
                >
                  返回
                </button>
                <button
                  type="button"
                  onClick={reload}
                  className="px-4 h-9 text-body rounded-md bg-primary text-on-primary hover:opacity-90 transition-opacity"
                >
                  重试
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 text-body text-white/60">
              <div
                className="w-5 h-5 rounded-full border-2 border-white/40 border-t-transparent animate-spin"
                aria-hidden
              />
              <span>正在加载图片…</span>
            </div>
          )}
        </div>
      </div>
    );
  }

  function openPageMenu(element: EventTarget | null, x: number, y: number) {
    if (!pathParam) return;
    const page =
      element instanceof Element
        ? element.closest<HTMLElement>("[data-reader-page]")
        : null;
    const targetIndex = page
      ? Number(page.dataset.readerPage)
      : (reader.viewportRef.current?.captureAnchor()?.index ?? index);
    const fileId = isVideo
      ? current
      : (page?.dataset.fileId ?? images[targetIndex]);
    if (fileId)
      setContextMenu({
        x,
        y,
        target: { albumId: pathParam, index: targetIndex, fileId },
      });
  }
  return (
    <div
      data-testid="gallery-reader"
      className="reader-shell relative flex overflow-hidden select-none"
      // 用 dvh 而不是 vh：移动端浏览器地址栏收起 / 展开时，100vh 不等于
      // 实际可视高度，底部的页码进度条会被推到屏幕外。
      style={{ height: "100dvh" }}
      onContextMenu={(e) => {
        e.preventDefault();
        openPageMenu(e.target, e.clientX, e.clientY);
      }}
      onKeyDown={(e) => {
        if (
          (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) &&
          !contextMenu
        ) {
          e.preventDefault();
          e.stopPropagation();
          const rect = (e.target as Element).getBoundingClientRect();
          openPageMenu(
            e.target,
            Math.min(innerWidth - 8, Math.max(8, rect.x + rect.width / 2)),
            Math.min(innerHeight - 8, Math.max(8, rect.y + rect.height / 2)),
          );
        }
      }}
    >
      {/* 舞台：画布 + 顶栏 + 浮层控件 + 底部进度条。
          信息面板打开时（md+）这一列横向收缩，面板成为独立的一栏；
          窄屏时面板改为浮在顶栏下方的整宽浮层，不遮挡顶栏。 */}
      <div
        className="reader-workspace relative flex-1 min-w-0"
        data-chrome={reader.chrome.visible ? "visible" : "hidden"}
        onPointerMove={(e) =>
          reader.chrome.notifyEdgeActivity(e.clientY, window.innerHeight)
        }
      >
        <ReaderCanvas reader={reader} />
        <ReaderChrome reader={reader} />
      </div>

      {showInfo && !isVideo && current && (
        <ImageInfoPanel
          absPath={infoTarget?.fileId ?? current}
          onClose={() => {
            setShowInfo(false);
            setInfoTarget(null);
          }}
        />
      )}
      {showOverview && !isVideo && (
        <ReaderDrawer
          reader={reader}
          images={images}
          index={index}
          onJump={(target) => {
            setShowOverview(false);
            jumpTo(target, "overview");
          }}
          onClose={() => setShowOverview(false)}
        />
      )}
      {showFinished && !isVideo && (
        <div
          data-testid="reader-finished"
          /* 抬到底部浮动工具条之上：两者都在底部居中，落在同一处时
             收尾提示会压住工具条，工具条从提示底下露出半截，
             像两层没对齐的浮层。 */
          className="absolute inset-x-0 bottom-28 z-30 mx-auto flex w-[min(560px,92vw)] items-center gap-3 rounded-lg border border-theater-border reader-glass px-4 py-3 text-white shadow-2"
        >
          <div className="min-w-0 flex-1">
            <div className="text-body font-medium text-white/90">
              {hasNextVolume ? "这卷读完了" : "这一部读完了"}
            </div>
            <div className="text-caption text-white/55">
              {media.siblingCount > 0
                ? `图片已看完 · 还有 ${media.siblingCount} 个视频`
                : hasNextVolume
                  ? "可以接着读下一卷，或回到书架继续浏览。"
                  : "这是这一部的最后一卷，没有下一卷了。"}
            </div>
          </div>
          {/* 没有下一卷时不摆这个按钮：点了只会得到一句「没有下一卷」，
              收尾的地方该说清楚话，不该留一个走不通的入口。 */}
          {hasNextVolume ? (
            <button
              type="button"
              onClick={() => {
                setShowFinished(false);
                void goAdjacent(1, {
                  notify: showSwitchNotif,
                  albumsOnly: true,
                });
              }}
              className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-caption text-white/90 transition-colors hover:bg-white/10"
            >
              下一卷
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => {
              setShowFinished(false);
              goBack();
            }}
            className="shrink-0 rounded border border-white/20 px-3 py-1.5 text-caption text-white/90 transition-colors hover:bg-white/10"
          >
            {albumSide === "comic" ? "回到书架" : "回到相册"}
          </button>
          <button
            type="button"
            onClick={() => setShowFinished(false)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded text-white/60 transition-colors hover:bg-white/10 hover:text-white"
            title="关闭"
            aria-label="关闭读完提示"
          >
            <CloseIcon size={13} />
          </button>
        </div>
      )}
      <HelpOverlay
        context={isVideo ? "video" : "image"}
        open={showHelp}
        onClose={() => setShowHelp(false)}
        tone="reader"
      />
      {/* 右键菜单：阅读器内任意位置右键都弹出。
          「设为封面」「清除自定义封面」用与 GalleryHeader 同一份 handler，
          保证快捷键 U / ⇧U 与菜单行为完全一致。 */}
      {contextMenu && pathParam && current && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          className="bg-theater-surface text-theater-fg"
          items={[
            ...(!isVideo
              ? [
                  {
                    id: "info",
                    label: `第 ${contextMenu.target.index + 1} 页 · 图片信息`,
                    onSelect: () => {
                      setInfoTarget(contextMenu.target);
                      setShowInfo(true);
                    },
                  },
                ]
              : []),
            {
              id: "set-cover",
              label: "设为封面 (U)",
              icon: <ImageIcon />,
              onSelect: () => void onSetCover(contextMenu.target),
            },
            ...(onSetWorkCover && !isVideo
              ? [
                  {
                    id: "work-cover",
                    label: "设为所属作品总封面",
                    onSelect: () => onSetWorkCover(contextMenu.target),
                  },
                ]
              : []),
            {
              id: "clear-cover",
              label: hasCustomCover ? "清除自定义封面 (⇧U)" : "清除自定义封面",
              disabled: !hasCustomCover,
              icon: <RefreshIcon />,
              onSelect: onClearCover,
            },
            { type: "separator" },
            {
              id: "explorer",
              label: "在文件管理器中打开",
              icon: <ArrowUpRightIcon />,
              disabled: !allowOsOpen,
              onSelect: () => onOpenInExplorer(contextMenu.target),
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
