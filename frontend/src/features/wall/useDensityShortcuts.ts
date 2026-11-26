import { useEffect, useRef } from "react";
import { nextDensity, usePhotoStore } from "../../store/photoStore";
import { useUIStore } from "../../store/uiStore";
interface Options {
  enabled: boolean;
  autoResolvedHeight: number;
  getAnchorId: () => string | null;
  restoreAnchor: (id: string) => void;
}
export function useDensityShortcuts(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let frame = 0;
    const unsubscribe = usePhotoStore.subscribe((state, previous) => {
      if (state.density === previous.density || !latest.current.enabled) return;
      const id = latest.current.getAnchorId();
      cancelAnimationFrame(frame);
      if (id)
        frame = requestAnimationFrame(() => latest.current.restoreAnchor(id));
    });
    function keydown(event: KeyboardEvent) {
      if (
        !latest.current.enabled ||
        event.defaultPrevented ||
        event.isComposing ||
        event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        useUIStore.getState().immersiveOverlay ||
        document.querySelector("dialog[open]")
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        (event.target.isContentEditable ||
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      if (event.key !== "[" && event.key !== "]") return;
      event.preventDefault();
      const { density, setDensity } = usePhotoStore.getState();
      setDensity(
        nextDensity(
          density,
          event.key === "[" ? -1 : 1,
          latest.current.autoResolvedHeight,
        ),
      );
    }
    document.addEventListener("keydown", keydown);
    return () => {
      unsubscribe();
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown);
    };
  }, []);
}
