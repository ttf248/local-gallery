import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { useDensityShortcuts } from "./useDensityShortcuts";
import { nextDensity, usePhotoStore } from "../../store/photoStore";
it("自适应从最近档位步进并停在两端", () => {
  expect(nextDensity("auto", 1, 152)).toBe("cozy");
  expect(nextDensity("large", 1, 190)).toBe("large");
  expect(nextDensity("compact", -1, 190)).toBe("compact");
});
it("键盘改密度后归还锚点，输入与修饰键保留默认处理", async () => {
  usePhotoStore.setState({ density: "cozy" });
  const restoreAnchor = vi.fn();
  renderHook(() =>
    useDensityShortcuts({
      enabled: true,
      autoResolvedHeight: 210,
      getAnchorId: () => "f_1",
      restoreAnchor,
    }),
  );
  act(() => {
    fireEvent.keyDown(document, { key: "[" });
  });
  expect(usePhotoStore.getState().density).toBe("compact");
  await waitFor(() => expect(restoreAnchor).toHaveBeenCalledWith("f_1"));
  const input = document.body.appendChild(document.createElement("input"));
  input.focus();
  fireEvent.keyDown(input, { key: "]" });
  input.remove();
  fireEvent.keyDown(document, { key: "]", ctrlKey: true });
  expect(usePhotoStore.getState().density).toBe("compact");
  fireEvent.keyDown(document, { key: "]" });
  expect(usePhotoStore.getState().density).toBe("cozy");
});
