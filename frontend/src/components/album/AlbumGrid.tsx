import { VirtuosoGrid } from 'react-virtuoso'
import AlbumCard from './AlbumCard'
import type { ReactNode } from 'react'

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

// 虚拟网格：>100 项时启用虚拟滚动，否则直接渲染以避免过度工程。
export default function AlbumGrid({ items, empty }: Props) {
  if (items.length === 0) {
    return <>{empty}</>
  }

  if (items.length <= 100) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4">
        {items.map((it) => (
          <AlbumCard key={it.id} {...it} />
        ))}
      </div>
    )
  }

  return (
    <VirtuosoGrid
      useWindowScroll
      data={items}
      listClassName="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 p-4"
      itemContent={(_, it) => <AlbumCard key={it.id} {...it} />}
    />
  )
}
