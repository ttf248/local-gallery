import { it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { StrictMode, createRef } from "react";
import { Dialog } from "./Dialog";
it("焦点进入指定位置并循环，背景惰性与滚动锁随关闭恢复", () => {
  const focus = createRef<HTMLInputElement>();
  const view = (open: boolean) => (
    <StrictMode>
      <button>来源</button>
      <Dialog title="编辑" initialFocus={focus} open={open} onClose={() => {}}>
        <input ref={focus} />
        <button>保存</button>
      </Dialog>
    </StrictMode>
  );
  const { rerender } = render(view(false));
  const source = screen.getByText("来源");
  source.focus();
  const before = document.body.style.overflow;
  rerender(view(true));
  expect(focus.current).toHaveFocus();
  expect(source.closest("[inert]")).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");
  screen.getByText("保存").focus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab" });
  expect(screen.getByRole("button", { name: "关闭" })).toHaveFocus();
  fireEvent.keyDown(document.activeElement!, { key: "Tab", shiftKey: true });
  expect(screen.getByText("保存")).toHaveFocus();
  rerender(view(false));
  expect(source).toHaveFocus();
  expect(source.closest("[inert]")).toBeNull();
  expect(document.body.style.overflow).toBe(before);
});
