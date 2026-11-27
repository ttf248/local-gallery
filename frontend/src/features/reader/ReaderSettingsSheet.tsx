import { useGalleryStore } from "../../store/galleryStore";
import { WIDE_LAYOUT_QUERY, useMediaQuery } from "../../hooks/useMediaQuery";
import { Sheet } from "../../ui/Sheet";
import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import Segmented from "../../ui/Segmented";
import { IconButton } from "../../ui/IconButton";
import { CloseIcon } from "../../ui/icons";

export function ReaderSettingsSheet({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const slideshow = useGalleryStore((s) => s.slideshow),
    toggleSlideshow = useGalleryStore((s) => s.toggleSlideshow);
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const mode = useGalleryStore((state) => state.mode);
  const fit = useGalleryStore((state) => state.fit);
  const direction = useGalleryStore((state) => state.direction);
  const { setMode, setFit, setDirection, zoomIn, zoomOut, zoomReset, rotate } =
    useGalleryStore.getState();
  const zoom = useGalleryStore((s) => s.zoom),
    rotation = useGalleryStore((s) => s.rotation);
  return (
    <Sheet
      side={wide ? "right" : "bottom"}
      open={open}
      className="reader-settings-sheet"
      label="阅读设置"
      onClose={onClose}
    >
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-title">阅读设置</h2>
        <IconButton label="关闭阅读设置" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      </header>
      <SettingsGroup title="页面">
        <SettingsRow label="阅读模式">
          <Segmented
            label="显示模式"
            value={mode}
            onChange={setMode}
            options={[
              { value: "single", label: "单页" },
              { value: "continuous", label: "连续" },
              { value: "double", label: "双页" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="翻页方向">
          <Segmented
            label="翻页方向"
            value={direction}
            onChange={setDirection}
            options={[
              { value: "ltr", label: "从左到右" },
              { value: "rtl", label: "从右到左" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="页面适配">
          <Segmented
            label="页面适配"
            value={fit}
            onChange={setFit}
            options={[
              { value: "fit", label: "整页" },
              { value: "width", label: "按宽" },
              { value: "height", label: "按高" },
              { value: "original", label: "原始" },
            ]}
          />
        </SettingsRow>
        <SettingsRow label="相对倍率">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled={zoom <= 0.1} onClick={zoomOut}>
              缩小
            </button>
            <button type="button" onClick={zoomReset} title="重置当前倍率">
              相对
              {
                {
                  fit: "整页",
                  width: "按宽",
                  height: "按高",
                  original: "原始",
                }[fit]
              }{" "}
              {Math.round(zoom * 100)}%
            </button>
            <button type="button" disabled={zoom >= 5} onClick={zoomIn}>
              放大
            </button>
          </div>
        </SettingsRow>
        <SettingsRow label="旋转">
          <button type="button" onClick={() => rotate(90)}>
            顺时针 90° · 当前 {rotation}°
          </button>
        </SettingsRow>
        <SettingsRow label="幻灯片">
          <button
            type="button"
            aria-pressed={slideshow}
            onClick={toggleSlideshow}
          >
            {slideshow ? "停止播放" : "自动翻页"}
          </button>
        </SettingsRow>
      </SettingsGroup>
    </Sheet>
  );
}
