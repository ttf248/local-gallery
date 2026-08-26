// 从相册路由提取不透明资源 ID。
export function decodeFavPath(to: string): string {
  if (!to.startsWith('/albums/')) return to
  try {
    return decodeURIComponent(to.replace(/^\/albums\//, ''))
  } catch {
    return to.replace(/^\/albums\//, '')
  }
}

// 把相册资源 ID 编码成 /albums/<encoded-id> 形式。
export function albumRoute(albumId: string): string {
  return `/albums/${encodeURIComponent(albumId)}`
}

// 智能集合（按标签聚合）路由：smart:<tag> → /albums/smart:<tag> 编码后
export function smartRoute(tag: string): string {
  return `/albums/${encodeURIComponent('smart:' + tag)}`
}

// 标签页（新名）：/tags/<encoded tag>
export function tagRoute(tag: string): string {
  return `/tags/${encodeURIComponent(tag)}`
}
