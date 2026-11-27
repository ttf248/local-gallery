import { useKeyboard } from "./useKeyboard";
import { useGalleryStore } from "../store/galleryStore";
import { toggleFullscreen as toggleFullscreenImpl } from "../utils/fullscreen";

export interface ReaderKeyHandlers {
  /** 视频模式：方向键与空格归视频播放器管，阅读器不注册图片操作。 */
  isVideo: boolean;
  prev: () => void;
  next: () => void;
  jumpToFirst: () => void;
  jumpToLast: () => void;
  toggleInfo: () => void;
  toggleOverview: () => void;
  toggleHelp: () => void;
  /** 读完一卷后的收尾提示。 */
  toggleFinished: () => void;
  toggleFavorite: () => void;
  setCover: () => void;
  clearCover: () => void;
  nextAlbum: () => void;
  prevAlbum: () => void;
  /** Esc 的最后一档：返回上一页。 */
  onEscape: () => void;
}

export interface ReaderOverlayState {
  showHelp: boolean;
  showOverview: boolean;
  showInfo: boolean;
  showFinished: boolean;
  /** 媒体是否就绪：没就绪时 Esc 不返回，避免退出到半加载的页面。 */
  ready: boolean;
}

/**
 * 阅读器的键盘映射。
 *
 * 单独成 hook 是为了让「按什么键做什么」这一张表能被一眼看完：
 * 帮助浮层里写的快捷键与这里一一对应（`shortcutsTable.test.ts` 会核对
 * 清单与实现是否一致）。
 */
export function useReaderKeys(
  handlers: ReaderKeyHandlers,
  overlays: ReaderOverlayState,
) {
  const { isVideo, ...rest } = handlers;
  useKeyboard(
    {
      // 视频方向键和空格由 VideoPlayer 处理，不注册图片操作。
      ...(isVideo
        ? {}
        : {
            arrowleft: rest.prev,
            arrowright: rest.next,
            "+": () => useGalleryStore.getState().zoomIn(),
            "-": () => useGalleryStore.getState().zoomOut(),
            "=": () => useGalleryStore.getState().zoomIn(),
            "0": () => useGalleryStore.getState().zoomReset(),
            r: () => useGalleryStore.getState().rotate(90),
            space: () => useGalleryStore.getState().toggleSlideshow(),
            i: rest.toggleInfo,
            t: rest.toggleOverview,
            "1": () => useGalleryStore.getState().setMode("single"),
            "2": () => useGalleryStore.getState().setMode("continuous"),
            "3": () => useGalleryStore.getState().setMode("double"),
            f: () => useGalleryStore.getState().cycleFit(),
            l: () => {
              const cur = useGalleryStore.getState().direction;
              useGalleryStore
                .getState()
                .setDirection(cur === "ltr" ? "rtl" : "ltr");
            },
          }),
      pageup: rest.prev,
      pagedown: rest.next,
      home: rest.jumpToFirst,
      end: rest.jumpToLast,
      f11: () => toggleFullscreenImpl(),
      "ctrl+/": rest.toggleHelp,
      "?": rest.toggleHelp,
      n: rest.nextAlbum,
      p: rest.prevAlbum,
      s: rest.toggleFavorite,
      u: rest.setCover,
      "shift+u": rest.clearCover,
      escape: () => {
        if (overlays.showHelp) rest.toggleHelp();
        else if (overlays.showOverview) rest.toggleOverview();
        else if (overlays.showInfo) rest.toggleInfo();
        else if (overlays.showFinished) rest.toggleFinished();
        // 仅在当前媒体就绪后返回；视频不依赖图片列表。
        else if (overlays.ready) rest.onEscape();
      },
    },
    true,
    () =>
      !document.querySelector(
        'dialog[open], [role="dialog"][aria-modal="true"], [role="menu"]',
      ),
  );
}
