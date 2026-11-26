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
    let anchor:string|null=null;
    const unsubscribe = usePhotoStore.subscribe((state, previous) => {
      if (state.density === previous.density || !latest.current.enabled) return;
      anchor ??= latest.current.getAnchorId();
      cancelAnimationFrame(frame);
      if(anchor)frame=requestAnimationFrame(()=>{
        // 第一帧提交照片墙的新布局，下一帧 Virtuoso 已测量新行高。
        frame=requestAnimationFrame(()=>{
          if(anchor)latest.current.restoreAnchor(anchor);
          frame=requestAnimationFrame(()=>{anchor=null;});
        });
      });
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
