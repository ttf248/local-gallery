import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigationType } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { useAlbumViewState } from "./useAlbumViewState";

/**
 * 相册页的视图状态：筛选条件与分组都住在地址栏里。
 *
 * 这里盯住两件事：
 * - 两套条件不叠加：进入分组时普通筛选被明确结束，地址栏里也不留。
 * - 用户的选择进历史，系统的纠错改地址（replace），不让后退打转。
 */
function Probe({ onState }: { onState: (state: ReturnType<typeof useAlbumViewState>) => void }) {
  const state = useAlbumViewState();
  onState(state);
  const location = useLocation();
  const navigationType = useNavigationType();
  return (
    <output data-testid="location">
      {location.pathname + location.search}|{navigationType}
    </output>
  );
}

function renderState(entry: string) {
  let latest: ReturnType<typeof useAlbumViewState> | null = null;
  const utils = render(
    <MemoryRouter initialEntries={[entry]}>
      <Probe
        onState={(state) => {
          latest = state;
        }}
      />
    </MemoryRouter>,
  );
  return {
    ...utils,
    get state() {
      if (!latest) throw new Error("视图状态还没渲染");
      return latest;
    },
  };
}

describe("useAlbumViewState", () => {
  it("进入分组时结束冲突的普通筛选条件", () => {
    const view = renderState(
      "/photo/albums/a_1?dimension=time&picks=only&personId=p_1",
    );
    expect(view.state.filterCount).toBe(2);

    act(() => view.state.setGroupId("sg_1"));

    // 地址栏里不再挂着在分组里根本不生效的条件。
    expect(screen.getByTestId("location").textContent).toContain(
      "/photo/albums/a_1?dimension=time&group=sg_1",
    );
    expect(view.state.filterCount).toBe(0);
  });

  it("选分组进历史，系统自动纠错改地址", () => {
    const view = renderState("/photo/albums/a_1?dimension=time");

    // 用户主动选分组：地址进历史，后退键能退回全部照片。
    act(() => view.state.setGroupId("sg_1"));
    expect(screen.getByTestId("location").textContent).toContain("|PUSH");

    // 分组被删掉之后的自动纠错：改地址，不往历史里追加失效的地址。
    act(() => view.state.setGroupId(null, { replace: true }));
    expect(screen.getByTestId("location").textContent).toContain("|REPLACE");
    expect(screen.getByTestId("location").textContent).toContain(
      "/photo/albums/a_1?dimension=time",
    );
  });

  it("分组没有维度作伴时删掉它：那不是一个存在的看法", () => {
    const view = renderState("/photo/albums/a_1?group=sg_1");

    act(() => view.state.setGroupId(null, { replace: true }));

    expect(screen.getByTestId("location").textContent).toContain(
      "/photo/albums/a_1|",
    );
  });

  it("换维度时清掉选中的分组", () => {
    const view = renderState("/photo/albums/a_1?dimension=time&group=sg_1");

    act(() => view.state.setDimension("place"));

    expect(view.state.groupId).toBeNull();
    expect(screen.getByTestId("location").textContent).toContain(
      "dimension=place",
    );
    expect(screen.getByTestId("location").textContent).not.toContain("group=");
  });
});
