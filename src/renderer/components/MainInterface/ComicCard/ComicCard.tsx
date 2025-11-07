import React from 'react'
import { Collection } from '@shared/interfaces'

interface ComicCardProps {
  collection: Collection
  isFavorite?: boolean
  onClick?: () => void
  onFavorite?: (id: string) => void
  onRead?: (id: string) => void
}

const ComicCard: React.FC<ComicCardProps> = ({
  collection,
  isFavorite = false,
  onClick,
  onFavorite,
  onRead,
}) => {
  return (
    <div
      className="minimal-card rounded-lg overflow-hidden cursor-pointer"
      onClick={onClick}
    >
      {/* 封面区域 */}
      <div className="aspect-[3/4] bg-minimal-gray flex items-center justify-center relative group">
        <i className="fas fa-image text-5xl text-minimal-muted/30"></i>
        <div className="absolute top-2 right-2 bg-white/90 px-2 py-1 rounded text-xs text-minimal-muted">
          {collection.totalChapters}集
        </div>
      </div>

      {/* 内容区域 */}
      <div className="p-4">
        {/* 标题 */}
        <h3 className="font-medium text-sm mb-1 text-minimal-text truncate">
          {collection.name}
        </h3>

        {/* 作者 */}
        <p className="text-xs text-minimal-muted mb-2 font-light">
          {collection.author}
        </p>

        {/* 底部操作区 */}
        <div className="flex items-center justify-between">
          {/* 评分 */}
          <div className="flex items-center space-x-1">
            <i className="fas fa-star text-xs text-minimal-yellow"></i>
            <span className="text-xs text-minimal-muted">
              {collection.rating}
            </span>
          </div>

          {/* 操作按钮 */}
          <div className="flex space-x-2">
            {/* 收藏按钮 */}
            <button
              className="text-minimal-red hover:text-minimal-red/70 text-sm"
              onClick={(e) => {
                e.stopPropagation()
                onFavorite?.(collection.id)
              }}
            >
              <i className={isFavorite ? 'fas fa-heart' : 'far fa-heart'}></i>
            </button>

            {/* 阅读按钮 */}
            <button
              className="text-minimal-blue hover:text-minimal-blue/70 text-sm"
              onClick={(e) => {
                e.stopPropagation()
                onRead?.(collection.id)
              }}
            >
              <i className="fas fa-play"></i>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ComicCard
