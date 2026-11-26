import { Tabs } from "../ui/Tabs";
import { tabRoute,type TabbedPage } from "../utils/pageTabs";
export function PageTabs({
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

  return (
    <Tabs
      label={label}
      value={active}
      as="nav"
      className="my-4 overflow-x-auto whitespace-nowrap border-b border-line-subtle"
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

