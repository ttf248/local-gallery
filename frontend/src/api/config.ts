import { api } from './client'

// 后端 /api/config 的响应结构。所有字段都来自 config.yaml；
// 当前生效值在 GetConfig 时返回。
//
// mediaRoots 数组是权威字段；mediaRoot 保留为 mediaRoots[0] 的别名，
// 兼容老调用方（健康检查、错误提示等）。
export interface ServerConfig {
  mediaRoots: string[]
  mediaRoot: string
  host: string
  port: number
  cacheDir: string
  thumbSizeW: number
  thumbSizeH: number
  thumbCacheSize: number
  cacheMaxAgeDays: number
  allowOsOpen: boolean
  staticDir: string
  // ffmpegPath:服务端 ffmpeg 可执行文件路径;空 = 客户端抽帧 fallback
  // ffmpegAvailable:运行时探测 -version 是否可用
  ffmpegPath?: string
  ffmpegAvailable?: boolean
  configPath: string
}

// PATCH /api/config 的请求体。key 缺省视为"不修改"；
// bool 字段（如 allowOsOpen）必须显式传值以区分 unset / explicit false。
// mediaRoots 数组用空数组 `[]` 表达"清空所有根"，不传字段表达"不修改"。
export type ServerConfigPatch = Partial<
  Pick<
    ServerConfig,
    | 'mediaRoots'
    | 'host'
    | 'port'
    | 'cacheDir'
    | 'thumbSizeW'
    | 'thumbSizeH'
    | 'thumbCacheSize'
    | 'cacheMaxAgeDays'
    | 'allowOsOpen'
    | 'staticDir'
    | 'ffmpegPath'
  >
>

export interface ServerConfigUpdateResponse {
  ok: boolean
  config: ServerConfig
  requiresRestart: string[]
  // 根集合是否变化（顺序无关）；前端据此决定是否提示"重新扫描"
  mediaRootsChanged: boolean
}

export const configApi = {
  get: () => api<ServerConfig>('/api/config'),

  update: (patch: ServerConfigPatch) =>
    api<ServerConfigUpdateResponse>('/api/config', {
      method: 'PUT',
      body: patch,
    }),
}
