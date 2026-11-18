import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useUIStore } from "../../store/uiStore";
import { useKeyboard } from "../../hooks/useKeyboard";
import {
  albumRoute,
  decodePathTail,
  favoritesRoute,
  homeRoute,
  isReaderPath,
  pageBoundaryKey,
  recentsRoute,
  unreadRoute,
} from "../../utils/path";
import { tabLabelFor } from "../../utils/pageTabs";
import { workbenchCopy } from "../../utils/workbench";
import { useFsCapabilities } from "../../hooks/useFsCapabilities";
import { useFocusTrap } from "../../hooks/useFocusTrap";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import { useAppMode } from "../../hooks/useAppMode";
import { scanApi } from "../../api/scan";
import { useScanSSE } from "../../hooks/useScanSSE";
import Sidebar from "./Sidebar";
import Toolbar from "./Toolbar";
import ErrorBoundary from "../common/ErrorBoundary";
import { libraryApi } from "../../api/library";

// 扫描浮卡与帮助浮层按需加载。
//
// 两者都是「有事才出现」的东西：扫描浮卡只在有扫描进度时可见，帮助浮层
// 只在用户按下 ? 时打开。放在外壳里静态引入，等于让每个页面的首屏都为
// 它们付钱 —— 扫描浮卡约 3.4 KB、帮助浮层约 2.9 KB 源码。
const ScanProgress = lazy(() => import("../album/ScanProgress"));
const HelpOverlay = lazy(() => import("../common/HelpOverlay"));

