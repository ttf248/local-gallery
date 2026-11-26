import { render, fireEvent, within } from "@testing-library/react";
import { it, expect } from "vitest";
import { Toolbar } from "./Toolbar";
it("工具条支持方向键、Home 与 End", () => {
  const toolbar = render(
    <Toolbar
      label="视图"
      start={<button>范围</button>}
      end={<button>筛选</button>}
    />,
  );
  const [a, b] = within(toolbar.getByRole("toolbar")).getAllByRole("button");
  a.focus();
  fireEvent.keyDown(a, { key: "ArrowRight" });
  expect(b).toHaveFocus();
  fireEvent.keyDown(b, { key: "Home" });
  expect(a).toHaveFocus();
  fireEvent.keyDown(a, { key: "End" });
  expect(b).toHaveFocus();
});
