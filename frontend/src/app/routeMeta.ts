import type { ComponentType } from "react";
import { useMemo } from "react";
import { matchRoutes, useLocation, type Params } from "react-router-dom";
import type { AppMode } from "../api/library";
import type { PageVariant } from "../shell/Page";
import { ROUTE_MANIFEST } from "./routeManifest";

export type NavKey =
  | "photo.home"
  | "photo.library"
  | "photo.explore"
  | "photo.me"
  | "photo.organize"
  | "comic.home"
  | "comic.library"
  | "comic.me"
  | "comic.unread"
  | "machine.tasks"
  | "machine.settings";

export interface RouteChrome {
  shell: "app" | "immersive";
  search: "global" | "local" | "none";
  back?: "history" | ((params: Params) => string);
}
export interface RouteMeta {
  id: string;
  path: string;
  mode?: AppMode;
  page: PageVariant;
  navKey?: NavKey;
  help: "library" | "photo";
  chrome: RouteChrome;
  title: (ctx: { params: Params; mode: AppMode }) => string;
  component: () => Promise<{ default: ComponentType }>;
}
export interface RouteRedirect {
  from: string;
  to: string | ((params: Params) => string);
}

const patterns = ROUTE_MANIFEST.map((meta) => ({ path: meta.path, meta }));
export function matchRouteMeta(pathname: string) {
  const match = matchRoutes(patterns, pathname)?.[0];
  return match ? { meta: match.route.meta, params: match.params } : null;
}
export function useRouteMeta() {
  const { pathname } = useLocation();
  return useMemo(() => matchRouteMeta(pathname), [pathname]);
}
export function documentTitle(
  meta: RouteMeta | null,
  params: Params,
  mode: AppMode,
  pageTitle?: string,
) {
  const title = meta?.title({ params, mode });
  return [
    pageTitle && !title?.startsWith(pageTitle) && pageTitle,
    title,
    "Local Gallery",
  ]
    .filter(Boolean)
    .join(" · ");
}
