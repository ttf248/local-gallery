import { api, AUTH_ESTABLISHED_EVENT } from "./client";

export interface SessionStatus {
  authenticated: boolean;
  mode: "local" | "lan";
  expiresAt?: string;
}

export const authApi = {
  status: () => api<SessionStatus>("/api/auth/session"),
  login: async (token: string) => {
    const session = await api<SessionStatus>("/api/auth/session", {
      method: "POST",
      nonIdempotent: true,
      body: { token },
    });
    if (session.authenticated && typeof window !== "undefined") {
      window.dispatchEvent(new Event(AUTH_ESTABLISHED_EVENT));
    }
    return session;
  },
  logout: () =>
    api<void>("/api/auth/session", {
      method: "DELETE",
      nonIdempotent: true,
    }),
};
