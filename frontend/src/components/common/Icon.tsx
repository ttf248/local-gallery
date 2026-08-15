// 内联 SVG 图标组件，统一尺寸与线宽。
// 命名沿用业内常规语义，可独立 import 使用。
import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & {
  size?: number | string
  strokeWidth?: number
}

function base({
  size = 18,
  strokeWidth = 1.6,
  ...rest
}: IconProps): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...rest,
  }
}

export const HomeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 11.5 12 4l9 7.5" />
    <path d="M5 10.5V20a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9.5" />
  </svg>
)

export const ClockIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)

export const StarIcon = (p: IconProps & { filled?: boolean }) => {
  const { filled, ...rest } = p
  return (
    <svg {...base(rest)}>
      <path
        d="M12 3.5l2.7 5.5 6 .9-4.3 4.2 1 6-5.4-2.8-5.4 2.8 1-6L3.3 9.9l6-.9L12 3.5z"
        fill={filled ? 'currentColor' : 'none'}
      />
    </svg>
  )
}

export const SettingsIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.16.74.27 1.09.36V21a2 2 0 0 1-2 2h-.09c-.36 0-.73-.2-1.09-.36z" />
  </svg>
)

export const SearchIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
)

export const ScanIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7V5a1 1 0 0 1 1-1h2" />
    <path d="M20 7V5a1 1 0 0 0-1-1h-2" />
    <path d="M4 17v2a1 1 0 0 0 1 1h2" />
    <path d="M20 17v2a1 1 0 0 1-1 1h-2" />
    <path d="M7 12h10" />
  </svg>
)

export const SunIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4l1.4-1.4M17 7l1.4-1.4" />
  </svg>
)

export const MoonIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
  </svg>
)

export const MonitorIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 17v4" />
  </svg>
)

export const FolderIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
  </svg>
)

export const ImageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="1.5" />
    <path d="m4 18 5-5 4 4 3-3 4 4" />
  </svg>
)

export const ChevronLeftIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m15 6-6 6 6 6" />
  </svg>
)

export const ChevronRightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m9 6 6 6-6 6" />
  </svg>
)

export const ChevronDownIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m6 9 6 6 6-6" />
  </svg>
)

export const PlusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
)

export const MinusIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M5 12h14" />
  </svg>
)

export const RefreshIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.4-4.1" />
    <path d="M3 12a9 9 0 0 1 16.4-4.4" />
    <path d="M21 4v5h-5M3 20v-5h5" />
  </svg>
)

export const PlayIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />
  </svg>
)

export const PauseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
    <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
  </svg>
)

export const FullscreenIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
  </svg>
)

export const InfoIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8h.01M11 12h1v4h1" />
  </svg>
)

export const HelpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.8.4-1 1-1 1.7" />
    <path d="M12 17h.01" />
  </svg>
)

export const CloseIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M6 6l12 12M18 6 6 18" />
  </svg>
)

export const MenuIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
)

export const HeartIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M20.8 8.6a5 5 0 0 0-7.8-.5L12 9.2l-1-1.1a5 5 0 1 0-7.1 7l1 1.1L12 21l7.1-5.8 1-1.1a5 5 0 0 0 .7-5.5z" />
  </svg>
)

export const ReaderIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 5a1 1 0 0 1 1-1h5v15H5a1 1 0 0 1-1-1V5z" />
    <path d="M20 5a1 1 0 0 0-1-1h-5v15h5a1 1 0 0 0 1-1V5z" />
  </svg>
)

export const FilterIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 5h18M6 12h12M10 19h4" />
  </svg>
)

export const RotateIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M3 12a9 9 0 0 1 15.5-6.3M21 12a9 9 0 0 1-15.5 6.3" />
    <path d="M18 3v4h-4M6 21v-4h4" />
  </svg>
)

export const TrashIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-13" />
  </svg>
)

export const LibraryIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 19V6a2 2 0 0 1 2-2h12v17H6a2 2 0 0 1-2-2z" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </svg>
)

export const GridIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
)

export const ListIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <line x1="8" y1="6" x2="20" y2="6" />
    <line x1="8" y1="12" x2="20" y2="12" />
    <line x1="8" y1="18" x2="20" y2="18" />
    <circle cx="4" cy="6" r="1" fill="currentColor" />
    <circle cx="4" cy="12" r="1" fill="currentColor" />
    <circle cx="4" cy="18" r="1" fill="currentColor" />
  </svg>
)

export const CheckIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m5 12 5 5L20 7" />
  </svg>
)

export const AlertIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M12 3 2 21h20L12 3z" />
    <path d="M12 10v5M12 18h.01" />
  </svg>
)

export const SortIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 4v16M3 8l4-4 4 4" />
    <path d="M17 20V4M21 16l-4 4-4-4" />
  </svg>
)

export const HeartFilledIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path
      d="M20.8 8.6a5 5 0 0 0-7.8-.5L12 9.2l-1-1.1a5 5 0 1 0-7.1 7l1 1.1L12 21l7.1-5.8 1-1.1a5 5 0 0 0 .7-5.5z"
      fill="currentColor"
      stroke="none"
    />
  </svg>
)

export const PlayFilledIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M7 5v14l12-7z" fill="currentColor" stroke="none" />
  </svg>
)

export const KeyboardIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="2" y="6" width="20" height="14" rx="2" />
    <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M8 17h8" />
  </svg>
)

export const ChevronUpIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="m18 15-6-6-6 6" />
  </svg>
)

export const ShuffleIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M16 3h5v5" />
    <path d="M4 20 21 3" />
    <path d="M21 16v5h-5" />
    <path d="m15 15 6 6" />
    <path d="M4 4l5 5" />
  </svg>
)

/** 单页：单页居中 */
export const SinglePageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="4" width="12" height="16" rx="1" />
  </svg>
)

/** 连续滚动：垂直堆叠的多页 */
export const ScrollPageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="6" y="3" width="12" height="5" rx="1" />
    <rect x="6" y="10" width="12" height="5" rx="1" />
    <rect x="6" y="17" width="12" height="4" rx="1" />
  </svg>
)

/** 双页：左右并排 */
export const DoublePageIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <rect x="3" y="4" width="8" height="16" rx="1" />
    <rect x="13" y="4" width="8" height="16" rx="1" />
  </svg>
)

/** 适应：contain 缩放 */
export const FitIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    <path d="M9 9h6v6H9z" />
  </svg>
)

/** 按宽：w-100% */
export const FitWidthIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    <path d="M9 8h6v8H9z" />
  </svg>
)

/** 按高：h-100vh */
export const FitHeightIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    <path d="M7 9h10v6H7z" />
  </svg>
)

/** 原始：1:1 */
export const OriginalSizeIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 9V5a1 1 0 0 1 1-1h4M20 9V5a1 1 0 0 0-1-1h-4M4 15v4a1 1 0 0 0 1 1h4M20 15v4a1 1 0 0 1-1 1h-4" />
    <text x="12" y="14" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none">1:1</text>
  </svg>
)

/** 从左到右 */
export const ArrowRightLineIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12h16" />
    <path d="m14 6 6 6-6 6" />
  </svg>
)

/** 从右到左（原版日漫等） */
export const ArrowLeftLineIcon = (p: IconProps) => (
  <svg {...base(p)}>
    <path d="M4 12h16" />
    <path d="m10 6-6 6 6 6" />
  </svg>
)
