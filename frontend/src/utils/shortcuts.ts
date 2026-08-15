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
  /** 所属分组（用于 HelpOverlay） */
  group?: 'global' | 'viewer' | 'album'
}

// 全局快捷键
export const SHORTCUTS: Shortcut[] = [
  { id: 'open', label: 'Ctrl+O', description: '打开/切换媒体根目录', combo: 'ctrl+o', group: 'global' },
  { id: 'scan', label: 'Ctrl+S', description: '启动扫描', combo: 'ctrl+s', group: 'global' },
  { id: 'refresh', label: 'F5', description: '刷新', combo: 'F5', group: 'global' },
  { id: 'home', label: 'Ctrl+H', description: '回到主页', combo: 'ctrl+h', group: 'global' },
  { id: 'recents', label: 'Ctrl+R', description: '最近访问', combo: 'ctrl+r', group: 'global' },
  { id: 'favorites', label: 'Ctrl+D', description: '我的收藏', combo: 'ctrl+d', group: 'global' },
  { id: 'settings', label: 'Ctrl+,', description: '设置', combo: 'ctrl+,', group: 'global' },
  { id: 'search', label: '/', description: '聚焦搜索', combo: '/', group: 'global' },
  { id: 'shuffle', label: 'R', description: '随机一本', combo: 'r', group: 'global' },
  { id: 'help', label: '?', description: '显示快捷键帮助', combo: 'shift+/', group: 'global' },
  // 查看器
  { id: 'next', label: '→ / PageDown', description: '下一张', combo: 'arrowright', group: 'viewer' },
  { id: 'prev', label: '← / PageUp', description: '上一张', combo: 'arrowleft', group: 'viewer' },
  { id: 'first', label: 'Home', description: '第一张', combo: 'Home', group: 'viewer' },
  { id: 'last', label: 'End', description: '最后一张', combo: 'End', group: 'viewer' },
  { id: 'gotoPage', label: 'G', description: '跳到指定页', combo: 'g', group: 'viewer' },
  { id: 'nextAlbum', label: 'N', description: '下一本（来自当前列表）', combo: 'n', group: 'viewer' },
  { id: 'prevAlbum', label: 'P', description: '上一本（来自当前列表）', combo: 'p', group: 'viewer' },
  { id: 'favorite', label: 'S', description: '收藏 / 取消收藏', combo: 's', group: 'viewer' },
  { id: 'mode1', label: '1', description: '显示模式：单张', combo: '1', group: 'viewer' },
  { id: 'mode2', label: '2', description: '显示模式：连续滚动', combo: '2', group: 'viewer' },
  { id: 'mode3', label: '3', description: '显示模式：双张并排', combo: '3', group: 'viewer' },
  { id: 'fit', label: 'F', description: '图片适配循环（适应→按宽→按高→原始）', combo: 'f', group: 'viewer' },
  { id: 'direction', label: 'L', description: '翻页方向（左→右 / 右→左）', combo: 'l', group: 'viewer' },
  { id: 'zoomIn', label: '+ / =', description: '放大', combo: '+', group: 'viewer' },
  { id: 'zoomOut', label: '-', description: '缩小', combo: '-', group: 'viewer' },
  { id: 'zoomReset', label: '0', description: '实际大小 / 重置', combo: '0', group: 'viewer' },
  { id: 'rotate', label: 'R', description: '旋转 90°', combo: 'r', group: 'viewer' },
  { id: 'fullscreen', label: 'F11', description: '全屏', combo: 'F11', group: 'viewer' },
  { id: 'slideshow', label: 'Space', description: '幻灯片播放/暂停', combo: 'space', group: 'viewer' },
  { id: 'info', label: 'I', description: '图片信息', combo: 'i', group: 'viewer' },
]

// 规范化按键名为可比较字符串：ctrl+a / shift+arrowleft / F5 / space
export function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')

  // 先归一特殊键名（+ / = / ? / 空格），再统一小写
  let k = e.key
  if (k === '?') k = '/'
  if (k === ' ') k = 'space'
  // shift+= 在大多数键盘产生 e.key === '+'；handler 表里只用 '+'，
  // 旧实现会拼出 "shift+" 命中不到。这里把 + / = 统一归一为 '+'，
  // 并丢掉 shift 前缀（让 `+` / `=` 都能命中 '+' handler）。
  const isPlus = k === '+' || k === '='
  if (isPlus) {
    k = '+'
  } else {
    k = k.toLowerCase()
    if (e.shiftKey) parts.push('shift')
  }
  parts.push(k)
  return parts.join('+')
}

