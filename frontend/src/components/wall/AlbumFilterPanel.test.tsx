import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import AlbumFilterPanel from "./AlbumFilterPanel";
import type { AlbumFilterFacets } from "../../api/library";
import type { AlbumFilterState } from "../../utils/albumFilter";

/** 一份「什么都有」的筛选条件。 */
function fullFacets(): AlbumFilterFacets {
  return {
    total: 12,
    videos: 1,
    time: {
      available: true,
      months: [
        { month: "2024-05", count: 4 },
        { month: "2024-06", count: 3 },
        { month: "2023-11", count: 5 },
      ],
      analyzedCount: 12,
      unresolvedCount: 0,
    },
    people: {
      available: true,
      items: [{ id: "p_1", name: "妈妈", count: 6, confirmed: true }],
      analyzedCount: 8,
    },
    places: {
      available: true,
      items: [{ adcode: 330100, name: "杭州市", level: "city", count: 5 }],
      locatedCount: 7,
    },
    picks: { pickedCount: 2 },
    groupPhotos: { available: true, count: 3 },
    similarity: {
      available: true,
      groupCount: 2,
      photoCount: 4,
      stale: false,
    },
  };
}

/** 面板自己不改状态，这里用一层壳把状态接上。 */
function Harness({
  initial,
  facets,
  onState,
}: {
  initial?: AlbumFilterState;
  facets?: AlbumFilterFacets;
  onState?: (state: AlbumFilterState) => void;
}) {
  const [state, setState] = useState<AlbumFilterState>(initial ?? {});
  return (
    <AlbumFilterPanel
      state={state}
      facets={facets}
      resultCount={12}
      onClear={() => setState({})}
      onChange={(next) => {
        setState(next);
        onState?.(next);
      }}
    />
  );
}

describe("照片墙的筛选面板", () => {
  it("点年份选整年，再点一次取消", () => {
    let latest: AlbumFilterState = {};
    render(<Harness facets={fullFacets()} onState={(s) => (latest = s)} />);

    fireEvent.click(screen.getByRole("button", { name: "2024年" }));
    expect(latest.from).toBe("2024-01");
    expect(latest.to).toBe("2024-12");

    fireEvent.click(screen.getByRole("button", { name: "2024年" }));
    expect(latest.from).toBeUndefined();
    expect(latest.to).toBeUndefined();
  });

  it("上次选的是这年里的某个月，点年份要的是整年，不是取消", () => {
    let latest: AlbumFilterState = {};
    render(
      <Harness
        facets={fullFacets()}
        initial={{ from: "2024-05", to: "2024-05" }}
        onState={(s) => (latest = s)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "2024年" }));
    expect(latest.from).toBe("2024-01");
    expect(latest.to).toBe("2024-12");
  });

  it("月份能单独选中，也能再点一次取消", () => {
    let latest: AlbumFilterState = {};
    render(<Harness facets={fullFacets()} onState={(s) => (latest = s)} />);

    fireEvent.click(screen.getByRole("button", { name: "展开2024年的月份" }));
    fireEvent.click(screen.getByRole("button", { name: /5月/ }));
    expect(latest.from).toBe("2024-05");
    expect(latest.to).toBe("2024-05");

    fireEvent.click(screen.getByRole("button", { name: /5月/ }));
    expect(latest.from).toBeUndefined();
    expect(latest.to).toBeUndefined();
  });

  it("人物与地点能选中，也能再点一次取消", () => {
    let latest: AlbumFilterState = {};
    render(<Harness facets={fullFacets()} onState={(s) => (latest = s)} />);

    fireEvent.click(screen.getByRole("button", { name: /妈妈/ }));
    expect(latest.personId).toBe("p_1");
    fireEvent.click(screen.getByRole("button", { name: /妈妈/ }));
    expect(latest.personId).toBeUndefined();

    fireEvent.click(screen.getByRole("button", { name: /杭州市/ }));
    expect(latest.adcode).toBe(330100);
    fireEvent.click(screen.getByRole("button", { name: /杭州市/ }));
    expect(latest.adcode).toBeUndefined();
  });

  it("精选口径能选成只看已精选或只看未精选", () => {
    let latest: AlbumFilterState = {};
    render(<Harness facets={fullFacets()} onState={(s) => (latest = s)} />);
    const picks = within(screen.getByRole("radiogroup", { name: "精选口径" }));

    fireEvent.click(picks.getByRole("radio", { name: "已精选" }));
    expect(latest.picks).toBe("only");
    fireEvent.click(picks.getByRole("radio", { name: "未精选" }));
    expect(latest.picks).toBe("none");
    fireEvent.click(picks.getByRole("radio", { name: "全部" }));
    expect(latest.picks).toBeUndefined();
  });

  it("缺分析结果的那一维写清原因，不摆空选项", () => {
    const facets = fullFacets();
    facets.time.available = false;
    facets.time.reason = "这本相册还没有 EXIF 分析结果，先在任务中心运行元数据分析";
    facets.people.available = false;
    facets.people.reason = "还没有人脸分析结果，先在任务中心运行人脸分析";
    render(<Harness facets={facets} />);

    expect(
      screen.getByText(facets.time.reason!, { exact: false }),
    ).toBeTruthy();
    expect(
      screen.getByText(facets.people.reason!, { exact: false }),
    ).toBeTruthy();
    // 没有月份可摆，年份按钮也不该出现。
    expect(screen.queryByRole("button", { name: "2024年" })).toBeNull();
    expect(screen.queryByRole("button", { name: /妈妈/ })).toBeNull();
  });

  it("画面口径里不可用的选项是禁用的，并说清为什么", () => {
    const facets = fullFacets();
    facets.groupPhotos.available = false;
    facets.groupPhotos.reason = "还没有人脸分析结果，先在任务中心运行人脸分析";
    render(<Harness facets={facets} />);

    const scene = within(screen.getByRole("radiogroup", { name: "画面口径" }));
    const group = scene.getByRole("radio", { name: "合照" }) as HTMLButtonElement;
    expect(group.disabled).toBe(true);
    expect(group.title).toBe(facets.groupPhotos.reason);
    // 相似照片这一维还有结果，就不该把整段都关掉。
    const similar = scene.getByRole("radio", {
      name: "相似照片",
    }) as HTMLButtonElement;
    expect(similar.disabled).toBe(false);
  });
});
