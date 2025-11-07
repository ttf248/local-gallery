import React, { useState } from 'react'
import Input from '../ui/Input/Input'
import Button from '../ui/Button/Button'
import { FilterCriteria, Collection } from '@shared/interfaces'

interface SearchInterfaceProps {
  collections: Collection[]
  favorites?: Set<string>
  onCollectionClick: (collection: Collection) => void
  onFavoriteClick?: (id: string) => void
}

const SearchInterface: React.FC<SearchInterfaceProps> = ({
  collections,
  onCollectionClick,
}) => {
  const [searchKeyword, setSearchKeyword] = useState('')
  const [filter, setFilter] = useState<FilterCriteria>({})

  return (
    <div className="flex bg-white">
      {/* 左侧筛选面板 */}
      <div className="w-72 bg-minimal-gray p-6 border-r border-minimal-border">
        <h2 className="text-sm font-medium text-minimal-text mb-5 flex items-center">
          <i className="fas fa-_filter mr-2 text-minimal-blue text-sm"></i>筛选条件
        </h2>

        <div className="space-y-6">
          {/* 阅读状态筛选 */}
          <div>
            <h3 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              阅读状态
            </h3>
            <div className="space-y-2">
              {['全部', '未开始', '阅读中', '已完结'].map((status) => (
                <label
                  key={status}
                  className="flex items-center p-2 hover:bg-white rounded-md cursor-pointer transition"
                >
                  <input
                    type="checkbox"
                    className="w-4 h-4 mr-3 text-minimal-blue"
                    defaultChecked={status === '全部'}
                  />
                  <span className="text-sm text-minimal-text">{status}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 评分筛选 */}
          <div>
            <h3 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              评分
            </h3>
            <div className="space-y-2">
              {['全部', '9分以上', '8分以上', '7分以上'].map((rating) => (
                <label
                  key={rating}
                  className="flex items-center p-2 hover:bg-white rounded-md cursor-pointer transition"
                >
                  <input
                    type="radio"
                    name="rating"
                    className="w-4 h-4 mr-3 text-minimal-blue"
                    defaultChecked={rating === '全部'}
                  />
                  <span className="text-sm text-minimal-text">{rating}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 标签筛选 */}
          <div>
            <h3 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              标签
            </h3>
            <div className="flex flex-wrap gap-2">
              {['冒险', '爱情', '奇幻', '科幻', '校园', '职场'].map((tag) => (
                <label
                  key={tag}
                  className="flex items-center px-3 py-1.5 bg-white border border-minimal-border rounded-full cursor-pointer hover:border-minimal-blue transition"
                >
                  <input type="checkbox" className="w-3 h-3 mr-2 text-minimal-blue" />
                  <span className="text-xs text-minimal-text">{tag}</span>
                </label>
              ))}
            </div>
          </div>

          {/* 页数范围 */}
          <div>
            <h3 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
              页数范围
            </h3>
            <div className="space-y-3">
              <div className="flex items-center space-x-2">
                <Input
                  type="number"
                  placeholder="最小"
                  className="w-full px-3 py-2 border border-minimal-border rounded-md text-sm"
                />
                <span className="text-minimal-muted">-</span>
                <Input
                  type="number"
                  placeholder="最大"
                  className="w-full px-3 py-2 border border-minimal-border rounded-md text-sm"
                />
              </div>
              <input
                type="range"
                min="0"
                max="500"
                defaultValue="200"
                className="w-full accent-minimal-blue"
              />
            </div>
          </div>

          <Button
            variant="primary"
            className="w-full"
            icon="fas fa-check mr-2"
          >
            应用筛选
          </Button>
          <Button
            variant="secondary"
            className="w-full"
            icon="fas fa-undo mr-2"
          >
            重置
          </Button>
        </div>
      </div>

      {/* 右侧结果区域 */}
      <div className="flex-1 p-8">
        {/* 搜索栏 */}
        <div className="mb-8">
          <div className="flex space-x-3">
            <div className="flex-1 relative">
              <Input
                placeholder="搜索漫画标题、作者..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                className="w-full px-5 py-3 pl-12"
              />
              <i className="fas fa-search absolute left-4 top-1/2 transform -translate-y-1/2 text-minimal-muted text-sm"></i>
            </div>
            <Button variant="primary" className="px-6 py-3">
              搜索
            </Button>
          </div>
        </div>

        {/* 排序选项 */}
        <div className="mb-8 flex items-center justify-between">
          <p className="text-sm text-minimal-muted">
            找到 <span className="font-medium text-minimal-blue">156</span> 部漫画
          </p>
          <div className="flex items-center space-x-2">
            <span className="text-sm text-minimal-muted">排序方式：</span>
            <select className="px-3 py-2 border border-minimal-border rounded-md focus:input-focus text-sm">
              <option>相关性</option>
              <option>最新更新</option>
              <option>评分最高</option>
              <option>页数最多</option>
            </select>
          </div>
        </div>

        {/* 搜索结果网格 */}
        <div className="grid grid-cols-6 gap-5">
          {collections.map((collection) => (
            <div
              key={collection.id}
              className="minimal-card rounded-lg overflow-hidden cursor-pointer"
              onClick={() => onCollectionClick(collection)}
            >
              <div className="aspect-[3/4] bg-minimal-gray flex items-center justify-center relative">
                <i className="fas fa-image text-5xl text-minimal-muted/30"></i>
                <div className="absolute top-2 right-2 bg-white/90 px-2 py-1 rounded text-xs text-minimal-muted">
                  {collection.totalChapters}集
                </div>
              </div>
              <div className="p-4">
                <h3 className="font-medium text-sm mb-1 text-minimal-text truncate">
                  {collection.name}
                </h3>
                <p className="text-xs text-minimal-muted mb-2 font-light">
                  {collection.author}
                </p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-1">
                    <i className="fas fa-star text-xs text-minimal-yellow"></i>
                    <span className="text-xs text-minimal-muted">
                      {collection.rating}
                    </span>
                  </div>
                  <span className="text-xs text-minimal-muted">匹配度: 95%</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* 分页 */}
        <div className="mt-8 flex items-center justify-center space-x-2">
          <button className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue transition">
            <i className="fas fa-chevron-left text-minimal-blue text-sm"></i>
          </button>
          <button className="px-4 py-2 bg-minimal-blue text-white rounded-md">1</button>
          <button className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue transition">2</button>
          <button className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue transition">3</button>
          <span className="px-2 text-minimal-muted text-sm">...</span>
          <button className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue transition">15</button>
          <button className="px-4 py-2 border border-minimal-border rounded-md hover:border-minimal-blue transition">
            <i className="fas fa-chevron-right text-minimal-blue text-sm"></i>
          </button>
        </div>
      </div>
    </div>
  )
}

export default SearchInterface
