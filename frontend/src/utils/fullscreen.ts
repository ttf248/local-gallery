// 全屏切换。直接调浏览器 Fullscreen API,不写 store(浏览器
// fullscreenElement 才是真相源,store mirror 会被 F11 / 退出键打脸)。

export function isFullscreen(): boolean {
  if (typeof document === 'undefined') return false
  return Boolean(document.fullscreenElement)
}

export function toggleFullscreen(): void {
  if (typeof document === 'undefined') return
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {})
    return
  }
  document.documentElement.requestFullscreen().catch(() => {})
}

export function enterFullscreen(): void {
  if (typeof document === 'undefined') return
  if (document.fullscreenElement) return
  document.documentElement.requestFullscreen().catch(() => {})
}

export function exitFullscreen(): void {
  if (typeof document === 'undefined') return
  if (!document.fullscreenElement) return
  document.exitFullscreen().catch(() => {})
}
