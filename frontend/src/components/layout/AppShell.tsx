import { Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  useLayoutEffect,
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useUIStore } from "../../store/uiStore";
import { useKeyboard } from "../../hooks/useKeyboard";
import {
  albumRoute,
  decodePathTail,
  exploreRoute,
  homeRoute,
  isReaderPath,
  libraryRoute,
  meRoute,
  pageBoundaryKey,
  unreadRoute,
} from "../../utils/path";
import { tabLabelFor } from "../../utils/pageTabs";
import { workbenchCopy } from "../../utils/workbench";
import { useFsCapabilities } from "../../hooks/useFsCapabilities";
import { useFocusTrap } from "../../ui/useFocusTrap";
import { useVisualViewport } from "../../hooks/useVisualViewport";
import { useAppMode } from "../../hooks/useAppMode";
import { scanApi } from "../../api/scan";
import { useScanSSE } from "../../hooks/useScanSSE";
import { useLibraryRevisionSync } from "../../hooks/useLibrarySync";
import Sidebar from "./Sidebar";
import { useLibraryManifest } from "../../hooks/useLibrary";
import { libraryQueryKeys } from "../../api/queryKeys";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/useMediaQuery";
import { hasOpenModal, normalizeKey } from "../../utils/shortcuts";
import { MenuIcon, SearchIcon } from "../../ui/icons";

import ErrorBoundary from "../common/ErrorBoundary";
import { libraryApi } from "../../api/library";

