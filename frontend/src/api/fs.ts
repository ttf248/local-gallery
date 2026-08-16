import { api } from './client'

// 服务端 fs 接口封装。
export const fsApi = {
  openInExplorer(path: string) {
    return api<{ ok: boolean }>('/api/fs/open', {
      params: { path },
      method: 'GET',
    }).catch((e) => {
      // 403（禁用）/ 400（路径越权）等都抛回调用方
      throw e
    })
  },
  // 从 /api/health 同步服务端能力（主要是 allowOsOpen）。
  // 启动时调一次；用户在 Settings 切换 allowOsOpen 后再调一次。
  async syncCapabilities(): Promise<FsCapabilities> {
    try {
      const res = await fetch('/api/health', { headers: { Accept: 'application/json' } })
      if (!res.ok) return fsCapabilities
      const data = (await res.json()) as { allowOsOpen?: boolean }
      if (typeof data.allowOsOpen === 'boolean') {
        fsCapabilities.allowOsOpen = data.allowOsOpen
      }
    } catch {
      // 网络失败：保留旧值（默认 false），不抛
    }
    return fsCapabilities
  },
}

export interface FsCapabilities {
  allowOsOpen: boolean
}

// 默认值；App 启动 + Settings 改 allowOsOpen 后会通过
// fsApi.syncCapabilities() 写回真实值。
export const fsCapabilities: FsCapabilities = {
  allowOsOpen: false,
}