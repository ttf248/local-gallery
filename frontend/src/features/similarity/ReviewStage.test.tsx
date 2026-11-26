import { render, screen, fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { ReviewStage } from "./ReviewStage";
import type { SimilarityReview } from "./useSimilarityReview";
vi.mock("../common", () => ({
  RenditionImage: ({ alt }: { alt: string }) => <img alt={alt} />,
}));
function review(size: number) {
  const members = Array.from({ length: size }, (_, i) => ({
    resourceId: String(i),
    albumName: "旅行",
    quality: { sharpnessScore: 0.8, megapixels: 12, exposureScore: 0.9 },
  }));
  const active = {
    id: "g",
    kind: "exact",
    members,
    representative: "0",
    recommended: "0",
    folder: "旅行",
  };
  return {
    active,
    source: { page: { total: 1 } },
    state: { groups: [active], focusIndex: 0, pending: new Set() },
    setFocus: vi.fn(),
    setRepresentative: vi.fn(),
    markReviewed: vi.fn(),
    ignore: vi.fn(),
    addPick: vi.fn(),
  } as unknown as SimilarityReview;
}
it("显示代表、建议和质量，选择成员后可修改代表", () => {
  const data = review(2);
  render(<ReviewStage review={data} />);
  expect(screen.getByText("★ 代表")).toBeVisible();
  expect(screen.getAllByText(/曝光 90/)).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "照片 2，旅行" }));
  expect(data.setFocus).toHaveBeenCalledWith(1);
  fireEvent.click(screen.getByRole("button", { name: /设为代表/ }));
  expect(data.setRepresentative).toHaveBeenCalledWith(0);
});
it("超过八名成员显示主图与可操作的胶片带", () => {
  render(<ReviewStage review={review(9)} />);
  expect(screen.getByRole("button", { name: "查看聚焦照片" })).toBeVisible();
  expect(screen.getAllByRole("button", { name: /照片 [1-9]，/ })).toHaveLength(
    9,
  );
});
