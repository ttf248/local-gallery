import { api } from './client'

export interface AlbumSummary {
  type: 'album'
  path: string
  name: string
  // 多根扫描时：同名冲突的 album 会加 "[SourceName] " 前缀；无冲突时与 name 相同
  displayName?: string
  // 来源媒体根的绝对路径（多根时填充）；单根场景可为空
  sourceRoot?: string
  // 来源媒体根的 basename，用于 UI badge 显示
  sourceName?: string
  coverImage: string
  /**
   * 封面来源："image" / "video"；未传时由 coverImage 扩展名推断。
   * 仅视频 cover（首帧）由前端浏览器抽帧后回传到后端。
   */
  coverKind?: 'image' | 'video'
  imageCount: number
  /** 视频数量；为 0 / 缺省时该目录不含视频。 */
  videoCount?: number
  // 新字段：files 优先；旧字段 imageFiles 作为兜底。
  files?: string[]
  imageFiles?: string[]
  /** 视频文件绝对路径列表（imageCount=0 时 coverImage 指向这里）。 */
  videoFiles?: string[]
  author?: string
  modTime?: string
  folderSize?: number
}

export interface CollectionSummary {
  type: 'collection'
  path: string
  name: string
  displayName?: string
  sourceRoot?: string
  sourceName?: string
  /** 直属于本层的子相册(含"散图"虚拟相册,如果有顶层文件+子目录时插入) */
  albums: AlbumSummary[]
  /**
   * 嵌套子集合:深层子目录(只有更深层子目录,没有顶层图/视频)
   * 仍被识别为 collection 时挂这里,保持「年→月→事件」的多层结构。
   * 旧版本会拍平,2024年/夏威夷-度假/相册/作品/甜片 这种 5 层目录就
   * 没法继续下钻了。
   */
  collections?: CollectionSummary[]
  /**
   * 直属于本层的子相册数(不含嵌套集合内的子相册)。
   * 旧版等同于 len(albums),无变化。
   */
  albumCount: number
}

export interface SmartCollectionSummary {
  type: 'smartCollection'
  author: string
  albums: AlbumSummary[]
  albumCount: number
  coverImage: string
}

export interface ScanResult {
  // 第一个媒体根（兼容字段）
  root: string
  // 全部媒体根（多根时输出）；单根时只含 1 个元素
  roots?: string[]
  albums: AlbumSummary[]
  // 新字段：folders 优先（与 albums 同源）；旧字段 albums 仍保留。
  folders?: AlbumSummary[]
  collections: CollectionSummary[]
  smartCollections: SmartCollectionSummary[]
  albumCount: number
  // 新字段
  folderCount?: number
  collectionCount: number
  duration: number
  scannedAt: string
}

export interface ScanStartResponse {
  scanId: string
}

export interface ProgressEvent {
  scanId: string
  progress: number
  status: 'pending' | 'running' | 'complete' | 'cancelled' | 'error'
  phase?: string
  currentPath?: string
  albumsFound: number
  error?: string
  elapsedMs: number
}

export const scanApi = {
  start: () => api<ScanStartResponse>('/api/scan/start', { method: 'POST' }),
  result: (id: string) => api<{ ok: boolean; result: ScanResult }>(`/api/scan/${id}/result`),
  cancel: (id: string) => api<{ ok: boolean }>(`/api/scan/${id}`, { method: 'DELETE' }),
  // 拿后端磁盘缓存的上次扫描结果；首次启动 / 还没扫过时 404,调用方应吞掉。
  latest: () => api<{ ok: boolean; result: ScanResult }>('/api/scan/latest'),
}
