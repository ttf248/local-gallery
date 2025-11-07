import React, { useState } from 'react'
import Button from '../ui/Button/Button'
import Input from '../ui/Input/Input'

interface SettingsInterfaceProps {
  onClose?: () => void
}

const SettingsInterface: React.FC<SettingsInterfaceProps> = ({ onClose }) => {
  const [_activeSection, setActiveSection] = useState('reading')

  const settingsNav = [
    { key: 'reading', icon: 'fas fa-book', text: '阅读设置', active: true },
    { key: 'display', icon: 'fas fa-desktop', text: '显示设置', active: false },
    { key: 'shortcuts', icon: 'fas fa-keyboard', text: '快捷键', active: false },
    { key: 'storage', icon: 'fas fa-hdd', text: '存储设置', active: false },
    { key: 'notification', icon: 'fas fa-bell', text: '通知设置', active: false },
    { key: 'about', icon: 'fas fa-info-circle', text: '关于', active: false },
  ]

  return (
    <div className="flex bg-white">
      {/* 左侧设置导航 */}
      <div className="w-64 bg-minimal-gray p-6 border-r border-minimal-border">
        <div className="space-y-1">
          <h2 className="text-xs font-medium text-minimal-muted uppercase tracking-wider mb-3">
            Settings
          </h2>
          {settingsNav.map((item) => (
            <button
              key={item.key}
              className={`
                w-full text-left px-4 py-3 rounded-md flex items-center transition
                ${item.active
                  ? 'bg-minimal-blue text-white'
                  : 'hover:bg-white'
                }
              `}
              onClick={() => setActiveSection(item.key)}
            >
              <i className={`${item.icon} w-5 text-sm`}></i>
              <span className="ml-3 text-sm font-medium">{item.text}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 右侧设置内容 */}
      <div className="flex-1 p-8">
        <h2 className="text-lg font-light text-minimal-text mb-6 flex items-center">
          <i className="fas fa-book mr-2 text-minimal-blue text-sm"></i>阅读设置
        </h2>

        <div className="space-y-6">
          {/* 翻页设置 */}
          <div className="bg-minimal-gray rounded-lg p-6">
            <h3 className="text-sm font-medium text-minimal-text mb-4 flex items-center">
              <i className="fas fa-exchange-alt mr-2 text-minimal-blue text-xs"></i>翻页设置
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-minimal-muted uppercase tracking-wider mb-2">
                  翻页方向
                </label>
                <div className="flex space-x-3">
                  <label className="flex-1 p-4 bg-white border border-minimal-border rounded-md cursor-pointer hover:border-minimal-blue transition group">
                    <input type="radio" name="pageDirection" className="w-4 h-4 mr-3 text-minimal-blue" defaultChecked />
                    <div>
                      <div className="text-sm font-medium text-minimal-text group-hover:text-minimal-blue">从右到左</div>
                      <div className="text-xs text-minimal-muted mt-1">点击右侧翻到下一页</div>
                    </div>
                  </label>
                  <label className="flex-1 p-4 bg-white border border-minimal-border rounded-md cursor-pointer hover:border-minimal-blue transition group">
                    <input type="radio" name="pageDirection" className="w-4 h-4 mr-3 text-minimal-blue" />
                    <div>
                      <div className="text-sm font-medium text-minimal-text group-hover:text-minimal-blue">从左到右</div>
                      <div className="text-xs text-minimal-muted mt-1">点击左侧翻到下一页</div>
                    </div>
                  </label>
                </div>
              </div>

              <label className="flex items-center p-3 bg-white border border-minimal-border rounded-md hover:border-minimal-blue cursor-pointer transition">
                <input type="checkbox" className="w-4 h-4 mr-3 text-minimal-blue" defaultChecked />
                <span className="text-sm text-minimal-text">使用鼠标滚轮翻页</span>
              </label>

              <label className="flex items-center p-3 bg-white border border-minimal-border rounded-md hover:border-minimal-blue cursor-pointer transition">
                <input type="checkbox" className="w-4 h-4 mr-3 text-minimal-blue" defaultChecked />
                <span className="text-sm text-minimal-text">启用页面过渡动画</span>
              </label>
            </div>
          </div>

          {/* 缩放设置 */}
          <div className="bg-minimal-gray rounded-lg p-6">
            <h3 className="text-sm font-medium text-minimal-text mb-4 flex items-center">
              <i className="fas fa-search mr-2 text-minimal-blue text-xs"></i>缩放设置
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-minimal-muted uppercase tracking-wider mb-2">
                  默认缩放模式
                </label>
                <select className="w-full px-4 py-2 bg-white border border-minimal-border rounded-md focus:input-focus text-sm">
                  <option>适应宽度</option>
                  <option>适应高度</option>
                  <option>实际大小</option>
                  <option>自定义比例</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-minimal-muted uppercase tracking-wider mb-2">
                  缩放灵敏度
                </label>
                <input
                  type="range"
                  min="10"
                  max="100"
                  defaultValue="50"
                  className="w-full accent-minimal-blue"
                />
                <div className="flex justify-between text-xs text-minimal-muted mt-1">
                  <span>低</span>
                  <span>中</span>
                  <span>高</span>
                </div>
              </div>
            </div>
          </div>

          {/* 快捷键设置 */}
          <div className="bg-minimal-gray rounded-lg p-6">
            <h3 className="text-sm font-medium text-minimal-text mb-4 flex items-center">
              <i className="fas fa-keyboard mr-2 text-minimal-green text-xs"></i>快捷键设置
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { text: '上一页', keys: ['←', 'A'] },
                  { text: '下一页', keys: ['→', 'D'] },
                  { text: '放大', keys: ['+'] },
                  { text: '缩小', keys: ['-'] },
                  { text: '适应宽度', keys: ['F'] },
                  { text: '全屏', keys: ['F11'] },
                ].map((item) => (
                  <div key={item.text} className="flex items-center justify-between p-3 bg-white border border-minimal-border rounded-md">
                    <span className="text-sm text-minimal-muted">{item.text}</span>
                    <div className="flex items-center space-x-1.5">
                      {item.keys.map((key) => (
                        <React.Fragment key={key}>
                          <kbd className="px-2 py-1 bg-minimal-gray text-xs text-minimal-blue">{key}</kbd>
                          {item.keys.indexOf(key) < item.keys.length - 1 && (
                            <span className="text-xs text-minimal-muted">或</span>
                          )}
                        </React.Fragment>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 自动阅读 */}
          <div className="bg-minimal-gray rounded-lg p-6">
            <h3 className="text-sm font-medium text-minimal-text mb-4 flex items-center">
              <i className="fas fa-play-circle mr-2 text-minimal-green text-xs"></i>自动阅读
            </h3>
            <div className="space-y-4">
              <label className="flex items-center p-3 bg-white border border-minimal-border rounded-md hover:border-minimal-blue cursor-pointer transition">
                <input type="checkbox" className="w-4 h-4 mr-3 text-minimal-blue" />
                <span className="text-sm text-minimal-text">启用自动阅读</span>
              </label>
              <div>
                <label className="block text-xs font-medium text-minimal-muted uppercase tracking-wider mb-2">
                  翻页间隔（秒）
                </label>
                <Input
                  type="number"
                  value="3"
                  min="1"
                  max="10"
                  className="w-24 px-3 py-2 bg-white border border-minimal-border rounded-md focus:input-focus text-sm"
                />
              </div>
            </div>
          </div>
        </div>

        {/* 底部操作按钮 */}
        <div className="mt-8 flex items-center space-x-3">
          <Button variant="primary" icon="fas fa-save mr-2">
            保存设置
          </Button>
          <Button variant="secondary" icon="fas fa-undo mr-2">
            恢复默认
          </Button>
        </div>
      </div>
    </div>
  )
}

export default SettingsInterface
