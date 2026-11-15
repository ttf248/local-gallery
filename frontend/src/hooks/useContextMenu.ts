import { useCallback, useState, type MouseEvent } from "react";

interface MenuState<T> {
  x: number;
  y: number;
  item: T;
}

/**
 * 右键菜单：位置与开关。
 *
 * 照片墙上的照片同样能查看属性、在文件管理器中定位 —— 各处的菜单项
 * 不一样，但「在哪、右键的是哪一张、关掉」是同一件事。
 */
export function useContextMenu<T>() {
  const [menu, setMenu] = useState<MenuState<T> | null>(null);

  const open = useCallback((item: T, event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    // 右键后把焦点留在照片上：接着按空格就能打开它，
    // 键盘用户不必再从墙上找一遍。
    event.currentTarget.focus({ preventScroll: true });
    setMenu({ x: event.clientX, y: event.clientY, item });
  }, []);

  const close = useCallback(() => setMenu(null), []);

  return { menu, open, close };
}
