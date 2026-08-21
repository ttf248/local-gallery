// 时间线组件：主页核心导航。
//
// 设计目标：
//   - 通用：漫画 / 相册 都按「时间」作为第一导航轴
//   - 视觉：每个年份 = 一个大卡（大字年份 + 封面预览 + 统计）
//   - 交互：
//       * 主点击 → 单 album 年份：navigate 进 album 详情（"打开"动作）
//                 多 album 年份（含"其他"）：触发年份筛选 + 滚到下方"全部图像"
//       * 右上角小漏斗 → 显式切换年份筛选（不抢主点击，给已熟悉筛选语义的用户）
//   - 预览布局：
//       1 张封面 → 占满整区（避免"单 album 年份"出现 3 个空位像加载失败）
//       2-4 张 → 2x2 拼接
//       0 张 → 浅色占位（不显示"破损图片"图标）

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import type { RefObject } from 'react'
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
  /** "全部图像" section 的 ref；触发筛选后自动滚到那里。 */
  gridRef?: RefObject<HTMLDivElement>
}

export default function YearTimeline({ groups, gridRef }: Props) {
  if (groups.length === 0) return null

  return (
    <div className="px-6 lg:px-10 max-w-[1400px] mx-auto w-full">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {groups.map((g) => (
          <YearCard key={g.year ?? 'other'} group={g} gridRef={gridRef} />
        ))}
      </div>
    </div>
  )
}

function YearCard({
  group,
  gridRef,
}: {
  group: YearGroup
  gridRef?: RefObject<HTMLDivElement>
}) {
  const navigate = useNavigate()
  const yearFilter = useSearchStore((s) => s.yearFilter)
  const toggleYear = useSearchStore((s) => s.toggleYearFilter)

  const isOther = group.year === null
  const isActive = yearFilter === (group.year ?? 'other')
  // 过滤掉空 coverPath：年份只有 1 个 album 时只会有 1 个真实封面，
  // 2-4 个 album 时就有 2-4 张封面。
  const validCovers = useMemo(
    () => group.coverPreviewPaths.filter((p): p is string => !!p),
    [group.coverPreviewPaths],
  )
  const isSingle = validCovers.length === 1
  const isEmpty = validCovers.length === 0
  const canOpenDirectly = group.albums.length === 1

  // 触发年份筛选（不 navigate）+ 滚到下方"全部图像"区
  const triggerFilter = () => {
    toggleYear(group.year ?? 'other')
    // 下一帧再滚：React 状态更新 + DOM 重排后再 scrollIntoView
    requestAnimationFrame(() => {
      gridRef?.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  // 主点击：单 album → 直接打开；多 album → 触发筛选
  const onCardActivate = () => {
    if (canOpenDirectly) {
      navigate(group.albums[0].to)
    } else {
      triggerFilter()
    }
  }

  const onCardKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onCardActivate()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onCardActivate}
      onKeyDown={onCardKeyDown}
      aria-pressed={isActive}
      className={`group relative flex items-stretch rounded-xl border transition-all duration-200 overflow-hidden cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
        isActive
          ? 'border-accent bg-accent-soft/60 shadow-md'
          : 'border-border bg-bg-elevated hover:border-border-strong hover:shadow-md hover:-translate-y-0.5'
      }`}
    >
      {/* 左侧：大字年份 / 标签 */}
      <div className="flex flex-col justify-between p-5 sm:p-6 min-w-[150px] sm:min-w-[180px] shrink-0 border-r border-border-faint">
        <div
          className={`text-[11px] uppercase tracking-[0.18em] font-medium ${
            isActive ? 'text-accent' : 'text-fg-subtle'
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

      {/* 右侧：封面预览
         - 1 张：占满整区
         - 2-4 张：2x2
         - 0 张：浅色占位（不画"破损图片"图标） */}
      <div className="flex-1 min-w-0 p-4 sm:p-5 flex flex-col gap-3">
        {isEmpty ? (
          <div className="h-28 rounded-md bg-bg-subtle border border-border-faint" />
        ) : isSingle ? (
          <div className="h-28 rounded-md overflow-hidden bg-bg-subtle border border-border-faint">
            <img
              src={thumbUrl(validCovers[0])}
              alt=""
              loading="lazy"
              decoding="async"
              className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
            />
          </div>
        ) : (
          <div className="grid grid-cols-2 grid-rows-2 gap-1.5 h-28">
            {validCovers.slice(0, 4).map((p, i) => (
              <div
                key={i}
                className="rounded-md overflow-hidden bg-bg-subtle border border-border-faint"
              >
                <img
                  src={thumbUrl(p)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-300"
                />
              </div>
            ))}
          </div>
        )}

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
            <span>{canOpenDirectly ? '点击打开' : '点击查看'}</span>
          </span>
        </div>
      </div>

      {/* 筛选小按钮：右上角漏斗图标。
         只切换 yearFilter（不触发主点击，不导航）。给已熟悉筛选语义的用户用。 */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          triggerFilter()
        }}
        title={isActive ? '取消筛选' : '只筛选该年份'}
        aria-label={isActive ? '取消年份筛选' : '筛选该年份'}
        className={`absolute top-2.5 right-2.5 inline-flex items-center justify-center w-6 h-6 rounded-md backdrop-blur transition-colors ${
          isActive
            ? 'bg-accent text-accent-contrast'
            : 'bg-bg-elevated/80 text-fg-muted hover:text-fg hover:bg-bg-elevated'
        }`}
      >
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M3 6h18M7 12h10M10 18h4" />
        </svg>
      </button>
    </div>
  )
}

function formatNum(n: number): string {
  return n.toLocaleString('zh-CN')
}