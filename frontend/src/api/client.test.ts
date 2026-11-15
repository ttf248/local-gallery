import { afterEach, describe, expect, it, vi } from "vitest";
import {
  api,
  apiUrl,
  ApiError,
  AUTH_REQUIRED_EVENT,
  buildQuery,
  isRetryableStatus,
} from "./client";

function failedResponse(status: number, body: string): Response {
  return {
    ok: false,
    status,
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe("api error response", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("只读取一次响应体并解析标准扁平错误", async () => {
    const response = failedResponse(
      400,
      JSON.stringify({ code: "invalid_request", message: "请求无效" }),
    );
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));

    const error = await api("/api/example").catch((caught: unknown) => caught);

    expect(response.text).toHaveBeenCalledTimes(1);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: "invalid_request",
      message: "请求无效",
    });
  });

  it("保留非 JSON 错误文本供诊断", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          failedResponse(
            422,
            JSON.stringify({ code: "bad_path", message: "路径无效" }),
          ),
        )
        .mockResolvedValueOnce(failedResponse(400, "Bad Request")),
    );

    await expect(api("/api/flat")).rejects.toMatchObject({
      status: 422,
      code: "bad_path",
      message: "路径无效",
    });
    await expect(api("/api/text")).rejects.toMatchObject({
      status: 400,
      message: "HTTP 400",
      body: "Bad Request",
    });
  });

  it("默认携带同源会话并在 401 时广播认证失效", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        failedResponse(
          401,
          JSON.stringify({ code: "authentication_required", message: "登录" }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const listener = vi.fn();
    window.addEventListener(AUTH_REQUIRED_EVENT, listener);

    await expect(api("/api/private")).rejects.toMatchObject({
      status: 401,
      code: "authentication_required",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/private",
      expect.objectContaining({ credentials: "include" }),
    );
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_REQUIRED_EVENT, listener);
  });

  it("上传 FormData 时不覆盖浏览器生成的 multipart boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = new FormData();
    body.append("image", new File(["image"], "query.jpg"));

    await api("/api/ai/search", {
      method: "POST",
      body,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/search",
      expect.objectContaining({
        body,
        headers: { Accept: "application/json" },
      }),
    );
  });

  it("上传 Blob 时保留它自己的 Content-Type", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ ok: true }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const body = new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });

    await api("/api/thumbs/f_1/cover", { method: "POST", body });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/thumbs/f_1/cover",
      expect.objectContaining({
        body,
        headers: expect.objectContaining({ "Content-Type": "image/jpeg" }),
      }),
    );
  });
});

describe("重试策略只在查询层", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("请求层不再自己重试：一次失败只发一次请求", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(failedResponse(500, "服务器开小差了"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(api("/api/example")).rejects.toMatchObject({ status: 500 });

    // 重试由 TanStack Query 决定（api/queryClient.ts）。两处都重试的
    // 时候，一个 GET 最多会发出 8 次请求。
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("只把 5xx、408、429 算作值得重试", () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(503)).toBe(true);
    expect(isRetryableStatus(408)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    // 请求本身不成立的状态：重试多少次都一样。
    expect(isRetryableStatus(400)).toBe(false);
    expect(isRetryableStatus(401)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);
    expect(isRetryableStatus(404)).toBe(false);
  });
});

describe("查询串拼装只有一处", () => {
  it("空值一律省略，其余按给定顺序拼出", () => {
    expect(buildQuery({ w: 1280, v: "abc" })).toBe("?w=1280&v=abc");
    expect(buildQuery({ w: undefined, v: "" })).toBe("");
    expect(buildQuery({ scope: "thumbs" })).toBe("?scope=thumbs");
    expect(buildQuery()).toBe("");
  });

  it("值里的特殊字符会被转义", () => {
    expect(buildQuery({ tag: "C++ / 100%" })).toBe(
      "?tag=C%2B%2B%20%2F%20100%25",
    );
  });

  it("apiUrl 把查询串接在路径后面", () => {
    expect(apiUrl("/api/thumbs/f_1", { w: 640 })).toBe(
      "/api/thumbs/f_1?w=640",
    );
  });
});
