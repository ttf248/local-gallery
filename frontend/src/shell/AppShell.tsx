import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { libraryQueryKeys } from "../api/queryKeys";
import { useRouteMeta } from "../app/routeMeta";
import { useUIStore } from "../store/uiStore";
import { useAppMode } from "../hooks/useAppMode";
import { useVisualViewport } from "../hooks/useVisualViewport";
import { useLibraryManifest } from "../hooks/useLibrary";
import { useLibraryRevisionSync } from "../hooks/useLibrarySync";
import { useFsCapabilities } from "../hooks/useFsCapabilities";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../hooks/useMediaQuery";
import { isReaderPath, pageBoundaryKey } from "../utils/path";
import ErrorBoundary from "../features/common/ErrorBoundary";
import { PageChromeProvider } from "./PageChrome";
const Sidebar = lazy(() => import("./Sidebar"));
import { CanvasTopBar } from "./CanvasTopBar";
import { MobileTabBar } from "./MobileTabBar";
const MoreSheet = lazy(() => import("./MoreSheet").then(({ MoreSheet }) => ({ default: MoreSheet })));
import { useScanSession } from "./useScanSession";
import { useShellShortcuts } from "./useShellShortcuts";
import { useShuffle } from "./useShuffle";
const CommandPalette = lazy(() => import("./CommandPalette"));
const ScanProgress = lazy(() => import("./ScanProgress"));
const HelpOverlay = lazy(() => import("../features/common/HelpOverlay"));
export default function AppShell() {
  const location = useLocation(),
    { mode } = useAppMode(),
    wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const collapsed = useUIStore((s) => s.sidebar === "collapsed"),
    toggle = useUIStore((s) => s.toggleSidebar);
  const overlay = useUIStore((s) => s.immersiveOverlay),
    immersive = overlay || isReaderPath(location.pathname);
  const palette = useUIStore((s) => s.commandPaletteOpen),
    setPalette = useUIStore((s) => s.setCommandPaletteOpen),
    helpContext = useRouteMeta()?.meta.help ?? "library";
  const [help, setHelp] = useState(false),
    [more, setMore] = useState(false),
    [scrolled, setScrolled] = useState(false),
    [showScan, setShowScan] = useState(false);
  const { shuffle, pending } = useShuffle(mode),
    scan = useScanSession(mode),
    client = useQueryClient();
  const warningCount =
    useLibraryManifest().data?.manifest.statistics.warningCount ?? 0;
  const refresh = () =>
    void client.invalidateQueries({ queryKey: libraryQueryKeys.root });
  const closePalette = useCallback(() => setPalette(false), [setPalette]);
  useFsCapabilities();
  useLibraryRevisionSync();
  useVisualViewport();
  useEffect(() => {
    if (scan.sse.progress) setShowScan(true);
  }, [scan.sse.progress]);
  useEffect(() => {
    setMore(false);
    setPalette(false);
  }, [location.key, setPalette]);
  useEffect(() => {
    if (wide) setMore(false);
  }, [wide]);
  useEffect(() => {
    const open = () => setHelp(true);
    window.addEventListener("comic:open-help", open);
    return () => window.removeEventListener("comic:open-help", open);
  }, []);
  useShellShortcuts({
    mode,
    immersive,
    paletteOpen: palette,
    helpOpen: help || more,
    onTogglePalette: () => setPalette(!palette),
    onOpenHelp: () => setHelp(true),
    onShuffle: shuffle,
    onScan: scan.start,
  });
  return (
    <PageChromeProvider>
      <div className="grid h-dvh min-w-0 grid-cols-[minmax(0,1fr)] bg-app lg:grid-cols-[var(--sidebar-w)_minmax(0,1fr)] motion-safe:transition-[grid-template-columns] duration-slow ease-spring" style={{"--sidebar-w":collapsed?"72px":"240px"} as React.CSSProperties}>
        {wide && (
          <Suspense fallback={<div aria-hidden="true"/>}><Sidebar
            collapsed={collapsed}
            onToggle={toggle}
            onSearch={()=>setPalette(true)} onHelp={()=>setHelp(true)}
            warningCount={warningCount}
          /></Suspense>
        )}
        <div data-canvas="" className="relative flex min-h-0 min-w-0 flex-col overflow-hidden bg-canvas lg:m-2 lg:ml-0 lg:rounded-xl lg:shadow-canvas">
          <CanvasTopBar
            scrolled={scrolled}
            onHelp={() => setHelp(true)}
            onSearch={() => setPalette(true)}
            onRefresh={refresh}
            onShuffle={shuffle}
            shufflePending={pending}
            onScan={scan.start}
            canScan={scan.canStart}
          />
          <main
            className="app-main min-w-0 flex-1 overflow-y-auto pb-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] lg:pb-0"
            onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 0)}
          >
            <ErrorBoundary key={pageBoundaryKey(location.pathname)}>
              <Outlet />
            </ErrorBoundary>
          </main>
        </div>
        {!wide && (
          <>
            <MobileTabBar
              onMore={() => setMore(true)}
              open={more}
              immersive={immersive || help || palette}
            />
            {more && <Suspense fallback={null}><MoreSheet
              open
              onClose={() => setMore(false)}
              onHelp={() => setHelp(true)}
            /></Suspense>}
          </>
        )}
        <Suspense fallback={null}>
          {palette && (
            <CommandPalette
              open
              onClose={closePalette}
              onRefresh={refresh}
              onScan={scan.start}
              canScan={scan.canStart}
            />
          )}
          {showScan && (
            <ScanProgress
              progress={scan.sse.progress}
              onCancel={scan.cancel}
              isCancelling={scan.isCancelling}
              connectionState={scan.sse.connectionState}
              onReconnect={scan.sse.reconnect}
              onStopTracking={scan.sse.reset}
            />
          )}
          {help && (
            <HelpOverlay
              context={helpContext}
              open
              onClose={() => setHelp(false)}
            />
          )}
        </Suspense>
      </div>
    </PageChromeProvider>
  );
}
