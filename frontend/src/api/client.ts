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
//
// options.events：要监听的事件名列表（后端用 `event: <name>` 推送时必须显式列出）；
//   不传则只监听默认的 'message' 事件（无 `event:` 前缀）。
// options.onError：连接错误回调（含网络抖动、readyState 进入 CLOSED）。
// options.signal：外部 AbortSignal，触发时自动关闭 EventSource。
export function sse(
  path: string,
  onEvent: (eventName: string, data: unknown) => void,
  options: {
    events?: string[]
    onError?: (err: Event) => void
    signal?: AbortSignal
  } = {},
): () => void {
  const url = API_BASE ? `${API_BASE}${path}` : path
  const es = new EventSource(url)

  const handler = (e: MessageEvent) => {
    try {
      onEvent(e.type, JSON.parse(e.data))
    } catch {
      onEvent(e.type, e.data)
    }
  }

  // 默认监听 message（兼容不带 event: 前缀的纯 data: 流）
  es.addEventListener('message', handler)
  // 注册指定事件名
  for (const name of options.events ?? []) {
    es.addEventListener(name, handler)
  }

  es.onerror = (e) => {
    if (options.onError) options.onError(e)
  }

  // 外部 signal 触发时关闭
  let onAbort: (() => void) | null = null
  if (options.signal) {
    if (options.signal.aborted) {
      es.close()
    } else {
      onAbort = () => es.close()
      options.signal.addEventListener('abort', onAbort, { once: true })
    }
  }

  return () => {
    es.close()
    if (options.signal && onAbort) {
      options.signal.removeEventListener('abort', onAbort)
    }
  }
}
