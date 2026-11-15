import { api } from "./client";

// 服务端 fs 接口封装。
export const fsApi = {
  directories(directory: string, after = "", signal?: AbortSignal) {
    return api<DirectoryPage>("/api/admin/fs/directories", {
      method: "POST",
      body: { directory, after },
      signal,
      cache: "no-store",
    });
  },
  openInExplorer(id: string) {
    return api<{ ok: boolean }>("/api/fs/open", {
      body: { id },
      method: "POST",
    });
  },
  // 在系统文件管理器里打开一个已配置路径（缓存目录、静态目录等）。
  //
  // 走 GET 而不是 POST：路径安全中间件是从查询参数里取 path 的（见
  // backend/internal/middleware/path_safety.go），把它改成读请求体要
  // 动到路径校验那一层，不划算。这个端点只允许回环访问、还要配置里
  // 打开 allowOsOpen，浏览器不会去预取它。
  openConfiguredPath(path: string) {
    return api<{ ok: boolean }>("/api/admin/fs/open", {
      params: { path, allowConfig: 1 },
      method: "GET",
      cache: "no-store",
    });
  },
  async capabilities(signal?: AbortSignal): Promise<FsCapabilities> {
    const data = await api<{ allowOsOpen?: boolean }>("/api/health", {
      signal,
    });
    return { allowOsOpen: data.allowOsOpen === true };
  },
};

export interface FsCapabilities {
  allowOsOpen: boolean;
}

export interface DirectoryPage {
  directory: string;
  parent: string;
  roots: string[];
  items: { name: string; path: string }[];
  nextAfter: string;
}
