import React, { useState } from 'react'
import { Collection, Chapter } from '@shared/interfaces'

interface ReaderInterfaceProps {
  collection: Collection
  chapter: Chapter
  onClose: () => void
  onNextPage: () => void
  onPrevPage: () => void
  onNextChapter: () => void
  onPrevChapter: () => void
}

const ReaderInterface: React.FC<ReaderInterfaceProps> = ({
  collection,
  chapter,
  onClose,
  onNextPage,
  onPrevPage,
  onNextChapter,
  onPrevChapter,
}) => {
  const [currentPage, _setCurrentPage] = useState(0)

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col">
      {/* 顶部工具栏 */}
      <div className="bg-white border-b border-minimal-border px-8 py-4 flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <button
            className="px-4 py-2 text-minimal-muted hover:text-minimal-blue hover:bg-minimal-gray rounded-md transition"
            onClick={onClose}
          >
            📄返回
          </button>
          <h2 className="text-sm font-medium text-minimal-text">
            {collection.name} - {chapter.title}
          </h2>
        </div>
        <div className="flex items-center space-x-3">
          <button className="px-4 py-2 text-minimal-muted hover:text-minimal-blue hover:bg-minimal-gray rounded-md transition">
            📄设置
          </button>
          <button className="px-4 py-2 bg-minimal-blue text-white rounded-md hover:bg-minimal-blue/90 transition">
            📄全屏
          </button>
        </div>
      </div>

      {/* 阅读区域 */}
      <div className="flex-1 flex items-center justify-center relative">
        <div className="max-w-4xl w-full px-6">
          <div className="aspect-[3/4] bg-minimal-gray rounded-lg flex items-center justify-center mb-4 border border-minimal-border">
            📄
          </div>
        </div>

        {/* 悬浮控制按钮 - 左 */}
        <button
          className="absolute left-6 top-1/2 transform -translate-y-1/2 w-12 h-12 bg-white border border-minimal-border hover:border-minimal-blue rounded-full flex items-center justify-center transition"
          onClick={onPrevPage}
        >
          📄
        </button>

        {/* 悬浮控制按钮 - 右 */}
        <button
          className="absolute right-6 top-1/2 transform -translate-y-1/2 w-12 h-12 bg-white border border-minimal-border hover:border-minimal-blue rounded-full flex items-center justify-center transition"
          onClick={onNextPage}
        >
          📄
        </button>
      </div>

      {/* 底部工具栏 */}
      <div className="bg-white border-t border-minimal-border px-8 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue text-minimal-muted hover:text-minimal-blue transition"
              onClick={onPrevPage}
            >
              📄
            </button>
            <span className="text-xs text-minimal-muted">
              第 {currentPage + 1} 页 / 共 {chapter.totalPages} 页
            </span>
            <button
              className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue text-minimal-muted hover:text-minimal-blue transition"
              onClick={onNextPage}
            >
              📄
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <button className="px-4 py-2 text-minimal-muted hover:text-minimal-blue transition text-sm flex items-center">
              📄缩小
            </button>
            <button className="px-4 py-2 bg-minimal-blue text-white rounded-md text-sm flex items-center">
              📄适应宽度
            </button>
            <button className="px-4 py-2 text-minimal-muted hover:text-minimal-blue transition text-sm flex items-center">
              📄放大
            </button>
          </div>

          <div className="flex items-center space-x-3">
            <button className="px-4 py-2 text-minimal-muted hover:text-minimal-blue transition text-sm flex items-center">
              📄章节
            </button>
            <div className="w-32 bg-minimal-gray rounded-full h-1.5">
              <div
                className="bg-minimal-blue h-1.5 rounded-full"
                style={{ width: `${((currentPage + 1) / chapter.totalPages) * 100}%` }}
              ></div>
            </div>
            <span className="text-xs text-minimal-muted">
              {Math.round(((currentPage + 1) / chapter.totalPages) * 100)}%
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default ReaderInterface
