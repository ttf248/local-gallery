import { VirtuosoGrid } from 'react-virtuoso'
import AlbumCard from './AlbumCard'
import { useState, type ReactNode } from 'react'
import ContextMenu, { type AnyMenuItem } from './ContextMenu'
import PropertiesDialog from '../common/PropertiesDialog'
import { useAlbumActions } from '../../hooks/useAlbumActions'
import { fsCapabilities } from '../../api/fs'

export interface GridItem {
  id: string
  title: string
  subtitle?: string
  count: number
  coverPath: string
  to: string
}

interface Props {
  items: GridItem[]
  empty?: ReactNode
}

// 网格：右键菜单 + 6 个动作。
// 卡片右键触发菜单：打开、收藏切换、资源管理器（受开关控制）、复制路径、属性。
export default function AlbumGrid({ items, empty }: Props) {
  const [menu, setMenu] = useState<{ x: number; y: number; item: GridItem } | null>(null)
  const [propsOpen, setPropsOpen] = useState(false)
  const [propsPath, setPropsPath] = useState<string | null>(null)

  if (items.length === 0) return <>{empty}</>

  const renderCard = (it: GridItem) => (
    <div
      key={it.id}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY, item: it })
      }}
    >
      <AlbumCard {...it} />
    </div>
  )

  return (
    <div>
      {items.length <= 100 ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
          {items.map(renderCard)}
        </div>
      ) : (
        <VirtuosoGrid
          useWindowScroll
          data={items}
          listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4"
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
}: {
  item: GridItem
  x: number
  y: number
  onClose: () => void
  onShowProperties: (path: string) => void
}) {
  const a = useAlbumActions(item, onShowProperties)
  const items: AnyMenuItem[] = [
    { id: 'open', label: '打开', icon: '📂' },
    { id: 'favorite', label: '收藏 / 取消收藏', icon: '★' },
    { id: 'sep1', separator: true } as AnyMenuItem,
    {
      id: 'explorer',
      label: '在资源管理器中打开',
      icon: '🗀',
      disabled: !fsCapabilities.allowOsOpen,
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
            a.toggleFavorite().catch(() => {})
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