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
}

export interface FsCapabilities {
  allowOsOpen: boolean
}

export const fsCapabilities: FsCapabilities = {
  allowOsOpen: false, // 由后端 /api/health 在初始化时设置
}