import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import ComicMetaEditDialog from "./ComicMetaEditDialog";
const { update, reset } = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue({}),
  reset: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../hooks/useComicMeta", () => ({
  useComicMeta: () => ({
    data: {
      meta: {
        nodeId: "c_1",
        kind: "collection",
        cleanTitle: "原书",
        coverCandidates: [],
      },
    },
  }),
  useUpdateComicMeta: () => ({ mutateAsync: update }),
  useResetComicMeta: () => ({ mutateAsync: reset }),
  useSetCollectionCover: () => ({}),
  useClearCollectionCover: () => ({}),
}));
describe("编辑作品", () => {
  it("保留必填书名，提交故事和锁定状态", async () => {
    const close = vi.fn();
    render(<ComicMetaEditDialog id="c_1" onClose={close} />);
    const input = screen.getByLabelText("规范书名");
    fireEvent.change(input, { target: { value: "" } });
    expect(input).toBeInvalid();
    fireEvent.change(input, { target: { value: "新书" } });
    fireEvent.change(screen.getByLabelText("故事大纲"), {
      target: { value: "新故事" },
    });
    fireEvent.click(screen.getByLabelText("锁定人工修改"));
    fireEvent.click(screen.getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "新书",
          synopsis: "新故事",
          locked: true,
        }),
      ),
    );
    expect(close).toHaveBeenCalled();
  });
  it("恢复默认时清除人工覆盖", async () => {
    render(<ComicMetaEditDialog id="c_1" onClose={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "恢复默认" }));
    await waitFor(() => expect(reset).toHaveBeenCalled());
  });
});
