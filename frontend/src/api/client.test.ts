import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError } from "./client";

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

  it("只读取一次响应体并解析嵌套错误", async () => {
    const response = failedResponse(
      400,
      JSON.stringify({
        error: { code: "invalid_request", message: "请求无效" },
      }),
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

  it("兼容扁平错误与非 JSON 错误文本", async () => {
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
});
