import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Outlet, useLocation } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { libraryQueryKeys } from "../api/queryKeys";
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
import NavRail from "./NavRail";
import { TopBar } from "./TopBar";
import { MobileTabBar } from "./MobileTabBar";
import { MoreSheet } from "./MoreSheet";
import { useScanSession } from "./useScanSession";
import { useShellShortcuts } from "./useShellShortcuts";
import { useShuffle } from "./useShuffle";
const CommandPalette = lazy(() => import("./CommandPalette"));
const ScanProgress = lazy(() => import("./ScanProgress"));
const HelpOverlay = lazy(() => import("../features/common/HelpOverlay"));
export default function AppFrame() {
  const location = useLocation(),
    { mode } = useAppMode(),
    wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  const collapsed = useUIStore((s) => s.sidebarCollapsed),
    toggle = useUIStore((s) => s.toggleSidebar);
  const overlay = useUIStore((s) => s.immersiveOverlay),
    immersive = overlay || isReaderPath(location.pathname);
  const palette = useUIStore((s) => s.commandPaletteOpen),
    setPalette = useUIStore((s) => s.setCommandPaletteOpen),
    helpContext = useUIStore((s) => s.helpContext);
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
      <div className="flex h-full min-w-0 gap-0 bg-bg lg:gap-2">
        {wide && (
          <NavRail
            collapsed={collapsed}
            onToggle={toggle}
            warningCount={warningCount}
          />
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <TopBar
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
            <MoreSheet
              open={more}
              onClose={() => setMore(false)}
              onHelp={() => setHelp(true)}
            />
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
