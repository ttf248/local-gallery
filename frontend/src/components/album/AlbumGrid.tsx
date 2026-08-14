import { VirtuosoGrid } from 'react-virtuoso'
import AlbumCard, { type CardData } from './AlbumCard'
import { useState, type ReactNode } from 'react'
import ContextMenu, { type AnyMenuItem } from './ContextMenu'
import PropertiesDialog from '../common/PropertiesDialog'
import { useAlbumActions } from '../../hooks/useAlbumActions'
import { fsCapabilities } from '../../api/fs'
import { useFavorites } from '../../hooks/useFavorites'
import { decodeFavPath } from '../../utils/path'

export type { CardData } from './AlbumCard'

interface Props {
  items: CardData[]
  empty?: ReactNode
}

// 网格：右键菜单 + 6 个动作。
// 卡片右键触发菜单：打开、收藏切换、资源管理器（受开关控制）、复制路径、属性。
export default function AlbumGrid({ items, empty }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: CardData } | null>(null)
  const [propsOpen, setPropsOpen] = useState(false)
  const [propsPath, setPropsPath] = useState<string | null>(null)

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
        <AlbumCard data={{ ...it, isFavorite: isFav }} />
      </div>
    )
  }

  return (
    <div>
      {items.length <= 100 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-6">
          {items.map(renderCard)}
        </div>
      ) : (
        <VirtuosoGrid
          useWindowScroll
          data={items}
          listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 p-6"
          itemContent={(_, it) => renderCard(it)}
        />
      )}

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
  const items: AnyMenuItem[] = [
    { id: 'open', label: '打开', icon: '📂' },
    {
      id: 'favorite',
      label: isFavorite ? '取消收藏' : '收藏',
      icon: '★',
    },
    { id: 'sep1', separator: true } as AnyMenuItem,
    {
      id: 'explorer',
      label: '在资源管理器中打开',
      icon: '🗀',
      disabled: !fsCapabilities.allowOsOpen || item.variant === 'smart',
    },
    { id: 'copy', label: '复制路径', icon: '📋' },
    { id: 'sep2', separator: true } as AnyMenuItem,
    { id: 'properties', label: '属性', icon: 'ⓘ' },
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
