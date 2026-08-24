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
  group?: 'global' | 'gallery' | 'album'
}

// 全局快捷键
// 注意：列表必须与实际注册的处理函数保持一致（Toolbar/AppShell/Gallery）。
// HelpOverlay 直接消费此表作为单一事实来源。
export const SHORTCUTS: Shortcut[] = [
  { id: 'sidebar', label: 'Ctrl+B', description: '折叠/展开侧边栏', combo: 'ctrl+b', group: 'global' },
  { id: 'home', label: 'Ctrl+H', description: '回到主页', combo: 'ctrl+h', group: 'global' },
  { id: 'recents', label: 'Ctrl+R', description: '最近访问', combo: 'ctrl+r', group: 'global' },
  { id: 'favorites', label: 'Ctrl+D', description: '我的收藏', combo: 'ctrl+d', group: 'global' },
  { id: 'settings', label: 'Ctrl+,', description: '设置', combo: 'ctrl+,', group: 'global' },
  { id: 'scan', label: 'Ctrl+S', description: '重新扫描', combo: 'ctrl+s', group: 'global' },
  { id: 'search', label: '/', description: '聚焦搜索框', combo: '/', group: 'global' },
  { id: 'shuffle', label: 'R', description: '随机一本（仅非画廊）', combo: 'r', group: 'global' },
  { id: 'help', label: '?', description: '显示快捷键帮助', combo: '?', group: 'global' },
  // 画廊
  { id: 'next', label: '→ / PageDown', description: '下一张', combo: 'arrowright', group: 'gallery' },
  { id: 'prev', label: '← / PageUp', description: '上一张', combo: 'arrowleft', group: 'gallery' },
  { id: 'first', label: 'Home', description: '第一张', combo: 'home', group: 'gallery' },
  { id: 'last', label: 'End', description: '最后一张', combo: 'end', group: 'gallery' },
  { id: 'nextAlbum', label: 'N', description: '下一本（来自当前列表）', combo: 'n', group: 'gallery' },
  { id: 'prevAlbum', label: 'P', description: '上一本（来自当前列表）', combo: 'p', group: 'gallery' },
  { id: 'gotoPage', label: 'G', description: '跳到指定页（输入数字回车）', combo: 'g', group: 'gallery' },
  { id: 'favorite', label: 'S', description: '收藏 / 取消收藏', combo: 's', group: 'gallery' },
  { id: 'mode1', label: '1', description: '显示模式：单张', combo: '1', group: 'gallery' },
  { id: 'mode2', label: '2', description: '显示模式：连续滚动', combo: '2', group: 'gallery' },
  { id: 'mode3', label: '3', description: '显示模式：双张并排', combo: '3', group: 'gallery' },
  { id: 'fit', label: 'F', description: '图片适配循环（适应→按宽→按高→原始）', combo: 'f', group: 'gallery' },
  { id: 'direction', label: 'L', description: '翻页方向（左→右 / 右→左）', combo: 'l', group: 'gallery' },
  { id: 'zoomIn', label: '+ / =', description: '放大', combo: '+', group: 'gallery' },
  { id: 'zoomOut', label: '-', description: '缩小', combo: '-', group: 'gallery' },
  { id: 'zoomReset', label: '0', description: '实际大小 / 重置', combo: '0', group: 'gallery' },
  { id: 'rotate', label: 'R', description: '旋转 90°（仅画廊）', combo: 'r', group: 'gallery' },
  { id: 'fullscreen', label: 'F11', description: '全屏', combo: 'f11', group: 'gallery' },
  { id: 'slideshow', label: 'Space', description: '幻灯片播放/暂停', combo: 'space', group: 'gallery' },
  { id: 'info', label: 'I', description: '图片信息', combo: 'i', group: 'gallery' },
  { id: 'escape', label: 'Esc', description: '关闭浮层 / 退出画廊', combo: 'escape', group: 'gallery' },
]

// 规范化按键名为可比较字符串：ctrl+a / shift+arrowleft / F5 / space
export function normalizeKey(e: KeyboardEvent): string {
  const parts: string[] = []
  if (e.ctrlKey || e.metaKey) parts.push('ctrl')
  if (e.altKey) parts.push('alt')

  // 先归一特殊键名（+ / = / ? / 空格），再统一小写
  let k = e.key
  // `?` 在 US 布局上是 Shift+/，但 AZERTY/QWERTZ 等布局可能是独立键。
  // 把它视作字面字符注册，忽略 shift 前缀；这样两种布局都能命中。
  if (k === '?') {
    parts.push('?')
    return parts.join('+')
  }
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

