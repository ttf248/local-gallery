// API 客户端基础封装。
//
// 基础地址解析顺序：
//   1. window.__COMIC_API_BASE__（后端在 index.html 注入）
//   2. import.meta.env.VITE_API_BASE（编译时）
//   3. 空字符串（同源，由 Vite proxy 或后端静态服务接管）

const RUNTIME_BASE =
  (typeof window !== "undefined"
    ? (window as unknown as { __COMIC_API_BASE__?: string }).__COMIC_API_BASE__
    : "") ?? "";

const ENV_BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export const API_BASE = RUNTIME_BASE || ENV_BASE || "";
export const AUTH_REQUIRED_EVENT = "local-gallery:auth-required";
export const AUTH_ESTABLISHED_EVENT = "local-gallery:auth-established";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
    /** 后端标准错误 code (snake_case);空表示非业务错误(网络层/未知)。 */
    public code?: string,
  ) {
    super(message);
  }
}

interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  params?: Record<string, string | number | boolean | undefined>;
}

/**
 * 哪些状态值得重试。
 *
 * 只有 5xx、408 与 429 是「再试一次可能成功」的；其余 4xx 是请求本身
 * 不成立（参数错、无权限、找不到），重试多少次结果都一样。
 *
 * 重试策略只有一处：TanStack Query（api/queryClient.ts）。这一层不再
 * 自己重试 —— 两处都重试时，一个 GET 最多会发出 8 次请求，而 400 与
 * 401 也会被反复重试。
 */
export function isRetryableStatus(status: number): boolean {
  return (status >= 500 && status < 600) || status === 408 || status === 429;
}

/**
 * 游标失效：库变了，这一页的位置不再有效。
 *
 * 失效的游标重试没有意义 —— 用同一个游标再要一次，还是那一份错位的数据。
 * 正确的恢复是从头重取（重新走一遍分页链），而不是重试这一页。
 */
export function isStaleCursorError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.code === "stale_cursor" || error.code === "invalid_cursor")
  );
}

/** 把查询参数拼成 ?a=1&b=2；空值一律省略。 */
export function buildQuery(
  params?: Record<string, string | number | boolean | undefined>,
): string {
  if (!params) return "";
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join("&");
  return qs ? `?${qs}` : "";
}

/** 拼出一个完整的请求 URL（含 API 基址与查询串）。 */
export function apiUrl(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): string {
  const base = API_BASE ? `${API_BASE}${path}` : path;
  return `${base}${buildQuery(params)}`;
}

export async function api<T>(
  path: string,
  opts: RequestOptions = {},
): Promise<T> {
  const { body, params, headers, ...rest } = opts;
  const formDataBody =
    typeof FormData !== "undefined" && body instanceof FormData
      ? body
      : undefined;
  const blobBody =
    typeof Blob !== "undefined" && body instanceof Blob ? body : undefined;
  const rawBody = formDataBody ?? blobBody;
  const init: RequestInit = {
    ...rest,
    credentials: rest.credentials ?? "include",
    headers: {
      ...(rawBody === undefined
        ? { "Content-Type": "application/json" }
        : blobBody
          ? { "Content-Type": blobBody.type || "application/octet-stream" }
          : {}),
      Accept: "application/json",
      ...(headers as Record<string, string> | undefined),
    },
  };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : (rawBody ?? JSON.stringify(body));
  }

  const res = await fetch(apiUrl(path, params), init);
  if (!res.ok) {
    // Response body 是一次性流：先读取一次文本，再尝试解析 JSON，避免
    // res.json() 失败后 res.text() 只能拿到 "body already used"。
    const rawBody = await res.text().catch(() => "");
    let parsed: unknown = rawBody || null;
    try {
      parsed = JSON.parse(rawBody) as unknown;
    } catch {
      // 非 JSON 响应保留原始文本，便于调用方诊断代理或网关错误。
    }

    // 当前 API 统一使用扁平错误结构：
    // {"code":"...","message":"...","details":{...}}
    let code: string | undefined;
    let message = `HTTP ${res.status}`;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      if (typeof obj.code === "string") code = obj.code;
      if (typeof obj.message === "string") message = obj.message;
    }
    const err = new ApiError(res.status, message, parsed, code);
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(
        new CustomEvent(AUTH_REQUIRED_EVENT, { detail: { code } }),
      );
    }
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

// 简单的 SSE 订阅：返回取消函数。
//
// options.events：要监听的事件名列表（后端用 `event: <name>` 推送时必须显式列出）；
//   不传则只监听默认的 'message' 事件（无 `event:` 前缀）。
// options.onError：原生连接错误及其重连状态，不包含名为 error 的业务消息。
// options.signal：外部 AbortSignal，触发时自动关闭 EventSource。
export function sse(
  path: string,
  onEvent: (eventName: string, data: unknown) => void,
  options: {
    events?: string[];
    onError?: (err: Event, state: "reconnecting" | "closed") => void;
    signal?: AbortSignal;
  } = {},
): () => void {
  if (options.signal?.aborted) return () => {};
  const url = API_BASE ? `${API_BASE}${path}` : path;
  const es = new EventSource(url);
  let active = true;
  const handler = (event: Event) => {
    if (!active || !(event instanceof MessageEvent)) return;
    let data: unknown = event.data;
    try {
      data = JSON.parse(event.data);
    } catch {
      /* 非 JSON 消息保留原始文本。 */
    }
    onEvent(event.type, data);
  };
  const onConnectionError = (event: Event) => {
    if (!active || event instanceof MessageEvent) return;
    options.onError?.(
      event,
      es.readyState === EventSource.CONNECTING ? "reconnecting" : "closed",
    );
  };
  const events = new Set(["message", ...(options.events ?? [])]);
  for (const name of events) es.addEventListener(name, handler);
  es.addEventListener("error", onConnectionError);
  function close() {
    if (!active) return;
    active = false;
    es.close();
    for (const name of events) es.removeEventListener(name, handler);
    es.removeEventListener("error", onConnectionError);
    options.signal?.removeEventListener("abort", close);
  }
  options.signal?.addEventListener("abort", close, { once: true });
  return close;
}
