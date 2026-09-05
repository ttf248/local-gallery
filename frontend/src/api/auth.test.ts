import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_ESTABLISHED_EVENT } from "./client";
import { authApi } from "./auth";

describe("authApi", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("建立会话后广播认证成功且不把令牌写入 URL", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ authenticated: true, mode: "lan" }),
    } as unknown as Response);
    vi.stubGlobal("fetch", fetchMock);
    const listener = vi.fn();
    window.addEventListener(AUTH_ESTABLISHED_EVENT, listener);

    await expect(authApi.login("secret-token")).resolves.toMatchObject({
      authenticated: true,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/session",
      expect.objectContaining({
        method: "POST",
        credentials: "include",
        body: JSON.stringify({ token: "secret-token" }),
      }),
    );
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(AUTH_ESTABLISHED_EVENT, listener);
  });
});
