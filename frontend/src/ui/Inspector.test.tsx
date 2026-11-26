import { render, screen, fireEvent } from "@testing-library/react";
import { it, expect } from "vitest";
import { Inspector } from "./Inspector";
import { useState } from "react";
it("进入信息面板时移入焦点，关闭时归还", () => {
  function View() {
    const [open, set] = useState(false);
    return (
      <>
        <button onClick={() => set(true)}>信息</button>
        <Inspector open={open} title="照片信息" onClose={() => set(false)}>
          说明
        </Inspector>
      </>
    );
  }
  render(<View />);
  const entry = screen.getByRole("button", { name: "信息" });
  entry.focus();
  fireEvent.click(entry);
  const close = screen.getByRole("button", { name: "关闭信息面板" });
  expect(close).toHaveFocus();
  fireEvent.keyDown(close, { key: "Escape" });
  expect(entry).toHaveFocus();
});
