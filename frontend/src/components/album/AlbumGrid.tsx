import { useState, type ReactNode } from 'react'
import AlbumCard, { type CardData } from './AlbumCard'
import ContextMenu, { type AnyMenuItem } from './ContextMenu'
import PropertiesDialog from '../common/PropertiesDialog'
import { useAlbumActions } from '../../hooks/useAlbumActions'
import { fsCapabilities } from '../../api/fs'
import { useFavorites } from '../../hooks/useFavorites'
import { decodeFavPath } from '../../utils/path'
import { useUIStore, type ViewMode } from '../../store/uiStore'
import {
  ArrowRightLineIcon,
  StarIcon,
  ArrowUpRightIcon,
  CopyIcon,
  InfoIcon,
} from '../common/Icon'

export type { CardData } from './AlbumCard'

interface Props {
  items: CardData[]
  empty?: ReactNode
  variant?: ViewMode
  /** 把「上次 X · 看到 Y/Z」显示在每张卡上（仅 Recents 列表传 true） */
  showLastSeen?: boolean
}

// 网格 / 列表容器。
// 列表视图下，悬停时显示右侧 chevron。
// 右键菜单统一：打开 / 收藏 / 资源管理器 / 复制路径 / 属性。
export default function AlbumGrid({ items, empty, variant = 'grid', showLastSeen }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: CardData } | null>(null)
  const [propsOpen, setPropsOpen] = useState(false)
  const [propsPath, setPropsPath] = useState<string | null>(null)
  const viewMode = useUIStore((s) => s.viewMode)
  const mode = variant ?? viewMode

  const { favorites, toggle } = useFavorites()

  if (items.length === 0) return <>{empty}</>

  const renderCard = (it: CardData) => {
    const favPath = it.variant === 'smart' ? `smart:${it.title}` : decodeFavPath(it.to)
    const isFav = favorites.includes(favPath)
    return (
      <div
        key={it.id}
        onContextMenu={(e) => {
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, item: it })
        }}
      >
        <AlbumCard data={{ ...it, isFavorite: isFav }} variant={mode} showLastSeen={showLastSeen} />
      </div>
    )
  }

  if (mode === 'list') {
    return (
      <div>
        <div className="px-6 lg:px-10 py-2 max-w-4xl">
          {items.map(renderCard)}
        </div>
        {menu && (
          <ContextMenuWrapper
            item={menu.item}
            x={menu.x}
            y={menu.y}
            onClose={() => setMenu(null)}
            onShowProperties={(p) => {
              setPropsPath(p)
              setPropsOpen(true)
            }}
            onToggleFavorite={() => {
              const favPath = menu.item.variant === 'smart' ? `smart:${menu.item.title}` : decodeFavPath(menu.item.to)
              toggle(favPath).catch(() => {})
            }}
            isFavorite={favorites.includes(
              menu.item.variant === 'smart'
                ? `smart:${menu.item.title}`
                : decodeFavPath(menu.item.to),
            )}
          />
        )}
        <PropertiesDialog
          open={propsOpen}
          absPath={propsPath}
          onClose={() => setPropsOpen(false)}
        />
      </div>
    )
  }

  return (
    <div>
      <div
        className="px-6 lg:px-10 pt-2 pb-10
          grid gap-x-5 gap-y-7
          grid-cols-2 sm:grid-cols-3 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6"
      >
        {items.map(renderCard)}
      </div>
      {menu && (
        <ContextMenuWrapper
          item={menu.item}
          x={menu.x}
          y={menu.y}
          onClose={() => setMenu(null)}
          onShowProperties={(p) => {
            setPropsPath(p)
            setPropsOpen(true)
          }}
          onToggleFavorite={() => {
            const favPath = menu.item.variant === 'smart' ? `smart:${menu.item.title}` : decodeFavPath(menu.item.to)
            toggle(favPath).catch(() => {})
          }}
          isFavorite={favorites.includes(
            menu.item.variant === 'smart'
              ? `smart:${menu.item.title}`
              : decodeFavPath(menu.item.to),
          )}
        />
      )}
      <PropertiesDialog
        open={propsOpen}
        absPath={propsPath}
        onClose={() => setPropsOpen(false)}
      />
    </div>
  )
}

function ContextMenuWrapper({
  item,
  x,
  y,
  onClose,
  onShowProperties,
  onToggleFavorite,
  isFavorite,
}: {
  item: CardData
  x: number
  y: number
  onClose: () => void
  onShowProperties: (path: string) => void
  onToggleFavorite: () => void
  isFavorite: boolean
}) {
  const a = useAlbumActions(item, onShowProperties)
  // 「属性」目前只支持 album(单张图元数据);collection 是文件夹、smart 是聚合,
  // 都不是 image,后端 GetImageInfo 会拒。disabled 让用户看到入口但点不动,
  // 比点了报错友好。
  const isAlbum = item.variant === 'album'
  const items: AnyMenuItem[] = [
    { id: 'open', label: '打开', icon: <ArrowRightLineIcon size={12} /> },
    {
      id: 'favorite',
      label: isFavorite ? '取消收藏' : '收藏',
      icon: <StarIcon size={12} />,
    },
    { id: 'sep1', separator: true } as AnyMenuItem,
    {
      id: 'explorer',
      label: '在资源管理器中打开',
      icon: <ArrowUpRightIcon size={12} />,
      disabled: !fsCapabilities.allowOsOpen || item.variant === 'smart',
    },
    { id: 'copy', label: '复制路径', icon: <CopyIcon size={12} /> },
    { id: 'sep2', separator: true } as AnyMenuItem,
    {
      id: 'properties',
      label: '属性',
      icon: <InfoIcon size={12} />,
      disabled: !isAlbum,
    },
  ]
  return (
    <ContextMenu
      x={x}
      y={y}
      items={items}
      onSelect={(id) => {
        switch (id) {
          case 'open':
            a.open()
            break
          case 'favorite':
            onToggleFavorite()
            break
          case 'explorer':
            a.openInExplorer().catch(() => {})
            break
          case 'copy':
            a.copyPath().catch(() => {})
            break
          case 'properties':
            a.showProperties()
            break
        }
        onClose()
      }}
      onClose={onClose}
    />
  )
}
