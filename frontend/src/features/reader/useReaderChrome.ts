import { useCallback, useEffect, useRef, useState } from "react";
export interface ReaderChromeOptions {
  autoHide: boolean;
  lockedOpen: boolean;
  idleMs?: number;
}
export function useReaderChrome({
  autoHide,
  lockedOpen,
  idleMs = 2400,
}: ReaderChromeOptions) {
  const [visible, setVisible] = useState(true);
  const [hover, setHover] = useState(false),
    [focus, setFocus] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const clear = useCallback(() => clearTimeout(timer.current), []);
  const arm = useCallback(() => {
    clear();
    if (autoHide && !lockedOpen && !focus && !hover)
      timer.current = setTimeout(() => setVisible(false), idleMs);
  }, [clear, autoHide, lockedOpen, focus, hover, idleMs]);
  const show = useCallback(() => {
    setVisible(true);
    arm();
  }, [arm]);
  const hide = useCallback(() => {
    if (!lockedOpen && !focus) {
      clear();
      setVisible(false);
    }
  }, [clear, lockedOpen, focus]);
  useEffect(() => {
    if (lockedOpen || focus) setVisible(true);
    arm();
    return clear;
  }, [lockedOpen, focus, arm, clear]);
  return {
    visible: visible || lockedOpen || focus,
    show,
    hide,
    toggle: () => (visible ? hide() : show()),
    notifyEdgeActivity: (y: number, height: number) => {
      if (y <= 56 || y >= height - 56) show();
    },
    chromeFocusProps: {
      onFocusCapture: () => setFocus(true),
      onBlurCapture: (e: React.FocusEvent<HTMLElement>) =>
        setFocus(e.currentTarget.contains(e.relatedTarget)),
      onPointerEnter: () => {
        setHover(true);
        show();
      },
      onPointerLeave: () => setHover(false),
    },
  };
}
