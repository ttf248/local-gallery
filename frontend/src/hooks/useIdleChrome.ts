import { useCallback, useEffect, useRef, useState } from "react";

/**
 * 沉浸式阅读器的浮动控件显隐。
 *
 * 顶部常驻条与底部页码条始终可见 —— 「现在读到第几页」不该先找到控件
 * 才看得见。淡出的只有操作入口：鼠标移动、按下任意键或触屏操作后重新
 * 显出，空闲一段时间后再藏起来，把画面让给内容。
 */
export function useIdleChrome(idleMs = 2500) {
  // 顶部与画面两侧的控件（跳卷按钮等）。
  const [chromeVisible, setChromeVisible] = useState(true);
  // 底部工具条：压在画面上，常驻会一直挡着画。
  const [toolbarVisible, setToolbarVisible] = useState(true);

  const chromeTimerRef = useRef<number | null>(null);
  const toolbarTimerRef = useRef<number | null>(null);

  const markActive = useCallback(() => {
    setChromeVisible(true);
    if (chromeTimerRef.current !== null) {
      window.clearTimeout(chromeTimerRef.current);
    }
    chromeTimerRef.current = window.setTimeout(() => {
      setChromeVisible(false);
    }, idleMs);
  }, [idleMs]);

  const markToolbarActive = useCallback(() => {
    setToolbarVisible(true);
    if (toolbarTimerRef.current !== null) {
      window.clearTimeout(toolbarTimerRef.current);
    }
    toolbarTimerRef.current = window.setTimeout(() => {
      setToolbarVisible(false);
    }, idleMs);
  }, [idleMs]);

  useEffect(() => {
    markActive();
    markToolbarActive();
    const onMove = (event: MouseEvent) => {
      markActive();
      // 鼠标靠近画面底部时唤回工具条（工具条在进度条上方约 52px）。
      if (event.clientY > window.innerHeight - 160) markToolbarActive();
    };
    const onKey = (event:KeyboardEvent) => {
      if(["p","r","s","+","=","-"].includes(event.key.toLowerCase()))return;
      markActive();
      markToolbarActive();
    };
    // 触屏：mousemove 不会触发，需要单独监听 pointerdown。
    const onTouch = () => {
      markActive();
      markToolbarActive();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onTouch);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onTouch);
      if (chromeTimerRef.current !== null)
        window.clearTimeout(chromeTimerRef.current);
      if (toolbarTimerRef.current !== null)
        window.clearTimeout(toolbarTimerRef.current);
    };
  }, [markActive, markToolbarActive]);

  return { chromeVisible, toolbarVisible, markActive, markToolbarActive };
}
