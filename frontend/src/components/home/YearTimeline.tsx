// 时间线组件：主页核心导航。
//
// 设计目标：
//   - 通用：漫画 / 相册 都按「时间」作为第一导航轴
//   - 视觉：每个年份 = 一个大卡（大字年份 + 4 张封面拼接 + 统计）
//   - 交互：整张卡可点 → 切换/取消"年份筛选"，影响下方"全部图像"网格
//
// 渲染纯静态、纯展示，状态由父组件 Home 通过 useSearchStore 注入。

import { useMemo } from 'react'
import { thumbUrl } from '../../api/thumbs'
import { useSearchStore } from '../../store/searchStore'
import type { YearGroup } from '../../utils/albumGrouping'
import {
  PlayFilledIcon,
  ImageIcon,
  FolderIcon,
} from '../common/Icon'

interface Props {
  groups: YearGroup[]
}

export default function YearTimeline({ groups }: Props) {
  const yearFilter = useSearchStore((s) => s.yearFilter)
  const toggleYear = useSearchStore((s) => s.toggleYearFilter)

  if (groups.length === 0) return null

  return (
    <div className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((g) => (
          <YearCard
            key={g.year ?? 'other'}
            group={g}
            active={yearFilter === (g.year ?? 'other')}
            onToggle={() => toggleYear(g.year ?? 'other')}
          />
        ))}
      </div>
    </div>
  )
}

function YearCard({
  group,
  active,
  onToggle,
}: {
  group: YearGroup
  active: boolean
  onToggle: () => void
}) {
  const isOther = group.year === null
  // 拼接预览：从 coverPreviewPaths 取前 4 张作为 2x2 grid；
  // 不够 4 张时用占位填充，保持视觉稳定
  const tiles = useMemo(() => {
    const arr = group.coverPreviewPaths.slice(0, 4)
    while (arr.length < 4) arr.push('')
    return arr
  }, [group.coverPreviewPaths])

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={active}
      className={`group relative text-left flex items-stretch gap-0 rounded-xl border transition-all duration-200 overflow-hidden focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        active
          ? 'border-accent bg-accent-soft/60 shadow-md'
          : 'border-border bg-bg-elevated hover:border-border-strong hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      {/* 左侧：大字年份 / 标签 */}
      <div className="flex flex-col justify-between p-5 sm:p-6 min-w-[150px] sm:min-w-[180px] shrink-0 border-r border-border-faint">
        <div
          className={`text-[11px] uppercase tracking-[0.18em] font-medium ${
            active ? 'text-accent' : 'text-fg-subtle'
          }`}
        >
          {isOther ? '未分类' : '年份'}
        </div>
        <div className="flex flex-col gap-1">
          <div
            className={`font-display leading-none tracking-[-0.03em] tabular-nums ${
              isOther
                ? 'text-[20px] font-semibold text-fg'
                : 'text-[44px] sm:text-[52px] font-semibold text-fg'
            }`}
          >
            {group.label}
          </div>
          <div className="text-[11px] text-fg-subtle tabular-nums mt-1">
            {group.albums.length} 个文件夹
          </div>
        </div>
      </div>

      {/* 右侧：4 张封面拼接 (2x2)
         h-28 (112px) 强制高度，cells 配合 w-full/h-full + object-cover 自动等比裁剪，
         避免被 cover 自然尺寸（320x350）撑高导致整张年份卡过高。 */}
      <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3">
        <div className="grid grid-cols-2 grid-rows-2 gap-1.5 h-28">
          {tiles.map((p, i) => (
            <CoverTile key={i} path={p} />
          ))}
        </div>
        <div className="flex items-center gap-3 text-[11px] text-fg-muted tabular-nums">
          <span className="inline-flex items-center gap-1">
            <ImageIcon size={11} className="text-fg-subtle" />
            <span>{formatNum(group.imageTotal)} 张</span>
          </span>
          {group.videoTotal > 0 && (
            <span className="inline-flex items-center gap-1">
              <PlayFilledIcon size={9} className="text-accent" />
              <span>{formatNum(group.videoTotal)} 段</span>
            </span>
          )}
          <span className="ml-auto inline-flex items-center gap-1 text-fg-subtle">
            <FolderIcon size={11} />
            <span>点击筛选</span>
          </span>
        </div>
      </div>
    </button>
  )
}

function CoverTile({ path }: { path: string }) {
  if (!path) {
    return (
      <div className="rounded-md bg-bg-subtle border border-border-faint flex items-center justify-center text-fg-subtle/60">
        <ImageIcon size={14} />
      </div>
    )
  }
  return (
    <div className="rounded-md overflow-hidden bg-bg-subtle border border-border-faint">
      <img
        src={thumbUrl(path)}
        alt=""
        loading="lazy"
        decoding="async"
        className="w-full h-full object-cover"
      />
    </div>
  )
}

function formatNum(n: number): string {
  return n.toLocaleString('zh-CN')
}