import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { usePhotoCompare } from "./usePhotoCompare";
import { usePhotoSelectionStore } from "../store/photoSelectionStore";
import type { WallViewerItem } from "./useWallViewer";

function item(id: string, kind: "image" | "video" = "image"): WallViewerItem {
  return {
    id,
    kind,
    name: `${id}.jpg`,
    index: 0,
    kindIndex: 0,
    albumName: "相册",
  };
}

function setup() {
  return renderHook(() => usePhotoCompare((entry) => entry.albumName ?? ""));
}

beforeEach(() => {
  usePhotoSelectionStore.setState({ scope: "album:a_1", entries: {}, active: false });
});

it("钉一张进待对比", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1")));
  expect(result.current.pin?.id).toBe("f_1");
  expect(result.current.pair).toBeNull();
});

it("再钉另一张就并排打开", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1")));
  act(() => result.current.togglePin(item("f_2")));
  expect(result.current.pin).toBeNull();
  expect(result.current.pair?.map((entry) => entry.id)).toEqual(["f_1", "f_2"]);
});

it("钉同一张是取消", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1")));
  act(() => result.current.togglePin(item("f_1")));
  expect(result.current.pin).toBeNull();
  expect(result.current.pair).toBeNull();
});

it("视频没有可并排的画面：对比只对图片开放", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1", "video")));
  expect(result.current.pin).toBeNull();
});

it("多选里的两张直接并排打开", () => {
  usePhotoSelectionStore.setState({
    entries: {
      f_1: {
        id: "f_1",
        name: "f_1.jpg",
        albumId: "a_1",
        albumName: "相册",
        version: "1",
        width: 100,
        height: 200,
      },
      f_2: {
        id: "f_2",
        name: "f_2.jpg",
        albumId: "a_2",
        albumName: "另一本",
        version: "1",
        width: 100,
        height: 200,
      },
    },
  });
  const { result } = setup();
  act(() => result.current.compareSelected());
  expect(result.current.pair?.map((entry) => entry.id)).toEqual(["f_1", "f_2"]);
  expect(result.current.pair?.[1].albumName).toBe("另一本");
});

it("选中的不是两张时不并排打开", () => {
  const { result } = setup();
  act(() => result.current.compareSelected());
  expect(result.current.pair).toBeNull();
});

it("左右互换", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1")));
  act(() => result.current.togglePin(item("f_2")));
  act(() => result.current.swap());
  expect(result.current.pair?.map((entry) => entry.id)).toEqual(["f_2", "f_1"]);
});

it("关掉并排对比", () => {
  const { result } = setup();
  act(() => result.current.togglePin(item("f_1")));
  act(() => result.current.togglePin(item("f_2")));
  act(() => result.current.close());
  expect(result.current.pair).toBeNull();
});
