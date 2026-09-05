import { describe, it, expect } from "vitest";
import {
  asProgressLike,
  displayedPageIndex,
  isCompleted,
  isInProgress,
  isUnread,
  progressPercent,
} from "./progress";

describe("progress 语义边界", () => {
  describe("displayedPageIndex", () => {
    it("双页模式记录跨页中实际展示的末页", () => {
      expect(displayedPageIndex("double", 8, 10)).toBe(9);
      expect(displayedPageIndex("double", 8, 9)).toBe(8);
    });

    it("连续模式记录当前可见区末页并忽略陈旧范围", () => {
      expect(
        displayedPageIndex("continuous", 2, 10, {
          startIndex: 2,
          endIndex: 4,
        }),
      ).toBe(4);
      expect(
        displayedPageIndex("continuous", 6, 10, {
          startIndex: 2,
          endIndex: 4,
        }),
      ).toBe(6);
    });
  });

  describe("isUnread", () => {
    it("无记录算未读", () => {
      expect(isUnread(null)).toBe(true);
      expect(isUnread(undefined)).toBe(true);
    });
    it("total=0 算未读（空相册）", () => {
      expect(isUnread({ index: 0, total: 0 })).toBe(true);
    });
    it("已保存 index=0 不算未读", () => {
      expect(isUnread({ index: 0, total: 50 })).toBe(false);
    });
    it("index>0 不算未读（在读）", () => {
      expect(isUnread({ index: 5, total: 50 })).toBe(false);
    });
    it("index==total 不算未读（已读完）", () => {
      expect(isUnread({ index: 50, total: 50 })).toBe(false);
    });
  });

  describe("isInProgress", () => {
    it("无记录不算在读", () => {
      expect(isInProgress(null)).toBe(false);
      expect(isInProgress(undefined)).toBe(false);
    });
    it("total=0 不算在读（避免除零 / 空相册）", () => {
      expect(isInProgress({ index: 5, total: 0 })).toBe(false);
    });
    it("多页相册 index=0 算在读", () => {
      expect(isInProgress({ index: 0, total: 50 })).toBe(true);
    });
    // 关键回归测试:已读完不应该再出现在「继续阅读」区。
    it("到达最后一个 0-based 索引后不算在读", () => {
      expect(isInProgress({ index: 49, total: 50 })).toBe(false);
      expect(isInProgress({ index: 50, total: 50 })).toBe(false);
    });
    it("index>total 不算在读（异常数据,不显示）", () => {
      expect(isInProgress({ index: 100, total: 50 })).toBe(false);
    });
    it("0<=index<total-1 才算在读", () => {
      expect(isInProgress({ index: 0, total: 50 })).toBe(true);
      expect(isInProgress({ index: 1, total: 50 })).toBe(true);
      expect(isInProgress({ index: 25, total: 50 })).toBe(true);
      expect(isInProgress({ index: 48, total: 50 })).toBe(true);
    });
    it("单页相册保存 index=0 后直接算已读完", () => {
      expect(isInProgress({ index: 0, total: 1 })).toBe(false);
      expect(isCompleted({ index: 0, total: 1 })).toBe(true);
    });
  });

  describe("完成状态与百分比", () => {
    it("最后一个索引及历史越界完成值都算完成", () => {
      expect(isCompleted({ index: 48, total: 50 })).toBe(false);
      expect(isCompleted({ index: 49, total: 50 })).toBe(true);
      expect(isCompleted({ index: 50, total: 50 })).toBe(true);
    });

    it("按首尾索引计算百分比，并钳制异常值", () => {
      expect(progressPercent(null)).toBeNull();
      expect(progressPercent({ index: 0, total: 1 })).toBe(100);
      expect(progressPercent({ index: 0, total: 5 })).toBe(0);
      expect(progressPercent({ index: 2, total: 5 })).toBe(50);
      expect(progressPercent({ index: 4, total: 5 })).toBe(100);
      expect(progressPercent({ index: 99, total: 5 })).toBe(100);
    });
  });

  describe("asProgressLike", () => {
    it("undefined → null", () => {
      expect(asProgressLike(undefined)).toBeNull();
    });
    it("图片活动 → 收敛到 ProgressLike", () => {
      expect(
        asProgressLike({
          albumId: "a_0000000000000000000001",
          mediaKind: "image",
          pageIndex: 5,
          pageCount: 50,
          status: "in_progress",
          updated: "2026-01-01T00:00:00Z",
        }),
      ).toEqual({ index: 5, total: 50 });
    });
    it("媒体库图片数变化后使用当前总数重算状态", () => {
      expect(
        asProgressLike(
          {
            albumId: "a_0000000000000000000001",
            mediaKind: "image",
            pageIndex: 9,
            pageCount: 10,
            status: "completed",
            updated: "2026-01-01T00:00:00Z",
          },
          12,
        ),
      ).toEqual({ index: 9, total: 12 });
    });
    it("拒绝把旧缓存中的无效总数套用到当前相册", () => {
      expect(
        asProgressLike(
          {
            albumId: "a_0000000000000000000001",
            mediaKind: "image",
            pageIndex: 0,
            pageCount: 0,
            status: "in_progress",
            updated: "2026-01-01T00:00:00Z",
          },
          12,
        ),
      ).toBeNull();
    });
  });
});
