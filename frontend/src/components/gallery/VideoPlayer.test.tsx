import { fireEvent, render, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import VideoPlayer from "./VideoPlayer";

vi.mock("../../api/videos", () => ({
  videoUrl: (fileId: string) => `/api/media/${fileId}`,
  getTranscodeStatus: vi.fn(() => new Promise(() => {})),
}));

describe("VideoPlayer 活动恢复", () => {
  beforeEach(() => vi.clearAllMocks());

  it("元数据就绪后恢复毫秒活动换算的秒位置", async () => {
    const onMetaLoaded = vi.fn();
    const onProgress = vi.fn();
    render(
      <VideoPlayer
        src="f_video"
        initialPositionSec={42.5}
        onMetaLoaded={onMetaLoaded}
        onProgress={onProgress}
      />,
    );

    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 100,
    });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(42.5);
    expect(onMetaLoaded).toHaveBeenCalledWith(100);

    video.currentTime = 43;
    fireEvent.timeUpdate(video);
    expect(onProgress).toHaveBeenCalledWith(43);
    await waitFor(() =>
      expect(video.getAttribute("src")).toBe("/api/media/f_video"),
    );
  });

  it("已完成记录恢复时不精确定位到片尾", () => {
    render(<VideoPlayer src="f_video" initialPositionSec={100} />);
    const video = document.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "duration", {
      configurable: true,
      value: 100,
    });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(99.9);
  });
});
