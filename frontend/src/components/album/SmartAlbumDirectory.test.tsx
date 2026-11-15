import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import SmartAlbumDirectory from "./SmartAlbumDirectory";

describe("SmartAlbumDirectory", () => {
  it("解释场景分组的分析依赖并链接到任务中心", () => {
    render(
      <MemoryRouter>
        <SmartAlbumDirectory
          dimension="scene"
          items={[]}
          total={0}
          viewMode="grid"
          isLoading={false}
          isError={false}
          isFetchingNextPage={false}
          onDimensionChange={vi.fn()}
          onRetry={vi.fn()}
          onLoadMore={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getByText(/Chinese-CLIP 语义向量/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务中心" })).toHaveAttribute(
      "href",
      "/tasks/run",
    );
  });
});
