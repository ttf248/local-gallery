import type { AppMode } from "../api/library";
import { Segmented } from "../ui/Segmented";
import { IconButton } from "../ui/IconButton";
import { ImageIcon, ReaderIcon } from "../ui/icons";
interface Props {
  mode: AppMode;
  onChange: (mode: AppMode) => void;
  compact?: boolean;
}
export default function WorkbenchSwitch({ mode, onChange, compact }: Props) {
  const next = mode === "photo" ? "comic" : "photo";
  if (compact)
    return (
      <IconButton
        label={next === "comic" ? "切换到漫画" : "切换到照片"}
        onClick={() => onChange(next)}
      >
        {next === "comic" ? <ReaderIcon /> : <ImageIcon />}
      </IconButton>
    );
  return (
    <Segmented<AppMode>
      label="工作台模式"
      options={[
        { label: "照片", value: "photo" },
        { label: "漫画", value: "comic" },
      ]}
      value={mode}
      onChange={onChange}
      className="w-full [&_[role=radiogroup]]:w-full [&_button]:flex-1"
    />
  );
}
