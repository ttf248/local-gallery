import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stampLabel } from "../../utils/date";
import VisitStamp from "./VisitStamp";

describe("时刻徽章", () => {
  beforeEach(() => {
    // 本地时间正午：跨时区跑用例时，「今天」「昨天」的判定仍然成立。
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 14, 12, 0, 0));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("今天给到分钟", () => {
    expect(stampLabel(new Date(2026, 10, 14, 9, 30).toISOString())).toBe(
      "09:30",
    );
  });

  it("昨天给「昨天 HH:MM」", () => {
    expect(stampLabel(new Date(2026, 10, 13, 21, 5).toISOString())).toBe(
      "昨天 21:05",
    );
  });

  it("今年更早给月日", () => {
    expect(stampLabel(new Date(2026, 10, 11, 4, 28).toISOString())).toBe(
      "11/11",
    );
  });

  it("往年补上年份：光看月日分不清是哪一年", () => {
    expect(stampLabel(new Date(2025, 2, 2, 10, 0).toISOString())).toBe(
      "2025/3/2",
    );
  });

  it("没有时刻就不画徽章", () => {
    const { container } = render(<VisitStamp at={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it("徽章带底板，压在浅色封面上也读得清", () => {
    const { container } = render(
      <VisitStamp at={new Date(2026, 10, 14, 9, 30).toISOString()} />,
    );
    const stamp = container.querySelector("[data-testid='visit-stamp']");
    expect(stamp).not.toBeNull();
    expect(stamp?.textContent).toBe("09:30");
    expect(stamp?.className).toContain("bg-black/65");
  });
});
