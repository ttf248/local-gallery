// 全屏切换。直接调浏览器 Fullscreen API,不写 store(浏览器
// fullscreenElement 才是真相源,store mirror 会被 F11 / 退出键打脸)。

export function isFullscreen(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.fullscreenElement);
}

export function supportsFullscreen(): boolean {
  return (
    typeof document !== "undefined" &&
    document.fullscreenEnabled !== false &&
    typeof document.documentElement.requestFullscreen === "function"
  );
}

export async function toggleFullscreen(): Promise<boolean> {
  if (!supportsFullscreen()) return false;
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return false;
  }
}
