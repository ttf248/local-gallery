import type { AppMode } from "../../api/library";
import { ImageIcon, ReaderIcon } from "../common/Icon";

interface Props {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  compact?: boolean;
}

const options = [
  { key: "photo", label: "照片", Icon: ImageIcon },
  { key: "comic", label: "漫画", Icon: ReaderIcon },
] as const;

export default function ModeSwitch({ mode, onChange, compact }: Props) {
  if (compact) {
    const next = options.find(({ key }) => key !== mode) ?? options[0];
    return (
      <button
        type="button"
        className="toolbar-icon"
        aria-label={`切换到${next.label}`}
        title={`切换到${next.label}`}
        onClick={() => onChange(next.key)}
      >
        <next.Icon size={17} />
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label="工作台模式"
      className="mode-switch ui-segmented"
      data-mode={mode}
    >
      {options.map(({ key, label }) => (
        <button
          key={key}
          type="button"
          aria-pressed={mode === key}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
