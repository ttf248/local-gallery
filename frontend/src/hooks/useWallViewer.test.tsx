import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useWallViewer, type WallViewerItem } from "./useWallViewer";

function item(id: string, albumName = "相册"): WallViewerItem {
  return {
    id,
    kind: "image",
    name: `${id}.jpg`,
    index: 0,
    kindIndex: 0,
    albumName,
    albumId: "a_1",
  };
}

const items = [item("f_1"), item("f_2"), item("f_3")];

function setup(list = items) {
  return renderHook(() =>
    useWallViewer({
      items: list,
      total: list.length,
      albumName: (entry) => entry.albumName ?? "",
      albumHref: (entry) => `/photo/album/${entry.albumId ?? ""}`,
    }),
  );
}

it("没开预览时没有可渲染的属性", () => {
  const { result } = setup();
  expect(result.current.viewer).toBeNull();
  expect(result.current.index).toBeNull();
});

it("打开一张后属性齐全：标题、出处与总数", () => {
  const { result } = setup();
  act(() => result.current.open(1));
  expect(result.current.index).toBe(1);
  expect(result.current.viewer?.index).toBe(1);
  expect(result.current.viewer?.albumName).toBe("相册");
  expect(result.current.viewer?.albumHref).toBe("/photo/album/a_1");
  expect(result.current.viewer?.totalCount).toBe(3);
});

it("关掉预览后记住刚才看的那张：墙要滚回去", () => {
  const { result } = setup();
  act(() => result.current.open(2));
  act(() => result.current.close());
  expect(result.current.viewer).toBeNull();
  expect(result.current.focusIndex).toBe(2);
});

it("再打开同一张时重新对一次位置，不沿用上一次的记录", () => {
  const { result } = setup();
  act(() => result.current.open(2));
  act(() => result.current.close());
  act(() => result.current.open(2));
  expect(result.current.focusIndex).toBeNull();
});

it("换了一组内容时直接清掉，不留下上一组的下标", () => {
  const { result } = setup();
  act(() => result.current.open(1));
  act(() => result.current.reset());
  expect(result.current.viewer).toBeNull();
  expect(result.current.focusIndex).toBeNull();
});

it("按资源 ID 打开：那一项还没取到时不摆空预览", () => {
  const { result } = setup();
  act(() => result.current.openById("f_9"));
  expect(result.current.openId).toBe("f_9");
  expect(result.current.viewer).toBeNull();
});

it("按资源 ID 打开：那一项取到了就摆出来", () => {
  const { result } = setup();
  act(() => result.current.openById("f_2"));
  expect(result.current.index).toBe(1);
  expect(result.current.viewer?.index).toBe(1);
});

it("翻页改的是开着的那一项，不是下标", () => {
  const { result } = setup();
  act(() => result.current.open(0));
  act(() => result.current.viewer?.onIndexChange(2));
  expect(result.current.openId).toBe("f_3");
  expect(result.current.index).toBe(2);
});
