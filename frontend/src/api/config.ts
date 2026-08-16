import { api } from './client'

// 后端 /api/config 的响应结构。所有字段都来自 config.yaml；
// 当前生效值在 GetConfig 时返回。
export interface ServerConfig {
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
  configPath: string
}

// PATCH /api/config 的请求体。key 缺省视为"不修改"；
// bool 字段（如 allowOsOpen）必须显式传值以区分 unset / explicit false。
export type ServerConfigPatch = Partial<
  Pick<
    ServerConfig,
    | 'mediaRoot'
    | 'host'
    | 'port'
    | 'cacheDir'
    | 'thumbSizeW'
    | 'thumbSizeH'
    | 'thumbCacheSize'
    | 'cacheMaxAgeDays'
    | 'allowOsOpen'
    | 'staticDir'
  >
>

export interface ServerConfigUpdateResponse {
  ok: boolean
  config: ServerConfig
  requiresRestart: string[]
  mediaRootChanged: boolean
}

export const configApi = {
  get: () => api<ServerConfig>('/api/config'),

  update: (patch: ServerConfigPatch) =>
    api<ServerConfigUpdateResponse>('/api/config', {
      method: 'PUT',
      body: patch,
    }),
}
