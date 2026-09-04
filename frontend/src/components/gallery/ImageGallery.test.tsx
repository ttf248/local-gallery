import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useGalleryStore } from "../../store/galleryStore";
import ImageGallery from "./ImageGallery";

const virtuosoMocks = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
}));

vi.mock("react-virtuoso", async () => {
  const React = await import("react");
  interface MockVirtuosoProps {
    rangeChanged?: (range: { startIndex: number; endIndex: number }) => void;
  }

  return {
    Virtuoso: React.forwardRef<
      { scrollToIndex: typeof virtuosoMocks.scrollToIndex },
      MockVirtuosoProps
    >(function MockVirtuoso({ rangeChanged }, ref) {
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: virtuosoMocks.scrollToIndex,
      }));
      return React.createElement(
        "button",
        {
          type: "button",
          "data-testid": "virtuoso-range",
          onClick: () => rangeChanged?.({ startIndex: 2, endIndex: 3 }),
        },
        "更新可见范围",
      );
    }),
  };
});

describe("ImageGallery 连续模式", () => {
  beforeEach(() => {
    virtuosoMocks.scrollToIndex.mockClear();
    useGalleryStore.setState({
      index: 0,
      mode: "continuous",
      zoom: 1,
      rotation: 0,
      fit: "fit",
      direction: "ltr",
    });
  });

  it("把顶部可见图片索引上报给父组件且不产生反向滚动", () => {
    const onVisibleIndexChange = vi.fn((index: number) => {
      useGalleryStore.getState().setIndex(index);
    });
    render(
      <ImageGallery
        images={["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg"]}
        onVisibleIndexChange={onVisibleIndexChange}
      />,
    );
    virtuosoMocks.scrollToIndex.mockClear();

    fireEvent.click(screen.getByTestId("virtuoso-range"));

    expect(onVisibleIndexChange).toHaveBeenCalledWith(2);
    expect(useGalleryStore.getState().index).toBe(2);
    expect(virtuosoMocks.scrollToIndex).not.toHaveBeenCalled();
  });

  it("外部页码变化时驱动虚拟列表定位到目标图片", async () => {
    render(<ImageGallery images={["/1.jpg", "/2.jpg", "/3.jpg", "/4.jpg"]} />);
    virtuosoMocks.scrollToIndex.mockClear();

    act(() => useGalleryStore.getState().setIndex(3));

    await waitFor(() => {
      expect(virtuosoMocks.scrollToIndex).toHaveBeenCalledWith({
        index: 3,
        align: "start",
      });
    });
  });
});
