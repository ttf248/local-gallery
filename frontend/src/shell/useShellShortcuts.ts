import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import type { AppMode } from "../api/library";
import { useKeyboard } from "../hooks/useKeyboard";
import { useUIStore } from "../store/uiStore";
import {
  hasOpenModal,
  normalizeKey,
  shouldIgnoreShortcut,
} from "../utils/shortcuts";
import { homeRoute, meRoute, unreadRoute } from "../utils/path";
interface Options {
  mode: AppMode;
  immersive: boolean;
  paletteOpen: boolean;
  helpOpen: boolean;
  onTogglePalette: () => void;
  onOpenHelp: () => void;
  onShuffle: () => void;
  onScan: () => void;
}
export function useShellShortcuts({
  mode,
  immersive,
  paletteOpen,
  helpOpen,
  onTogglePalette,
  onOpenHelp,
  onShuffle,
  onScan,
}: Options) {
  const navigate = useNavigate(),
    toggle = useUIStore((s) => s.toggleSidebar);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.isComposing ||
        normalizeKey(event) !== "ctrl+k" ||
        immersive ||
        (!paletteOpen && (hasOpenModal() || shouldIgnoreShortcut(event)))
      )
        return;
      event.preventDefault();
      if (!event.repeat) onTogglePalette();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [immersive, paletteOpen, onTogglePalette]);
  useKeyboard(
    {
      "ctrl+b": toggle,
      "ctrl+h": () => navigate(homeRoute(mode)),
      "ctrl+d": () => navigate(meRoute(mode, "favorites")),
      "ctrl+,": () => navigate("/settings"),
      "ctrl+r": () => navigate(meRoute(mode, "recents")),
      "?": onOpenHelp,
      "/": () => {
        if (!immersive && !hasOpenModal()) onTogglePalette();
      },
      "ctrl+s": onScan,
      r: () => {
        if (!immersive) onShuffle();
      },
      u: () => {
        if (!immersive && mode === "comic") navigate(unreadRoute());
      },
    },
    !paletteOpen && !helpOpen && !hasOpenModal(),
  );
}
