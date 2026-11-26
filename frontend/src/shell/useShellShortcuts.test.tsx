import { MemoryRouter } from "react-router-dom";
import { render, fireEvent, screen } from "@testing-library/react";
import { expect, vi, it } from "vitest";
import { useShellShortcuts } from "./useShellShortcuts";
it("Ctrl+B 收起、Ctrl+K 切换，沉浸、模态及编辑状态让位", async () => {
  const { useUIStore } = await import("../store/uiStore");
  const toggle = vi.fn(),
    shuffle = vi.fn();
  function Harness({
    immersive,
    modal,
  }: {
    immersive: boolean;
    modal: boolean;
  }) {
    useShellShortcuts({
      mode: "comic",
      immersive,
      paletteOpen: false,
      helpOpen: false,
      onTogglePalette: toggle,
      onOpenHelp: vi.fn(),
      onScan: vi.fn(),
      onShuffle: shuffle,
    });
    return (
      <>
        <input />
        {modal && <dialog open />}
      </>
    );
  }
  const view = (immersive = false, modal = false) => (
    <MemoryRouter>
      <Harness immersive={immersive} modal={modal} />
    </MemoryRouter>
  );
  const { rerender } = render(view());
  useUIStore.getState().setSidebarCollapsed(false);
  fireEvent.keyDown(window, { key: "b", ctrlKey: true });
  expect(useUIStore.getState().sidebarCollapsed).toBe(true);
  fireEvent.keyDown(window, { key: "k", ctrlKey: true });
  expect(toggle).toHaveBeenCalledOnce();
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "r" });
  rerender(view(true));
  fireEvent.keyDown(window, { key: "r" });
  expect(shuffle).not.toHaveBeenCalled();
  rerender(view(false, true));
  fireEvent.keyDown(window, { key: "/" });
  expect(toggle).toHaveBeenCalledOnce();
});
