import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { PageChromeProvider } from "./PageChrome";
import { PageHeader } from "./PageHeader";
import { TopBar } from "./TopBar";
it("大标题离开视口时收进顶栏，详情有返回入口", () => {
  const noop = () => {};
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PageChromeProvider>
          <TopBar
            scrolled={false}
            onSearch={noop}
            onHelp={noop}
            onRefresh={noop}
            onScan={noop}
            onShuffle={noop}
            canScan
            shufflePending={false}
          />
          <PageHeader title="测试页面" chrome={{ backTo: "/photo" }} />
        </PageChromeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const bar = screen.getByTestId("top-bar");
  expect(bar).not.toHaveTextContent("测试页面");
  expect(screen.getByRole("button", { name: "返回" })).toBeInTheDocument();
  act(() => {
    (
      globalThis as unknown as {
        triggerIntersection: (node: Element, visible: boolean) => void;
      }
    ).triggerIntersection(screen.getByRole("heading"), false);
  });
  expect(bar).toHaveTextContent("测试页面");
});
