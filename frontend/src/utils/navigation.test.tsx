import { describe, expect, it, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { fireEvent } from "@testing-library/dom";
import { MemoryRouter, useLocation } from "react-router-dom";
import { contextFallback, hasAppHistory, useSafeBack } from "./navigation";

function BackButton({ fallback }: { fallback: string | (() => string) }) {
  const goBack = useSafeBack(fallback);
  const location = useLocation();
  return (
    <>
      <button onClick={goBack}>back</button>
      <output data-testid="loc">{location.pathname}</output>
    </>
  );
}

/** 模拟 React Router 写进 history.state 的应用内历史深度。 */
function setHistoryIdx(idx: number | undefined) {
  window.history.replaceState(
    idx === undefined ? null : { usr: null, key: "default", idx },
    "",
  );
}

describe("hasAppHistory", () => {
  beforeEach(() => {
    setHistoryIdx(undefined);
  });

  it("history.state 缺失或没有 idx 时视为没有应用内历史", () => {
    setHistoryIdx(undefined);
    expect(hasAppHistory()).toBe(false);
    window.history.replaceState({ usr: null, key: "default" }, "");
    expect(hasAppHistory()).toBe(false);
  });

  it("idx 大于 0 表示应用内还有可回退的历史", () => {
    setHistoryIdx(0);
    expect(hasAppHistory()).toBe(false);
    setHistoryIdx(2);
    expect(hasAppHistory()).toBe(true);
  });
});

describe("useSafeBack", () => {
  beforeEach(() => {
    setHistoryIdx(undefined);
  });

  it("没有应用内历史时回到兜底路由，而不是退出应用", () => {
    setHistoryIdx(0);
    render(
      <MemoryRouter initialEntries={["/gallery"]}>
        <BackButton fallback="/albums/a_1" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("loc")).toHaveTextContent("/gallery");
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/albums/a_1");
  });

  it("兜底路由也可以是主页", () => {
    setHistoryIdx(0);
    render(
      <MemoryRouter initialEntries={["/albums/a_1"]}>
        <BackButton fallback="/" />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/");
  });

  // 上级要等资源摘要回来才知道：兜底是个函数，点击那一刻才求值。
  it("兜底可以是函数，按点击那一刻的答案回", () => {
    setHistoryIdx(0);
    let parent = "";
    render(
      <MemoryRouter initialEntries={["/photo/albums/a_1"]}>
        <BackButton fallback={() => parent} />
      </MemoryRouter>,
    );

    // 摘要还没回来：没有兜底就不动，绝不跳到应用外面。
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/photo/albums/a_1");

    // 摘要回来了：回到上级集合。
    parent = "/photo/albums/c_1";
    fireEvent.click(screen.getByText("back"));
    expect(screen.getByTestId("loc")).toHaveTextContent("/photo/albums/c_1");
  });
});

describe("contextFallback", () => {
  it("能确认上级就回上级", () => {
    expect(contextFallback("photo", "c_1")).toBe("/photo/albums/c_1");
    expect(contextFallback("comic", "c_work")).toBe("/comic/albums/c_work");
  });

  it("上级不明就回那一侧的结构入口", () => {
    expect(contextFallback("photo", "")).toBe("/photo/library");
    expect(contextFallback("photo", undefined)).toBe("/photo/library");
    expect(contextFallback("comic", undefined)).toBe("/comic/library");
  });
});
