import Popover, { PopoverItem } from "../common/Popover";
import Segmented from "../common/Segmented";
import { WALL_DENSITY_LABEL, type WallDensity } from "../../store/photoStore";

/** 每档手动密度用多少个小方块示意疏密。 */
const DENSITY_GRID: Record<
  Exclude<WallDensity, "auto">,
  { cols: number; rows: number }
> = {
  compact: { cols: 5, rows: 4 },
  cozy: { cols: 4, rows: 3 },
  large: { cols: 3, rows: 2 },
};

const DENSITY_ORDER: WallDensity[] = ["auto", "compact", "cozy", "large"];

/**
 * 密度示意：方块排得越密，读数就是越紧凑。
 *
 * 原来的 S / M / L 三个字母要求读者先建立「字母 = 档位」的对应关系，
 * 而档位名（密集 / 标准 / 宽松）已经写在提示里；图形直接说出疏密。
 */
function DensityGlyph({ level }: { level: Exclude<WallDensity, "auto"> }) {
  const { cols, rows } = DENSITY_GRID[level];
  const cell = 16 / cols;
  const gap = 1.2;
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      aria-hidden="true"
      focusable="false"
    >
      {Array.from({ length: rows }).map((_, r) =>
        Array.from({ length: cols }).map((__, c) => (
          <rect
            key={`${r}-${c}`}
            x={c * cell}
            y={r * cell}
            width={cell - gap}
            height={cell - gap}
            rx={0.6}
            fill="currentColor"
          />
        )),
      )}
    </svg>
  );
}

/**
 * 自适应档位的示意：屏幕里几块大小不一。
 *
 * 手动档位用「方块多寡」说疏密，自适应没有固定疏密 —— 它跟着照片
 * 数量与视口变。画一块大小不一的版面，比再添一个疏密格子更贴切。
 */
function AutoDensityGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width={15}
      height={15}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        x={0.9}
        y={1.9}
        width={14.2}
        height={12.2}
        rx={2}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.1}
        opacity={0.55}
      />
      <rect
        x={2.8}
        y={3.6}
        width={5.8}
        height={8.8}
        rx={0.8}
        fill="currentColor"
      />
      <rect
        x={9.7}
        y={3.6}
        width={3.5}
        height={5.2}
        rx={0.8}
        fill="currentColor"
        opacity={0.6}
      />
    </svg>
  );
}

/**
 * 照片墙密度切换。
 *
 * 相册页与设置页是同一件事：改的是照片墙的疏密。用同一个控件，
 * 两处看到的是同一排图形、同一套措辞 —— 在设置里调完密度，回相册页
 * 不用再认一遍图标。
 */
export default function DensityControl({
  value,
  onChange,
  presentation = "inline",
}: {
  value: WallDensity;
  onChange: (next: WallDensity) => void;
  presentation?: "inline" | "popover";
}) {
  if (presentation === "popover") {
    return (
      <Popover
        aria-label="照片墙密度"
        trigger={
          <button
            type="button"
            className="toolbar-icon"
            aria-label="密度"
            title="照片墙密度"
          >
            {value === "auto" ? (
              <AutoDensityGlyph />
            ) : (
              <DensityGlyph level={value} />
            )}
          </button>
        }
      >
        {DENSITY_ORDER.map((key) => (
          <PopoverItem
            key={key}
            active={key === value}
            onClick={() => onChange(key)}
          >
            {key === "auto" ? (
              <AutoDensityGlyph />
            ) : (
              <DensityGlyph level={key} />
            )}
            {WALL_DENSITY_LABEL[key]}
          </PopoverItem>
        ))}
      </Popover>
    );
  }
  return (
    <Segmented
      compact
      label="照片墙密度"
      value={value}
      onChange={onChange}
      options={DENSITY_ORDER.map((key) => ({
        value: key,
        label:
          key === "auto" ? <AutoDensityGlyph /> : <DensityGlyph level={key} />,
        ariaLabel: WALL_DENSITY_LABEL[key],
        title: WALL_DENSITY_LABEL[key],
      }))}
    />
  );
}
