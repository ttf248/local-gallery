import { useEffect } from "react";
import { useLocation } from "react-router-dom";

export function useAnchorScroll({
  tab,
  ready = true,
}: {
  tab: string;
  ready?: boolean;
}) {
  const { hash, search, key } = useLocation();
  useEffect(() => {
    if (!ready || (tab === "tasks" && new URLSearchParams(search).has("job")))
      return;
    const main = document.querySelector(".app-main");
    if (!hash) {
      main?.scrollTo?.({ top: 0, behavior: "instant" });
      return;
    }
    let id;
    try {
      id = decodeURIComponent(hash.slice(1));
    } catch {
      return;
    }
    const panel = document.getElementById("settings-panel-" + tab);
    if (!panel) return;
    const scroll = () => {
      const target = document.getElementById(id);
      if (!target || !panel.contains(target)) return false;
      target.scrollIntoView?.({ block: "start", behavior: "smooth" });
      return true;
    };
    if (scroll()) return;
    const observer = new MutationObserver(() => {
      if (scroll()) observer.disconnect();
    });
    observer.observe(panel, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [tab, ready, hash, search, key]);
}
