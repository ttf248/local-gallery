import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import { favoritesApi } from "../api/prefs";
import { favoritesQueryKey } from "../api/queryKeys";
import { useFavorites } from "./useFavorites";

vi.mock("../api/prefs", () => ({
  favoritesApi: { list: vi.fn(), add: vi.fn(), remove: vi.fn() },
}));

function setup(initial?: string[]) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (initial) client.setQueryData(favoritesQueryKey, { favorites: initial });
  const hook = renderHook(() => useFavorites(), {
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  });
  return { ...hook, client };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(favoritesApi.list).mockResolvedValue({ favorites: [] });
  vi.mocked(favoritesApi.add).mockResolvedValue({ favorites: ["a_trip"] });
  vi.mocked(favoritesApi.remove).mockResolvedValue({ favorites: [] });
});

it("写入成功后显示服务端返回的完整收藏", async () => {
  vi.mocked(favoritesApi.add).mockResolvedValue({
    favorites: ["a_trip", "a_other"],
  });
  vi.mocked(favoritesApi.list).mockResolvedValue({
    favorites: ["a_trip", "a_other"],
  });
  const { result } = setup([]);
  await act(async () => {
    await result.current.add("a_trip");
  });
  await waitFor(() =>
    expect(result.current.favorites).toEqual(["a_trip", "a_other"]),
  );
});

it("移除成功后不再回显已移除的收藏", async () => {
  vi.mocked(favoritesApi.remove).mockResolvedValue({ favorites: ["a_other"] });
  vi.mocked(favoritesApi.list).mockResolvedValue({ favorites: ["a_other"] });
  const { result } = setup(["a_trip", "a_other"]);
  await act(async () => {
    await result.current.remove("a_trip");
  });
  await waitFor(() => expect(result.current.favorites).toEqual(["a_other"]));
});

// 写入时先中止还在飞的读取：它带着写入之前的快照，回来得晚就会把刚写
// 进去的值盖回去（连点两次星标会闪回）。
it("写入时先中止还在飞的列表读取，再写回服务端返回的清单", async () => {
  const { result, client } = setup([]);
  const cancel = vi.spyOn(client, "cancelQueries");
  await act(async () => {
    await result.current.add("a_trip");
  });
  expect(cancel).toHaveBeenCalledWith({ queryKey: favoritesQueryKey });
});

it("连点两次星标后迟到的旧读取不会把收藏加回来", async () => {
  // 第一次后台读取迟迟不回：它带着写入之前的快照。
  let resolveSlow: (value: { favorites: string[] }) => void = () => {};
  vi.mocked(favoritesApi.list).mockReturnValueOnce(
    new Promise((resolve) => {
      resolveSlow = resolve;
    }),
  );
  // 后一次读取也不回：这样「迟到的旧读取」才是唯一可能改写状态的东西。
  vi.mocked(favoritesApi.list).mockReturnValue(new Promise(() => {}));
  vi.mocked(favoritesApi.add).mockResolvedValue({ favorites: ["a_trip"] });
  vi.mocked(favoritesApi.remove).mockResolvedValue({ favorites: [] });

  const { result } = setup([]);
  await act(async () => {
    await result.current.toggle("a_trip");
  });
  await waitFor(() => expect(result.current.favorites).toEqual(["a_trip"]));

  // 立刻再点一次：取消收藏。
  await act(async () => {
    await result.current.toggle("a_trip");
  });
  await waitFor(() => expect(result.current.favorites).toEqual([]));

  // 迟到的旧读取这时才回来 —— 它不能把收藏加回去。
  await act(async () => {
    resolveSlow({ favorites: ["a_trip"] });
    await Promise.resolve();
  });
  expect(result.current.favorites).toEqual([]);
});

it.each(["add", "remove"] as const)(
  "%s 失败保留原缓存，不把失败当成功",
  async (operation) => {
    vi.mocked(favoritesApi[operation]).mockRejectedValue(new Error("offline"));
    const { result } = setup(["a_trip"]);
    await act(async () => {
      await expect(result.current[operation]("a_trip")).rejects.toThrow(
        "offline",
      );
    });
    expect(result.current.favorites).toEqual(["a_trip"]);
  },
);

it("先前取得的切换函数也使用当前共享缓存判断操作", async () => {
  const { result, client } = setup([]);
  const toggle = result.current.toggle;
  act(() => {
    client.setQueryData(favoritesQueryKey, { favorites: ["a_trip"] });
  });
  await act(async () => {
    await toggle("a_trip");
  });
  expect(favoritesApi.remove).toHaveBeenCalledWith("a_trip");
  expect(favoritesApi.add).not.toHaveBeenCalled();
});

it("首次列表未完成时等待共享查询，再按真实收藏状态切换", async () => {
  let finish: (value: { favorites: string[] }) => void = () => {};
  vi.mocked(favoritesApi.list).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { result } = setup();
  const operation = result.current.toggle("a_trip");
  await act(async () => {
    await Promise.resolve();
  });
  expect(favoritesApi.add).not.toHaveBeenCalled();
  expect(favoritesApi.remove).not.toHaveBeenCalled();
  await act(async () => {
    finish({ favorites: ["a_trip"] });
    await operation;
  });
  expect(favoritesApi.remove).toHaveBeenCalledWith("a_trip");
  // 一次是首次读取，一次是写入之后的后台刷新。
  expect(favoritesApi.list).toHaveBeenCalledTimes(2);
});

it("无法确认首次收藏列表时切换失败，不盲目写入", async () => {
  vi.mocked(favoritesApi.list).mockRejectedValue(new Error("offline"));
  const { result } = setup();
  await waitFor(() => expect(result.current.isError).toBe(true));
  await act(async () => {
    await expect(result.current.toggle("a_trip")).rejects.toThrow("offline");
  });
  expect(favoritesApi.add).not.toHaveBeenCalled();
  expect(favoritesApi.remove).not.toHaveBeenCalled();
});