// 扫描浮卡与帮助浮层按需加载。
//
// 两者都是「有事才出现」的东西：扫描浮卡只在有扫描进度时可见，帮助浮层
// 只在用户按下 ? 时打开。放在外壳里静态引入，等于让每个页面的首屏都为
// 它们付钱 —— 扫描浮卡约 3.4 KB、帮助浮层约 2.9 KB 源码。
const CommandPalette = lazy(() => import("./CommandPalette"));
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
  const paletteOpen = useUIStore((s) => s.commandPaletteOpen);
  const setPaletteOpen = useUIStore((s) => s.setCommandPaletteOpen);
  const closePalette = useCallback(
    () => setPaletteOpen(false),
    [setPaletteOpen],
  );
  const isWide = useMediaQuery(WIDE_LAYOUT_QUERY);
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
  useFocusTrap(sidebarRef, mobileNavOpen && !paletteOpen);
  // 软键盘占掉的高度写进 --keyboard-inset，贴底浮层据此上移。
  useVisualViewport();
  // 阅读器（/read）占用单键快捷键：r 是旋转，u 不是「未读」。
  // 大图预览（照片墙上的浮层）同样占用单键：它自己处理方向键与缩放，
  // 全局的 r / u 必须在它打开时让位，否则按 r 会一边旋转一边跳走整页。
  const immersive = isReaderPath(location.pathname) || immersiveOverlay;
  // 扫描进度 + 取消（提升到 AppShell 后所有路由都能看到顶部进度条）
  const scanSse = useScanSSE();
  const queryClient = useQueryClient();
  const warningCount =
    useLibraryManifest().data?.manifest.statistics.warningCount ?? 0;
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: ({ scanId }) => {
      scanSse.startWith(scanId);
      pushToast({ kind: "info", message: "扫描已开始" });
    },
    onError: () => pushToast({ kind: "error", message: "启动扫描失败" }),
  });

  useEffect(() => {
    if (!scanSse.isComplete || !scanSse.scanId) return;
    void queryClient.invalidateQueries({ queryKey: libraryQueryKeys.root });
    void queryClient
      .fetchQuery({
        queryKey: libraryQueryKeys.manifest(),
        queryFn: () => libraryApi.manifest(),
      })
      .then(({ manifest }) => {
        pushToast({
          kind: "success",
          message: `扫描完成 · 共 ${manifest.statistics.albumCount} ${mode === "comic" ? "卷" : "本相册"}`,
        });
      })
      .catch(() => pushToast({ kind: "error", message: "刷新媒体库失败" }));
  }, [queryClient, scanSse.isComplete, scanSse.scanId, pushToast, mode]);

  useFsCapabilities();
  // 目录监听在后台更新图库时，界面上已经打开的列表要跟着换新数据。
  useLibraryRevisionSync();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    setPaletteOpen(false);
  }, [location.key, setPaletteOpen]);

  useEffect(() => {
    if (isWide) setMobileNavOpen(false);
  }, [isWide]);

  useEffect(() => {
    if (scanSse.progress) setScanCardMounted(true);
  }, [scanSse.progress]);

  // 抽屉是模态：它开着的时候，背景（顶栏与正文）不可聚焦 ——
  // Tab 不该走到被遮住的控件上，读屏也不该读到它们。
  // 这条必须排在下面「关闭后归还焦点」之前：焦点归还要发生在
  // inert 撤掉之后，否则 focus() 落在 inert 元素上不生效。
  useLayoutEffect(() => {
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
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !useUIStore.getState().commandPaletteOpen
      )
        setMobileNavOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    const titles: Record<string, string> = {
      [homeRoute(mode)]: mode === "comic" ? "漫画首页" : "照片库",
      [libraryRoute(mode)]: mode === "comic" ? "书架" : "相册",
      [exploreRoute()]: "发现",
      [meRoute(mode)]: mode === "comic" ? "我的漫画" : "珍藏",
      [unreadRoute()]: "未读",
      "/tasks": "任务中心",
      "/photo/travels": "足迹",
      "/photo/people": "人物相册",
      "/photo/similarity": "相似照片与连拍",
      "/photo/semantic": "智能搜索",
      "/photo/smart-albums": "智能相册",
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
        // 设置页与任务中心的页签按首段查表，「我的」页签要看工作台之后的
        // 第二段；否则标题会掉进工作台的兜底文案。其余页面仍走兜底。
        const [section, subpage] = path.split("/").filter(Boolean);
        if (section === "settings" || section === "tasks") {
          base = titles[`/${section}`];
        }
        if ((section === "photo" || section === "comic") && subpage === "me") {
          base = titles[meRoute(mode)];
        }
        if (subpage === "search") {
          base = "搜索结果";
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

  useEffect(() => {
    const onCommandKey = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        normalizeKey(event) !== "ctrl+k"
      )
        return;
      if (immersive || (hasOpenModal() && !mobileNavOpen && !paletteOpen))
        return;
      event.preventDefault();
      if (!event.repeat) setPaletteOpen(!paletteOpen);
    };
    window.addEventListener("keydown", onCommandKey);
    return () => window.removeEventListener("keydown", onCommandKey);
  }, [immersive, mobileNavOpen, paletteOpen, setPaletteOpen]);

  useKeyboard(
    {
      "ctrl+b": () => toggleSidebar(),
      "ctrl+h": () => navigate(homeRoute(mode)),
      // 收藏与最近浏览住在「我的」的页签里，快捷键跟着走。
      "ctrl+d": () => navigate(meRoute(mode, "favorites")),
      "ctrl+,": () => navigate("/settings"),
      "ctrl+r": () => navigate(meRoute(mode, "recents")),
      "?": () => setHelpOpen((v) => !v),
      "/": () => {
        if (!immersive && (!hasOpenModal() || mobileNavOpen))
          setPaletteOpen(true);
      },
      "ctrl+s": () => {
        if (!startScan.isPending && !scanSse.isRunning) startScan.mutate();
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
    },
    !paletteOpen && !helpOpen,
  );

  return (
    <div className="app-shell flex h-full bg-bg">
      <Sidebar
        ref={sidebarRef}
        collapsed={mobileNavOpen ? false : sidebarCollapsed}
        onToggle={toggleSidebar}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        onShuffle={goShuffle}
        shufflePending={randomAlbum.isPending}
        warningCount={warningCount}
        onRefresh={() =>
          void queryClient.invalidateQueries({
            queryKey: libraryQueryKeys.root,
          })
        }
      />
      <div className="flex-1 flex flex-col min-w-0">
        <div ref={toolbarRef} className="mobile-app-bar ui-glass-bar lg:hidden">
          <button
            ref={mobileMenuButtonRef}
            className="toolbar-icon"
            aria-label="打开导航"
            aria-expanded={mobileNavOpen}
            onClick={() => setMobileNavOpen(true)}
          >
            <MenuIcon size={19} />
          </button>
          <span className="font-semibold">Local Gallery</span>
          <button
            className="toolbar-icon ml-auto"
            aria-label="打开命令面板"
            data-command-trigger
            onClick={() => setPaletteOpen(true)}
          >
            <SearchIcon size={18} />
          </button>
        </div>
        <main
          ref={mainRef}
          className="app-main flex-1"
          data-nav-open={mobileNavOpen || paletteOpen ? "true" : undefined}
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
          className="fixed inset-0 z-40 bg-scrim lg:hidden"
        />
      )}

      <Suspense fallback={null}>
        {paletteOpen ? <CommandPalette open onClose={closePalette} /> : null}
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
