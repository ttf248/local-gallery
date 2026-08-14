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

// 智能集合路由：smart:<author> → /albums/smart:<author> 编码后
export function smartRoute(author: string): string {
  return `/albums/${encodeURIComponent('smart:' + author)}`
}
