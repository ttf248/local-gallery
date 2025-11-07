import React from 'react'
import Button from '../../ui/Button/Button'

interface TopBarProps {
  onSettingsClick?: () => void
  onImportClick?: () => void
}

const TopBar: React.FC<TopBarProps> = ({ onSettingsClick, onImportClick }) => {
  return (
    <div className="bg-white border-b border-minimal-border px-8 py-6 flex items-center justify-between">
      {/* Logo 区域 */}
      <div className="flex items-center space-x-5">
        <div className="w-10 h-10 bg-minimal-blue rounded-lg flex items-center justify-center text-white text-xl font-bold">
          📚
        </div>
        <div>
          <h1 className="text-2xl font-light text-minimal-text">漫画阅读器</h1>
          <p className="text-sm text-minimal-muted font-light">Discover Amazing Comics</p>
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center space-x-3">
        <Button
          variant="secondary"
          onClick={onSettingsClick}
        >
          ⚙️ 设置
        </Button>
        <Button
          variant="primary"
          onClick={onImportClick}
        >
          ➕ 导入
        </Button>
      </div>
    </div>
  )
}

export default TopBar
