import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import {
  PageChromeProvider,
  usePageChrome,
  usePageChromeState,
} from "./PageChrome";
function Registration({
  name,
  child = false,
}: {
  name: string;
  child?: boolean;
}) {
  usePageChrome({ title: name });
  return child ? <Registration name="嵌套" /> : null;
}
function Read() {
  const state = usePageChromeState();
  return (
    <output>
      {state.title} {state.titleCollapsed ? "已收起" : "可见"}
    </output>
  );
}
it("StrictMode 下最后注册优先，卸载恢复父级，再卸载无残留", () => {
  const view = (show: boolean, child: boolean) => (
    <StrictMode>
      <PageChromeProvider>
        <Read />
        {show && <Registration name="父级" child={child} />}
      </PageChromeProvider>
    </StrictMode>
  );
  const { rerender } = render(view(true, true));
  expect(screen.getByRole("status")).toHaveTextContent("嵌套 已收起");
  rerender(view(true, false));
  expect(screen.getByRole("status")).toHaveTextContent("父级 已收起");
  rerender(view(false, false));
  expect(screen.getByRole("status")).not.toHaveTextContent("父级");
});
