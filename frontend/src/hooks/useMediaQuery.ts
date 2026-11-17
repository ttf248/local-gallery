import { useEffect, useState } from "react";

/**
 * 宽版布局的断点。
 *
 * 与 Tailwind 的 `lg` 一致（1024px）：侧栏在这条线以下收进抽屉，
 * 顶栏在它以上才有足够宽度容纳工作台切换。
 */
export const WIDE_LAYOUT_QUERY = "(min-width: 1024px)";

/**
 * 超宽版式的断点。
 *
 * 2240px 起另做一套版式（2560 宽的 27 寸）：左边一栏叙述，
 * 右边一栏陈列。1920 与 1440 上仍是单栏 —— 这条线与样式表里
 * `.page-layout` 的那条媒体查询是同一个数，两边必须一起改。
 */
export const ULTRAWIDE_LAYOUT_QUERY = "(min-width: 2240px)";

/**
 * 订阅一条媒体查询。
 *
 * 用法：const isWide = useMediaQuery("(min-width: 1536px)");
 *
 * 服务端渲染 / 测试环境没有 matchMedia 时一律返回 false（按窄版渲染），
 * 避免首屏先渲染宽版再跳回窄版。
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mediaQuery = window.matchMedia(query);
    const onChange = () => setMatches(mediaQuery.matches);
    onChange();
    mediaQuery.addEventListener("change", onChange);
    return () => mediaQuery.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