// 应用外壳：侧边栏 + 工具栏 + 主内容。
// 全局帮助浮层通过 comic:open-help 事件触发（所有页面 ? 都能唤起）。
export default function AppShell() {
  const location = useLocation();
  const navigate = useNavigate();
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const pushToast = useUIStore((s) => s.pushToast);
  const { mode } = useAppMode();
  const immersiveOverlay = useUIStore((s) => s.immersiveOverlay);
  const helpContext = useUIStore((s) => s.helpContext);
  const [helpOpen, setHelpOpen] = useState(false);
  // 扫描浮卡挂载过就一直留着：终态时它要播一段淡出动画，progress 一空
  // 就卸载会让这段动画消失。第一次有扫描进度时才挂载 —— 在那之前这块
  // 浮层什么都不显示，代码却已经进了首屏。
  const [scanCardMounted, setScanCardMounted] = useState(false);
  const [isCancellingScan, setIsCancellingScan] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const wasMobileNavOpen = useRef(false);
  // 抽屉本体与它背后的东西：抽屉关焦点，背景置 inert，正文锁滚。
  const sidebarRef = useRef<HTMLElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  // 键盘焦点关在抽屉里：Tab 不该走到被遮住的背景控件上。
  useFocusTrap(sidebarRef, mobileNavOpen);
  // 软键盘占掉的高度写进 --keyboard-inset，贴底浮层据此上移。
  useVisualViewport();
  // 阅读器（/read）占用单键快捷键：r 是旋转，u 不是「未读」。
  // 大图预览（照片墙上的浮层）同样占用单键：它自己处理方向键与缩放，
  // 全局的 r / u 必须在它打开时让位，否则按 r 会一边旋转一边跳走整页。
  const immersive = isReaderPath(location.pathname) || immersiveOverlay;
  // 扫描进度 + 取消（提升到 AppShell 后所有路由都能看到顶部进度条）
  const scanSse = useScanSSE();
  useFsCapabilities();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (scanSse.progress) setScanCardMounted(true);
  }, [scanSse.progress]);

  // 抽屉是模态：它开着的时候，背景（顶栏与正文）不可聚焦 ——
  // Tab 不该走到被遮住的控件上，读屏也不该读到它们。
  // 这条必须排在下面「关闭后归还焦点」之前：焦点归还要发生在
  // inert 撤掉之后，否则 focus() 落在 inert 元素上不生效。
  useEffect(() => {
    const background = [toolbarRef.current, mainRef.current].filter(
      (element): element is HTMLElement => Boolean(element),
    );
    for (const element of background) {
      if (mobileNavOpen) element.setAttribute("inert", "");
      else element.removeAttribute("inert");
    }
    return () => {
      for (const element of background) element.removeAttribute("inert");
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) {
      if (wasMobileNavOpen.current) mobileMenuButtonRef.current?.focus();
      wasMobileNavOpen.current = false;
      return;
    }
    wasMobileNavOpen.current = true;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    const titles: Record<string, string> = {
      [homeRoute(mode)]: mode === "comic" ? "漫画库" : "照片库",
      [recentsRoute(mode)]: mode === "comic" ? "最近阅读" : "最近浏览",
      [favoritesRoute(mode)]: mode === "comic" ? "收藏漫画" : "收藏照片",
      [unreadRoute()]: "未读",
      "/tasks": "任务中心",
      "/photo/travels": "足迹",
      "/photo/people": "人物相册",
      "/photo/similarity": "相似照片与连拍",
      "/settings": "设置",
    };
    const path = location.pathname;
    let base = titles[path];
    if (base === undefined) {
      if (path.includes("/tags/")) {
        // 标签段只解码一次：路径里可能是字面 %xx。
        const raw = decodePathTail(path, "/tags/");
        base = raw || "标签";
      } else if (path.startsWith("/photo/travels/place/")) {
        base = "足迹";
      } else if (path.startsWith("/photo/people/")) {
        base = "人物相册";
      } else {
        // 设置页与任务中心的页签也在路径里（/settings/data）：这两页按首段
        // 查表，再补上当前页签的名字，否则标题会掉进工作台的兜底文案。
        // 其余页面仍走兜底（相册页是「相册」，不是「照片库」）。
        const segment = path.split("/")[1] ?? "";
        if (segment === "settings" || segment === "tasks") {
          base = titles[`/${segment}`];
        }
        if (base === undefined) base = workbenchCopy(mode).albumTypeLabel;
      }
    }
    const tab = tabLabelFor(path);
    document.title = `${base}${tab ? ` · ${tab}` : ""} · Local Gallery`;
  }, [location.pathname, mode]);

  useEffect(() => {
    const fn = () => setHelpOpen(true);
    window.addEventListener("comic:open-help", fn as EventListener);
    return () =>
      window.removeEventListener("comic:open-help", fn as EventListener);
  }, []);

  const randomAlbum = useMutation({
    mutationFn: () => libraryApi.randomAlbums(mode),
    onSuccess: ({ albums }) => {
      const album = albums[0];
      if (album) navigate(albumRoute(mode, album.id));
    },
    onError: () => pushToast({ kind: "info", message: "没有可随机打开的相册" }),
  });

  const goShuffle = () => {
    if (!randomAlbum.isPending) randomAlbum.mutate();
  };

  const cancelScan = useCallback(async () => {
    if (!scanSse.scanId || isCancellingScan) return;

    setIsCancellingScan(true);
    try {
      await scanApi.cancel(scanSse.scanId);
      pushToast({ kind: "info", message: "已请求取消扫描" });
    } catch {
      pushToast({ kind: "error", message: "取消扫描失败，请稍后重试" });
    } finally {
      setIsCancellingScan(false);
    }
  }, [isCancellingScan, pushToast, scanSse.scanId]);

  useKeyboard({
    "ctrl+b": () => toggleSidebar(),
    "ctrl+h": () => navigate(homeRoute(mode)),
    "ctrl+d": () => navigate(favoritesRoute(mode)),
    "ctrl+,": () => navigate("/settings"),
    "ctrl+r": () => navigate(recentsRoute(mode)),
    "?": () => setHelpOpen((v) => !v),
    "/": () => {
      const el =
        document.querySelector<HTMLInputElement>(
          'input[placeholder^="搜索"]',
        ) ??
        document.querySelector<HTMLInputElement>(
          'input[aria-label="搜索内容"]',
        );
      el?.focus();
    },
    // 随机一卷：仅在非沉浸场景生效（阅读器与大图预览的 r 有别的含义）
    r: () => {
      if (immersive) return;
      goShuffle();
    },
    // U → 未读页（未读只属于漫画工作台）
    u: () => {
      if (immersive || mode !== "comic") return;
      navigate(unreadRoute());
    },
  });

  return (
    <div className="app-shell flex h-full bg-bg">
      <Sidebar
        ref={sidebarRef}
        collapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={toggleSidebar}
        mobileOpen={mobileNavOpen}
      />
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={toolbarRef}>
          <Toolbar
            onOpenMobileNav={() => setMobileNavOpen(true)}
            mobileMenuButtonRef={mobileMenuButtonRef}
          />
        </div>
        <main
          ref={mainRef}
          className="app-main flex-1"
          data-nav-open={mobileNavOpen ? "true" : undefined}
        >
          {/* 路由层错误兜底:任意子组件 render 抛错都不会让整个 SPA 白屏。
              key 用 pageBoundaryKey：设置页与任务中心切页签时不重挂整页
              （页面状态与未保存的草稿都在里面），其余页面仍逐页重挂。 */}
          <ErrorBoundary key={pageBoundaryKey(location.pathname)}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
      {mobileNavOpen && (
        <button
          type="button"
          aria-label="关闭导航"
          onClick={() => setMobileNavOpen(false)}
          // 遮罩只是点一下就关抽屉的便签，不该出现在 Tab 顺序里：
          // 抽屉打开时焦点关在抽屉内，Tab 到遮罩上等于逃出去。
          tabIndex={-1}
          className="fixed inset-0 z-40 bg-black/30 lg:hidden"
        />
      )}
      {/*
        扫描进度卡：左下角浮动卡（fixed，相对 viewport）。
        必须在 <main> 外面，否则会被 main 的 overflow-auto 影响 sticky/fixed 行为。
        scanSse.startWith 由 Toolbar 在用户触发「重新扫描」/ Ctrl+S 时写 store.scanId。
      */}
      <Suspense fallback={null}>
        {scanCardMounted ? (
          <ScanProgress
            progress={scanSse.progress}
            onCancel={cancelScan}
            isCancelling={isCancellingScan}
            connectionState={scanSse.connectionState}
            onReconnect={scanSse.reconnect}
            onStopTracking={scanSse.reset}
          />
        ) : null}
        {helpOpen ? (
          <HelpOverlay
            context={helpContext}
            open
            onClose={() => setHelpOpen(false)}
          />
        ) : null}
      </Suspense>
    </div>
  );
}
