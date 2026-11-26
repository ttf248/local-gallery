import type { ReactNode } from "react";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../hooks/useMediaQuery";
import { Tabs } from "../ui/Tabs";
import { tabRoute, type TabbedPage } from "../utils/pageTabs";

export function SplitNav({
  page,
  active,
  label,
  runStatus,
}: {
  page: TabbedPage;
  active: string;
  label: string;
  runStatus?: string;
}) {
  const wide = useMediaQuery(WIDE_LAYOUT_QUERY);
  return (
    <Tabs
      label={label}
      value={active}
      orientation={wide ? "vertical" : "horizontal"}
      className="overflow-x-auto whitespace-nowrap lg:sticky lg:top-4"
      items={page.tabs.map((tab) => ({
        id: tab.id,
        href: tabRoute(page, tab.id),
        label: (
          <>
            {tab.label}
            {tab.id === "run" &&
              (runStatus === "running" || runStatus === "failed") && (
                <span
                  role="img"
                  aria-label={runStatus === "running" ? "运行中" : "上次失败"}
                  className={
                    "size-2 rounded-full " +
                    (runStatus === "running"
                      ? "bg-accent motion-safe:animate-pulse"
                      : "bg-danger")
                  }
                />
              )}
          </>
        ),
      }))}
    />
  );
}

export function SplitLayout({
  navigation,
  settings,
  children,
}: {
  navigation: ReactNode;
  settings?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="mt-6 grid items-start gap-6 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
      {navigation}
      <div
        className={
          "w-full min-w-0 " + (settings ? "max-w-[720px]" : "max-w-[760px]")
        }
      >
        {children}
      </div>
    </div>
  );
}
