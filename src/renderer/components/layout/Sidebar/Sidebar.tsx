import React from 'react'
import { NavigationItem } from '@shared/interfaces'

interface SidebarProps {
  activeItem?: string
  onNavigate?: (key: string) => void
  favoriteCount?: number
}

const Sidebar: React.FC<SidebarProps> = ({
  activeItem = 'myComics',
  onNavigate,
  favoriteCount = 0
}) => {
  const navigationItems: NavigationItem[] = [
    {
      key: 'myComics',
      icon: '📚',
      text: '我的漫画',
      active: activeItem === 'myComics',
    },
    {
      key: 'favorites',
      icon: '❤️',
      text: '收藏',
      count: favoriteCount,
      color: 'text-minimal-red',
      active: activeItem === 'favorites',
    },
    {
      key: 'history',
      icon: '🕐',
      text: '历史',
      color: 'text-minimal-blue',
      active: activeItem === 'history',
    },
    {
      key: 'categories',
      icon: '📁',
      text: '分类',
      color: 'text-minimal-green',
      active: activeItem === 'categories',
    },
    {
      key: 'importRecords',
      icon: '⬇️',
      text: '导入记录',
      color: 'text-minimal-muted',
      active: activeItem === 'importRecords',
    },
  ]

  const tags = [
    { text: '冒险', color: 'bg-minimal-blue/10 text-minimal-blue' },
    { text: '爱情', color: 'bg-minimal-green/10 text-minimal-green' },
    { text: '奇幻', color: 'bg-minimal-yellow/10 text-minimal-yellow' },
    { text: '科幻', color: 'bg-minimal-red/10 text-minimal-red' },
  ]

  return (
    <div className="w-64 bg-minimal-gray p-6 border-r border-minimal-border">
      {/* 导航菜单 */}
      <div className="space-y-1">
        <h2 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
          Navigation
        </h2>
        {navigationItems.map((item) => (
          <button
            key={item.key}
            className={`
              w-full text-left px-4 py-3 rounded-md flex items-center transition-all
              ${item.active
                ? 'bg-minimal-blue text-white'
                : 'hover:bg-white'
              }
            `}
            onClick={() => onNavigate?.(item.key)}
          >
            <span className="w-5 text-sm">{item.icon}</span>
            <span className="ml-3 text-sm font-medium">{item.text}</span>
            {item.count !== undefined && (
              <div className="ml-auto text-xs text-minimal-muted">
                {item.count}
              </div>
            )}
          </button>
        ))}
      </div>

      {/* 标签区域 */}
      <div className="mt-8 space-y-1">
        <h2 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
          Tags
        </h2>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <span
              key={tag.text}
              className={`px-3 py-1.5 rounded-full text-xs font-medium ${tag.color}`}
            >
              {tag.text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

export default Sidebar
