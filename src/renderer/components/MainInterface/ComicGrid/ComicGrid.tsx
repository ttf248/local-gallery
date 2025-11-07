import React from 'react'
import { Collection } from '@shared/interfaces'
import ComicCard from '../ComicCard/ComicCard'

interface ComicGridProps {
  collections: Collection[]
  favorites: Set<string>
  onComicClick?: (collection: Collection) => void
  onFavoriteClick?: (id: string) => void
  onReadClick?: (id: string) => void
  isLoading?: boolean
}

const ComicGrid: React.FC<ComicGridProps> = ({
  collections,
  favorites,
  onComicClick,
  onFavoriteClick,
  onReadClick,
  isLoading = false,
}) => {
  if (isLoading) {
    return (
      <div className="grid grid-cols-6 gap-5">
        {Array.from({ length: 12 }).map((_, index) => (
          <div
            key={index}
            className="minimal-card rounded-lg overflow-hidden animate-pulse"
          >
            <div className="aspect-[3/4] bg-minimal-gray"></div>
            <div className="p-4 space-y-2">
              <div className="h-4 bg-minimal-gray rounded w-3/4"></div>
              <div className="h-3 bg-minimal-gray rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    )
  }

  if (collections.length === 0) {
    return (
      <div className="col-span-6 flex flex-col items-center justify-center py-20">
        📄
        <p className="text-minimal-muted text-lg mb-2">还没有漫画</p>
        <p className="text-minimal-muted text-sm mb-4">
          点击"导入"按钮开始添加你的第一本漫画
        </p>
        <button className="px-6 py-2.5 bg-minimal-blue text-white rounded-md hover:bg-minimal-blue/90 transition text-sm font-medium">
          📄导入漫画
        </button>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-6 gap-5">
      {collections.map((collection) => (
        <ComicCard
          key={collection.id}
          collection={collection}
          isFavorite={favorites.has(collection.id)}
          onClick={() => onComicClick?.(collection)}
          onFavorite={onFavoriteClick}
          onRead={onReadClick}
        />
      ))}
    </div>
  )
}

export default ComicGrid
