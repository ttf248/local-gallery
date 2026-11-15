import { describe, expect, it } from "vitest";
import { ApiError } from "./client";
import { queryClient } from "./queryClient";

// 重试策略只有这一处：请求层（api/client.ts）不再自己重试。
// 这里守住「哪些错误值得再试一次」。
function retryOf(): (failureCount: number, error: unknown) => boolean {
  const retry = queryClient.getDefaultOptions().queries?.retry;
  if (typeof retry !== "function") {
    throw new Error("查询层没有配置重试策略");
  }
  return retry as (failureCount: number, error: unknown) => boolean;
}

describe("查询层重试策略", () => {
  it("5xx、408、429 会重试", () => {
    const retry = retryOf();
    expect(retry(0, new ApiError(500, "服务器错误"))).toBe(true);
    expect(retry(0, new ApiError(503, "不可用"))).toBe(true);
    expect(retry(0, new ApiError(408, "超时"))).toBe(true);
    expect(retry(0, new ApiError(429, "太频繁"))).toBe(true);
  });

  it("请求本身不成立的状态不重试", () => {
    const retry = retryOf();
    // 404：资源没了（标签被删、相册被移走）。
    expect(retry(0, new ApiError(404, "找不到"))).toBe(false);
    // 400：参数或游标不对，再来一次还是不对。
    expect(retry(0, new ApiError(400, "invalid_cursor"))).toBe(false);
    // 401 / 403：会话或权限问题。
    expect(retry(0, new ApiError(401, "未登录"))).toBe(false);
    expect(retry(0, new ApiError(403, "禁止访问"))).toBe(false);
  });

  it("网络错误（非 ApiError）可以重试，但最多三次", () => {
    const retry = retryOf();
    expect(retry(0, new TypeError("Failed to fetch"))).toBe(true);
    expect(retry(2, new TypeError("Failed to fetch"))).toBe(true);
    expect(retry(3, new TypeError("Failed to fetch"))).toBe(false);
  });

  it("重试次数用尽后不再重试", () => {
    const retry = retryOf();
    expect(retry(3, new ApiError(500, "服务器错误"))).toBe(false);
  });
});
