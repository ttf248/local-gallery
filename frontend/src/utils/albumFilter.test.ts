import { describe, expect, it } from "vitest";
import {
  albumFilterCount,
  albumFilterChips,
  albumFilterParams,
  albumMonthInRange,
  albumYearInRange,
  parseAlbumFilter,
  type AlbumFilterState,
} from "./albumFilter";

describe("照片墙筛选条件", () => {
  it("从地址栏读出条件，认不出的值降级为默认", () => {
    const params = new URLSearchParams(
      "from=2024-06&to=2024-08&personId=p_1&adcode=330100&picks=only&scene=similar&collapse=1",
    );
    expect(parseAlbumFilter(params)).toEqual({
      from: "2024-06",
      to: "2024-08",
      personId: "p_1",
      adcode: 330100,
      picks: "only",
      scene: "similar",
      collapse: true,
    });
  });

  it("地址栏里写错的值不报错，也不影响其它条件", () => {
    const params = new URLSearchParams(
      "from=2024-13&to=不是月&personId=p_1&picks=maybe&scene=nope&adcode=abc",
    );
    const state = parseAlbumFilter(params);
    expect(state.from).toBeUndefined();
    expect(state.to).toBeUndefined();
    expect(state.picks).toBeUndefined();
    expect(state.scene).toBeUndefined();
    expect(state.adcode).toBeUndefined();
    expect(state.personId).toBe("p_1");
  });

  it("起止写反时按读得懂的方向理解", () => {
    const state = parseAlbumFilter(
      new URLSearchParams("from=2024-08&to=2024-06"),
    );
    expect(state.from).toBe("2024-06");
    expect(state.to).toBe("2024-08");
  });

  it("只写生效的条件，其余不占地址", () => {
    const params = albumFilterParams({ from: "2024-06", picks: "none" });
    expect(params.get("from")).toBe("2024-06");
    expect(params.get("picks")).toBe("none");
    expect(params.get("to")).toBeNull();
    expect(params.get("personId")).toBeNull();
    expect(params.get("collapse")).toBeNull();
  });

  it("折叠是显示方式，不算一条筛选", () => {
    expect(albumFilterCount({ collapse: true })).toBe(0);
    expect(albumFilterCount({ from: "2024-06", to: "2024-06" })).toBe(1);
    expect(
      albumFilterCount({
        from: "2024-06",
        personId: "p_1",
        picks: "only",
        scene: "similar",
      }),
    ).toBe(4);
  });

  it("时间范围能圈出月份与年份", () => {
    const state: AlbumFilterState = { from: "2024-03", to: "2024-09" };
    expect(albumMonthInRange(state, "2024-05")).toBe(true);
    expect(albumMonthInRange(state, "2024-02")).toBe(false);
    expect(albumMonthInRange(state, "2024-11")).toBe(false);
    expect(albumYearInRange(state, "2024")).toBe(true);
    expect(albumYearInRange(state, "2023")).toBe(false);
  });

  it("条件逐条列出来，每条都能单独去掉", () => {
    const state: AlbumFilterState = {
      from: "2024-06",
      to: "2024-06",
      personId: "p_1",
      picks: "only",
    };
    const chips = albumFilterChips(state, {
      total: 10,
      videos: 0,
      time: {
        available: true,
        months: [],
        analyzedCount: 0,
        unresolvedCount: 0,
      },
      people: {
        available: true,
        items: [{ id: "p_1", name: "人物 1", count: 3, confirmed: true }],
        analyzedCount: 3,
      },
      places: { available: true, items: [], locatedCount: 0 },
      picks: { pickedCount: 1 },
      groupPhotos: { available: true, count: 0 },
      similarity: {
        available: true,
        groupCount: 0,
        photoCount: 0,
        stale: false,
      },
    });
    expect(chips.map((chip) => chip.key)).toEqual(["time", "person", "picks"]);
    expect(chips[1].label).toBe("人物：人物 1");
    // 去掉人物那一条，其余条件原样留着。
    expect(chips[1].clear.personId).toBeUndefined();
    expect(chips[1].clear.from).toBe("2024-06");
    expect(chips[1].clear.picks).toBe("only");
  });
});
