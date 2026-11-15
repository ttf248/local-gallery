import { act, renderHook } from "@testing-library/react";
import { expect, it } from "vitest";
import { useContextMenu } from "./useContextMenu";

/** 右键事件只需要这几个字段：位置、焦点所在与默认行为。 */
function rightClick(clientX: number, clientY: number) {
  return {
    clientX,
    clientY,
    preventDefault: () => {},
    currentTarget: { focus: () => {} },
  } as unknown as React.MouseEvent<HTMLButtonElement>;
}

it("右键记下位置与那一项", () => {
  const { result } = renderHook(() => useContextMenu<string>());
  act(() => result.current.open("f_1", rightClick(120, 240)));
  expect(result.current.menu?.item).toBe("f_1");
  expect(result.current.menu?.x).toBe(120);
  expect(result.current.menu?.y).toBe(240);
});

it("关掉后没有菜单", () => {
  const { result } = renderHook(() => useContextMenu<string>());
  act(() => result.current.open("f_1", rightClick(10, 20)));
  act(() => result.current.close());
  expect(result.current.menu).toBeNull();
});

it("右键不吃掉浏览器的默认行为", () => {
  let prevented = false;
  const event = {
    clientX: 1,
    clientY: 2,
    preventDefault: () => {
      prevented = true;
    },
    currentTarget: { focus: () => {} },
  } as unknown as React.MouseEvent<HTMLButtonElement>;
  const { result } = renderHook(() => useContextMenu<string>());
  act(() => result.current.open("f_1", event));
  expect(prevented).toBe(true);
});
