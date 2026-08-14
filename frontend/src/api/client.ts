// API 客户端基础封装。
//
// 基础地址解析顺序：
//   1. window.__COMIC_API_BASE__（后端在 index.html 注入）
//   2. import.meta.env.VITE_API_BASE（编译时）
//   3. 空字符串（同源，由 Vite proxy 或后端静态服务接管）

const RUNTIME_BASE = (typeof window !== 'undefined'
  ? (window as unknown as { __COMIC_API_BASE__?: string }).__COMIC_API_BASE__
  : '') ?? ''

const ENV_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? ''

export const API_BASE = RUNTIME_BASE || ENV_BASE || ''

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message)
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
}

function buildUrl(path: string, params?: RequestOptions['params']): string {
  const base = API_BASE ? `${API_BASE}${path}` : path
  if (!params) return base
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&')
  return qs ? `${base}?${qs}` : base
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, params, headers, ...rest } = opts
  const init: RequestInit = {
    ...rest,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      ...(headers as Record<string, string> | undefined),
    },
  }
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body)
  }

  const res = await fetch(buildUrl(path, params), init)

  if (!res.ok) {
    let parsed: unknown
    try {
      parsed = await res.json()
    } catch {
      parsed = await res.text().catch(() => null)
    }
    throw new ApiError(res.status, `HTTP ${res.status}`, parsed)
  }

  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

// 简单的 SSE 订阅：返回取消函数。
export function sse(
  path: string,
  onEvent: (eventName: string, data: unknown) => void,
  onError?: (err: Event) => void,
): () => void {
  const url = API_BASE ? `${API_BASE}${path}` : path
  const es = new EventSource(url)

  // 通用监听：每个 event 名称都需要手动绑定
  es.onmessage = (e) => {
    try {
      onEvent('message', JSON.parse(e.data))
    } catch {
      onEvent('message', e.data)
    }
  }
  es.onerror = (e) => {
    if (onError) onError(e)
  }

  return () => es.close()
}
