import { it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { Dialog } from "./Dialog";
import { Sheet } from "./Sheet";
it("嵌套浮层仅关闭顶层并归还焦点", () => {
  function Stack() {
    const [sheet, setSheet] = useState(true),
      [dialog, setDialog] = useState(false);
    return (
      <Sheet
        open={sheet}
        side="bottom"
        label="更多"
        onClose={() => setSheet(false)}
      >
        <button onClick={() => setDialog(true)}>打开</button>
        <Dialog title="确认" open={dialog} onClose={() => setDialog(false)}>
          <button>确定</button>
        </Dialog>
      </Sheet>
    );
  }
  render(<Stack />);
  const trigger = screen.getByText("打开");
  fireEvent.click(trigger);
  fireEvent.keyDown(screen.getByText("确定"), { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "确认" })).toBeNull();
  expect(trigger).toHaveFocus();
  expect(document.body.style.overflow).toBe("hidden");
  fireEvent.keyDown(trigger, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
