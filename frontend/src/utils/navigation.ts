import { useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { albumRoute, libraryRoute } from "./path";
import type { AppMode } from "../api/library";

/**
 * 应用内是否还有可回退的上一页。
 *
 * React Router 用的 history 包会把应用内历史深度写进
 * `history.state.idx`：idx 为 0 表示这是应用内的第一个页面（直接打开
 * 链接、刷新页面、从站外跳转进来）。这时执行 `navigate(-1)` 会一路退出
 * 应用，停在浏览器的空白页（about:blank）——用户看到的是整个应用消失。
 *
 * 翻页这类 replace 导航不会改变 idx，所以"在阅读器里翻到第 50 页再按
 * 返回"依然能正确回到列表。
 */
export function hasAppHistory(): boolean {
  if (typeof window === "undefined") return false;
  const state = window.history.state as { idx?: number } | null;
  return typeof state?.idx === "number" && state.idx > 0;
}

/**
 * 安全的"返回"：应用内还有历史就回退，否则去 fallback。
 *
 * fallback 必须是应用内的具体路由（不能是空串），否则会退到应用外面。
 * 它也可以是一个函数：父级要等资源摘要回来才知道，那种页面在点击
 * 那一刻才知道自己该回哪儿 —— 用函数把那一刻的答案带进来。
 */
export function useSafeBack(fallback: string | (() => string)): () => void {
  const navigate = useNavigate();
  // 兜底目标放在 ref 里：回调因此不必随摘要加载而重建，按钮也不会
  // 因为父级刚刚查到而换掉身份。
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;
  return useCallback(() => {
    if (hasAppHistory()) {
      navigate(-1);
      return;
    }
    const current = fallbackRef.current;
    const target = typeof current === "function" ? current() : current;
    if (!target) return;
    // 兜底用 replace 而不是 push：深链打开时这一页就是历史里的第一条，
    // 再 push 一条就等于留了一枚死循环 —— 返回一次到父级，再返回一次
    // 又回到这一页。replace 掉之后父级成了新的起点，继续按返回就
    // 一级一级往上走，不会原地打转。
    navigate(target, { replace: true });
  }, [navigate]);
}

/**
 * 详情页的返回兜底：能确认上级就回上级，否则回那一侧的结构入口。
 *
 * 「父级」是资源摘要里的直接上级集合：相册的父级是它所在的集合，
 * 卷的父级是它所属的作品。回到上级比回到首页更贴上下文 —— 用户
 * 从集合里点进来，退出时看到的还是那个集合，而不是整个工作台。
 *
 * 上级不明时回结构入口（相册页 / 书架）：那一页按目录把内容摊开，
 * 比首页更接近「这些东西在哪儿」。
 */
export function contextFallback(
  mode: AppMode,
  parentId: string | undefined,
): string {
  if (parentId) return albumRoute(mode, parentId);
  return libraryRoute(mode);
}
