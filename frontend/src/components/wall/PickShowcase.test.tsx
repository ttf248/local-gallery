import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PickShowcase from "./PickShowcase";

interface Item {
  id: string;
  name: string;
  album: string;
  width: number;
  height: number;
}

const items: Item[] = [
  { id: "f_1", name: "竖幅.jpg", album: "2024", width: 1200, height: 3046 },
  { id: "f_2", name: "横幅.jpg", album: "2024", width: 4000, height: 2000 },
];

describe("少量精选的陈列", () => {
  it("框按照片自己的形状长，不把竖幅裁成横幅", () => {
    render(
      <PickShowcase
        items={items}
        onOpen={() => {}}
        onTogglePick={() => {}}
        name={(item) => item.name}
        source={(item) => item.album}
        ratio={(item) => item.width / item.height}
      />,
    );

    const frames = document.querySelectorAll(
      "[data-testid='pick-showcase'] > figure > div",
    );
    expect(frames).toHaveLength(2);
    // 竖幅按自己的 0.39 摆，横幅按自己的 2:1 摆：都不裁。
    expect(frames[0].getAttribute("style")).toContain("aspect-ratio: 0.393");
    expect(frames[1].getAttribute("style")).toContain("aspect-ratio: 2");
    // 框不宽过上限，竖幅也不高过上限：221 = 560 × 0.394。
    expect(frames[0].getAttribute("style")).toContain("width: 221px");
    expect(frames[1].getAttribute("style")).toContain("width: 420px");
  });

  it("点照片打开大图，角标把照片移出精选", () => {
    const onOpen = vi.fn();
    const onTogglePick = vi.fn();
    render(
      <PickShowcase
        items={items}
        onOpen={onOpen}
        onTogglePick={onTogglePick}
        name={(item) => item.name}
        source={(item) => item.album}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "查看 竖幅.jpg" }));
    expect(onOpen).toHaveBeenCalledWith(0);

    fireEvent.click(
      screen.getByRole("button", { name: "把 横幅.jpg 移出精选" }),
    );
    expect(onTogglePick).toHaveBeenCalledWith(items[1]);
  });

  it("多选模式下点照片改为勾选", () => {
    const onOpen = vi.fn();
    const onToggleSelect = vi.fn();
    render(
      <PickShowcase
        items={items}
        onOpen={onOpen}
        onTogglePick={() => {}}
        name={(item) => item.name}
        selecting
        isSelected={(id) => id === "f_1"}
        onToggleSelect={onToggleSelect}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "选择「竖幅.jpg」" }));
    expect(onToggleSelect).toHaveBeenCalledWith(items[0]);
    expect(onOpen).not.toHaveBeenCalled();
    expect(screen.getByText("已选")).toBeInTheDocument();
  });

  it("照片的出处写在照片下面", () => {
    render(
      <PickShowcase
        items={items}
        onOpen={() => {}}
        onTogglePick={() => {}}
        name={(item) => item.name}
        source={(item) => item.album}
      />,
    );
    expect(screen.getAllByText("2024")).toHaveLength(2);
  });
});
