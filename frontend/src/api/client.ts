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
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    /** 后端标准错误 code (snake_case);空表示非业务错误(网络层/未知)。 */
    public code?: string,
  ) {
    super(message)
  }
}

interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown
  params?: Record<string, string | number | boolean | undefined>
  /** 5xx + 网络错误重试次数,默认 0;GET 默认 1。 */
  retries?: number
  /** 明确标记非幂等(如 POST),强制 retries=0 防止重复提交。 */
  nonIdempotent?: boolean
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

// 决定实际重试次数的 helper:
//   - nonIdempotent POST/DELETE/PATCH → 0(避免重复提交)
//   - GET → 默认 1
//   - 显式 retries 优先
function resolveRetries(method: string | undefined, opts: RequestOptions): number {
  if (opts.nonIdempotent) return 0
  if (opts.retries !== undefined) return opts.retries
  const m = (method ?? 'GET').toUpperCase()
  return m === 'GET' || m === 'HEAD' ? 1 : 0
}

function isRetryableStatus(status: number): boolean {
  // 5xx 服务器错误 + 408 Request Timeout + 429 Too Many Requests
  return (status >= 500 && status < 600) || status === 408 || status === 429
}

function isRetryableNetworkError(err: unknown): boolean {
  // fetch 抛 TypeError (network failure);AbortError 视为调用方取消,不重试
  if (err instanceof DOMException && err.name === 'AbortError') return false
  if (err instanceof TypeError) return true
  return false
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const { body, params, headers, retries, ...rest } = opts
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

  const maxAttempts = resolveRetries(opts.method, opts) + 1
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(buildUrl(path, params), init)
      if (!res.ok) {
        let parsed: unknown
        try {
          parsed = await res.json()
        } catch {
          parsed = await res.text().catch(() => null)
        }
        // 解析后端标准错误:{"code": "...", "message": "...", "error": "..."}
        let code: string | undefined
        let message = `HTTP ${res.status}`
        if (parsed && typeof parsed === 'object') {
          const obj = parsed as Record<string, unknown>
          if (typeof obj.code === 'string') code = obj.code
          if (typeof obj.message === 'string') message = obj.message
          else if (typeof obj.error === 'string') message = obj.error // 兼容老字段
        }
        const err = new ApiError(res.status, message, parsed, code)
        // 4xx 业务错误不重试;5xx/408/429 在剩余次数内重试
        if (attempt < maxAttempts && isRetryableStatus(res.status)) {
          await sleep(100 * attempt) // 简单线性 backoff
          continue
        }
        throw err
      }
      if (res.status === 204) return undefined as T
      return (await res.json()) as T
    } catch (err) {
      // 已是 ApiError,直接抛出(不会再被网络层 retry catch)
      if (err instanceof ApiError) throw err
      lastErr = err
      if (attempt < maxAttempts && isRetryableNetworkError(err)) {
        await sleep(100 * attempt)
        continue
      }
      throw err
    }
  }
  // 不会到这里(maxAttempts >= 1);保留类型完整性
  throw lastErr instanceof Error ? lastErr : new Error('api request failed')
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
