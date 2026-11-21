import { describe, expect, it } from "vitest";
import type { LibraryFeedItem } from "../api/library";
import {
  buildTimelineGroups,
  timelineGroupKey,
  timelineGroupLabel,
  timelineSourceLabel,
  timelineYearRange,
} from "./timeline";

function item(
  id: string,
  capturedAt: string | undefined,
  dateSource: LibraryFeedItem["dateSource"],
): LibraryFeedItem {
  return {
    id,
    kind: "image",
    name: `${id}.jpg`,
    index: 0,
    kindIndex: 0,
    albumId: "a_1",
    albumName: "相册",
    capturedAt,
    dateSource,
  };
}

describe("时间线的分组", () => {
  it("有拍摄证据的按月份分，修改时间的那一段单独分", () => {
    expect(timelineGroupKey(item("f_1", "2024-05-04T10:00:00Z", "exif"))).toBe(
      "2024-05",
    );
    expect(
      timelineGroupKey(item("f_2", "2024-06-04T10:00:00Z", "filename")),
    ).toBe("2024-06");
    expect(
      timelineGroupKey(item("f_3", "2024-06-04T10:00:00Z", "modified")),
    ).toBe("unknown");
    expect(timelineGroupKey(item("f_4", undefined, "exif"))).toBe("unknown");
  });

  it("只有年份精度的媒体保留为年份段，不补造月份", () => {
    const yearOnly = {
      ...item("f_year", undefined, "folder"),
      datePrecision: "year" as const,
      dateValue: "2024",
    };
    const groups = buildTimelineGroups([yearOnly]);

    expect(timelineGroupKey(yearOnly)).toBe("2024");
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({
      key: "2024",
      label: "2024 年",
      year: 2024,
      month: 0,
    });
  });

  it("月份标题说人话", () => {
    expect(timelineGroupLabel("2024-05")).toBe("2024 年 5 月");
    expect(timelineGroupLabel("unknown")).toBe("日期未知");
  });

  it("分组按月份排开，日期未知的那一段在最后", () => {
    const groups = buildTimelineGroups([
      item("f_1", "2024-05-04T10:00:00Z", "exif"),
      item("f_2", "2024-05-05T10:00:00Z", "exif"),
      item("f_3", "2023-08-09T10:00:00Z", "filename"),
      item("f_4", "2021-02-03T00:00:00Z", "modified"),
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      "2024-05",
      "2023-08",
      "unknown",
    ]);
    expect(groups[0].count).toBe(2);
    expect(groups[1].count).toBe(1);
    expect(groups[2].count).toBe(1);
  });

  it("全是拍摄时间的段落不必多说，推断出来的必须说明", () => {
    const groups = buildTimelineGroups([
      item("f_1", "2024-05-04T10:00:00Z", "exif"),
      item("f_2", "2024-06-04T10:00:00Z", "filename"),
      item("f_3", "2021-02-03T00:00:00Z", "modified"),
    ]);
    expect(groups[0].note).toBe("");
    expect(groups[1].note).toBe("含推断时间");
    expect(groups[2].note).toBe("只有文件修改时间，不是拍摄时间");
  });

  it("时间来源各有各的说法", () => {
    expect(timelineSourceLabel("exif")).toBe("拍摄时间");
    expect(timelineSourceLabel("filename")).toBe("文件名推断");
    expect(timelineSourceLabel("folder")).toBe("目录推断");
    expect(timelineSourceLabel("modified")).toBe("日期未知");
  });

  it("年份区间说清时间线跨了多少年", () => {
    expect(timelineYearRange([])).toBe("");
    expect(timelineYearRange([{ year: 2024 }])).toBe("2024");
    expect(timelineYearRange([{ year: 2024 }, { year: 2011 }])).toBe(
      "2011 – 2024",
    );
  });
});
