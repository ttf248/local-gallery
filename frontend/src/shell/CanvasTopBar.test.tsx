import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen } from "@testing-library/react";
import { expect, it,vi } from "vitest";
import { PageChromeProvider } from "./PageChrome";
import { PageHero } from "./PageHero";
import { CanvasTopBar } from "./CanvasTopBar";
vi.mock("../hooks/useMediaQuery",()=>({useMediaQuery:()=>true,WIDE_LAYOUT_QUERY:"(min-width:1024px)"}));
it("大标题离开视口时收进顶栏，详情有返回入口", () => {
  const noop = () => {};
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <PageChromeProvider>
          <CanvasTopBar
            scrolled
            onSearch={noop}
            onHelp={noop}
            onRefresh={noop}
            onScan={noop}
            onShuffle={noop}
            canScan
            shufflePending={false}
          />
          <PageHero title="测试页面" chrome={{ backTo: "/photo" }} />
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
