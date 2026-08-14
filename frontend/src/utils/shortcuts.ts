// 快捷键定义。
// 单一来源：所有快捷键在此集中声明，UI/帮助文档共用。

export type ShortcutHandler = (e: KeyboardEvent) => void

export interface Shortcut {
  id: string
  /** 显示标签：用于 UI 列表 */
  label: string
  /** 描述：用于帮助浮层 */
  description: string
  /** 触发条件：包含 ctrl/alt/shift 等修饰键 */
  combo: string
}

// 全局快捷键（T9）
export const SHORTCUTS: Shortcut[] = [
  { id: 'open', label: 'Ctrl+O', description: '打开/切换漫画目录', combo: 'ctrl+o' },
  { id: 'scan', label: 'Ctrl+S', description: '启动扫描', combo: 'ctrl+s' },
  { id: 'refresh', label: 'F5', description: '刷新', combo: 'F5' },
  { id: 'home', label: 'Ctrl+H', description: '回到主页', combo: 'ctrl+h' },
  { id: 'recents', label: 'Ctrl+R', description: '最近访问', combo: 'ctrl+r' },
  { id: 'favorites', label: 'Ctrl+D', description: '我的收藏', combo: 'ctrl+d' },
  { id: 'settings', label: 'Ctrl+,', description: '设置', combo: 'ctrl+,' },
  { id: 'help', label: 'Ctrl+/', description: '显示快捷键帮助', combo: 'ctrl+/' },
  // 查看器（T11+）
  { id: 'next', label: '→', description: '下一张', combo: 'arrowright' },
  { id: 'prev', label: '←', description: '上一张', combo: 'arrowleft' },
  { id: 'first', label: 'Home', description: '第一张', combo: 'Home' },
  { id: 'last', label: 'End', description: '最后一张', combo: 'End' },
  { id: 'zoomIn', label: '+', description: '放大', combo: '+' },
  { id: 'zoomOut', label: '-', description: '缩小', combo: '-' },
  { id: 'zoomReset', label: '0', description: '实际大小', combo: '0' },
  { id: 'rotate', label: 'R', description: '旋转 90°', combo: 'r' },
  { id: 'fullscreen', label: 'F11', description: '全屏', combo: 'F11' },
  { id: 'slideshow', label: 'Space', description: '幻灯片播放/暂停', combo: 'space' },
  { id: 'info', label: 'I', description: '图片信息', combo: 'i' },
]

// 规范化按键名为可比较字符串：ctrl+a / shift+arrowleft / F5 / space
export function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.shiftKey) parts.push('shift')
  if (e.altKey) parts.push('alt')
  const k = e.key.toLowerCase()
  parts.push(k)
  return parts.join('+')
}
