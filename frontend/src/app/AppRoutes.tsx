import { lazy, Suspense } from "react";
import {
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { homeRoute } from "../utils/path";
import AppShell from "../shell/AppShell";
import RouteLoading from "../features/common/RouteLoading";
import ErrorBoundary from "../features/common/ErrorBoundary";
import { ROUTE_MANIFEST, ROUTE_REDIRECTS } from "./routeManifest";
import type { RouteRedirect } from "./routeMeta";

const pages = ROUTE_MANIFEST.map((meta) => {
  const Page = lazy(meta.component);
  return {
    meta,
    element: (
      <Route
        key={meta.id}
        path={meta.path}
        element={
          <ErrorBoundary key={meta.id}>
            <Suspense fallback={<RouteLoading />}>
              <Page />
            </Suspense>
          </ErrorBoundary>
        }
      />
    ),
  };
});

function Redirect({ to }: Pick<RouteRedirect, "to">) {
  const { search, hash } = useLocation();
  const params = useParams();
  return (
    <Navigate
      replace
      to={{
        pathname: typeof to === "function" ? to(params) : to,
        search,
        hash,
      }}
    />
  );
}

function ModeHomeRedirect() {
  const { mode, ready } = useAppMode();
  return ready ? <Redirect to={homeRoute(mode)} /> : <RouteLoading />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {pages
          .filter(({ meta }) => meta.chrome.shell === "app")
          .map(({ element }) => element)}
      </Route>
      {pages
        .filter(({ meta }) => meta.chrome.shell === "immersive")
        .map(({ element }) => element)}
      {ROUTE_REDIRECTS.map(({ from, to }) => (
        <Route key={from} path={from} element={<Redirect to={to} />} />
      ))}
      <Route path="/" element={<ModeHomeRedirect />} />
      <Route path="*" element={<Redirect to="/" />} />
    </Routes>
  );
}
