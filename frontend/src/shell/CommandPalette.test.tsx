import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import CommandPalette from "./CommandPalette";
import { albumsApi } from "../api/albums";

let mode: "photo" | "comic" = "photo";

vi.mock("../api/albums", () => ({
  albumsApi: { search: vi.fn() },
}));
vi.mock("../hooks/useAppMode", () => ({
  useAppMode: () => ({ mode, setMode: vi.fn(), ready: true }),
}));
vi.mock("../hooks/useHistory", () => ({
  useHistoryCards: () => ({
    cards: Array.from({ length: 6 }, (_, i) => ({
      to: `/photo/albums/recent-${i}`,
      title: `最近相册 ${i}`,
    })),
  }),
}));

function Example() {
  const [open, setOpen] = useState(false);
  const location = useLocation();
  return (
    <>
      <button type="button" data-command-trigger onClick={() => setOpen(true)}>
        搜索
      </button>
      <output aria-label="当前地址">
        {location.pathname}
        {location.search}
      </output>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function openPalette(path = "/photo") {
  const client = new QueryClient();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <Example />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const trigger = screen.getByRole("button", { name: "搜索" });
  trigger.focus();
  vi.spyOn(trigger, "getClientRects").mockReturnValue([
    new DOMRect(),
  ] as unknown as DOMRectList);
  fireEvent.click(trigger);
  return { trigger, input: screen.getByRole("combobox") };
}

describe("命令面板", () => {
  beforeEach(() => {
    mode = "photo";
    vi.mocked(albumsApi.search)
      .mockReset()
      .mockResolvedValue({
        ok: true,
        count: 1,
        results: [
          {
            kind: "smartCollection",
            path: "smart:露营+海边",
            name: "露营+海边",
            count: 2,
          },
        ],
      });
  });

  it("空查询最多显示五条最近访问，方向键高亮并打开结果", async () => {
    const { input } = openPalette();
    expect(input).toHaveFocus();
    expect(screen.getAllByRole("option", { name: /最近相册/ })).toHaveLength(5);
    fireEvent.change(input, { target: { value: "露营" } });
    const result = await screen.findByRole("option", { name: /露营\+海边/ });
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(
      screen.getByRole("option", { name: "查看全部结果" }),
    ).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", result.id);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("当前地址")).toHaveTextContent("/photo/tags/");
  });

  it("名称建议防抖 180ms，Shift+Enter 打开全量名称结果", async () => {
    vi.useFakeTimers();
    try {
      const { input } = openPalette("/photo/library?q=目录");
      expect(input).toHaveValue("");
      fireEvent.change(input, { target: { value: "露" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(120);
      });
      fireEvent.change(input, { target: { value: "露营" } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(179);
      });
      expect(albumsApi.search).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(albumsApi.search).toHaveBeenCalledTimes(1);
      expect(albumsApi.search).toHaveBeenCalledWith(
        "露营",
        "photo",
        10,
        undefined,
        expect.any(AbortSignal),
      );
      expect(screen.getByLabelText("当前地址")).toHaveTextContent(
        "/photo/library?q=目录",
      );
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
      expect(screen.getByLabelText("当前地址")).toHaveTextContent(
        "/photo/search?q=%E9%9C%B2%E8%90%A5&scope=name",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("画面与文字只在提交时跳转，漫画只提供名称", async () => {
    const { input } = openPalette();
    fireEvent.click(screen.getByRole("radio", { name: "画面与文字" }));
    expect(input).toHaveAccessibleName("搜索照片里的画面与文字");
    fireEvent.change(input, { target: { value: "海边" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByLabelText("当前地址")).toHaveTextContent(
      "&scope=content",
    );
    expect(albumsApi.search).not.toHaveBeenCalled();
  });

  it("漫画只提供名称作用域", () => {
    mode = "comic";
    openPalette("/comic");
    expect(screen.getByRole("combobox")).toHaveAccessibleName(/作品|漫画|标签/);
    expect(screen.queryByRole("radiogroup", { name: "搜索范围" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "画面与文字" })).toBeNull();
  });

  it("焦点绕回面板，Esc 先清空再关闭并归还焦点", async () => {
    const { trigger, input } = openPalette("/photo/search?q=%E6%B5%B7");
    const close = screen.getByRole("button", { name: "关闭命令面板" });
    for (const item of [
      input,
      close,
      ...screen.getAllByRole("radio", { name: /名称|画面与文字/ }),
    ]) {
      vi.spyOn(item, "offsetWidth", "get").mockReturnValue(44);
    }
    fireEvent.keyDown(input, { key: "Tab", shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: "Tab" });
    expect(input).toHaveFocus();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveValue("");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});
