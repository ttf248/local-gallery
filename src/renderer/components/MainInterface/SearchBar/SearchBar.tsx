import React, { useState } from 'react'
import Input from '../../ui/Input/Input'
import Button from '../../ui/Button/Button'

interface SearchBarProps {
  onSearch?: (keyword: string) => void
  onFilterClick?: () => void
  onViewModeChange?: (mode: 'grid' | 'list') => void
  currentViewMode?: 'grid' | 'list'
}

const SearchBar: React.FC<SearchBarProps> = ({
  onSearch,
  onFilterClick,
  onViewModeChange,
  currentViewMode = 'grid',
}) => {
  const [keyword, setKeyword] = useState('')

  const handleSearch = () => {
    onSearch?.(keyword)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  return (
    <div className="mb-8 flex items-center space-x-3">
      {/* 搜索输入框 */}
      <div className="flex-1 relative">
        <Input
          placeholder="搜索漫画标题、作者..."
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyPress={handleKeyPress}
          className="w-full pl-10"
        />
        📄
      </div>

      {/* 筛选按钮 */}
      <Button
        variant="secondary"
        icon="🔽 mr-2 text-xs"
        onClick={onFilterClick}
      >
        筛选
      </Button>

      {/* 网格视图按钮 */}
      <Button
        variant={currentViewMode === 'grid' ? 'primary' : 'secondary'}
        icon="⊞ mr-2 text-xs"
        onClick={() => onViewModeChange?.('grid')}
      >
        网格
      </Button>

      {/* 列表视图按钮 */}
      <Button
        variant={currentViewMode === 'list' ? 'primary' : 'secondary'}
        icon="☰ mr-2 text-xs"
        onClick={() => onViewModeChange?.('list')}
      >
        列表
      </Button>
    </div>
  )
}

export default SearchBar
