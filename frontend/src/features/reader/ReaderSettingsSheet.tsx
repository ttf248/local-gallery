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
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const mode = useGalleryStore((state) => state.mode);
  const fit = useGalleryStore((state) => state.fit);
  const direction = useGalleryStore((state) => state.direction);
  const { setMode, setFit, setDirection } = useGalleryStore.getState();
  return (
    <Sheet
      side={wide ? "right" : "bottom"}
      open={open}
      label="阅读设置"
      onClose={onClose}
    >
      <header className="mb-5 flex items-center justify-between">
        <h2 className="text-title-2">阅读设置</h2>
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
              { value: "double", label: "双页" },
              { value: "continuous", label: "连续" },
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
              { value: "fit", label: "适应" },
              { value: "width", label: "按宽" },
              { value: "height", label: "按高" },
              { value: "original", label: "原始" },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>
    </Sheet>
  );
}
