// 解析收藏路径：to="/albums/<encoded path>" → "<decoded path>"
export function decodeFavPath(to: string): string {
  if (!to.startsWith('/albums/')) return to
  try {
    return decodeURIComponent(to.replace(/^\/albums\//, ''))
  } catch {
    return to.replace(/^\/albums\//, '')
  }
}

// 把相册绝对路径编码成 /albums/<encoded path> 形式。
export function albumRoute(absPath: string): string {
  return `/albums/${encodeURIComponent(absPath)}`
}

// 智能集合（按标签聚合）路由：smart:<tag> → /albums/smart:<tag> 编码后
export function smartRoute(tag: string): string {
  return `/albums/${encodeURIComponent('smart:' + tag)}`
}

// 标签页（新名）：/tags/<encoded tag>
export function tagRoute(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`
}

// 作者独立页：旧名 /authors/<encoded author>。新代码请用 tagRoute。
// 保留它便于兼容老调用方。
export function authorRoute(author: string): string {
  return `/authors/${encodeURIComponent(author)}`
}
