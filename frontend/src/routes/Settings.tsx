import { useEffect, useState } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import GeneralReadingTab from "../features/settings/GeneralReadingTab";
import TasksPlanTab from "../features/settings/TasksPlanTab";
import DataStorageTab from "../features/settings/DataStorageTab";
import ServerConfigPanel from "../features/settings/ServerConfigPanel";
import { useActiveJobSummary } from "../features/tasks/useActiveJobSummary";
import { useAnchorScroll } from "../hooks/useAnchorScroll";
import { Page } from "../shell/Page";
import { PageHero } from "../shell/PageHero";
import { PageTabs } from "../shell/PageTabs";
import {
  SETTINGS_TABS,
  TAB_PAGES,
  resolveTab,
  type SettingsTabId,
} from "../utils/pageTabs";
import { settingsRoute } from "../utils/path";

export default function Settings() {
  const { tab: segment } = useParams();
  const { search, hash } = useLocation();
  const tab = resolveTab(TAB_PAGES.settings, segment);
  return tab === segment ? (
    <SettingsView tab={tab} />
  ) : (
    <Navigate replace to={{ pathname: settingsRoute(tab), search, hash }} />
  );
}

const panels = {
  general: GeneralReadingTab,
  tasks: TasksPlanTab,
  storage: DataStorageTab,
  server: ServerConfigPanel,
};

export function SettingsView({ tab }: { tab: SettingsTabId }) {
  const summary = useActiveJobSummary();
  const [visited, setVisited] = useState(() => new Set([tab]));
  useEffect(() => {
    setVisited((previous) =>
      previous.has(tab) ? previous : new Set([...previous, tab]),
    );
  }, [tab]);
  useAnchorScroll({ tab });
  return (
    <Page
      variant="system"
      className="system-page pb-12 [container-type:inline-size] [container-name:settings] [&_[id]]:scroll-mt-6 [&_[role=radio]]:inline-flex [&_[role=radio]]:items-center [&_[role=radio]]:gap-1 [&_[role=radio]]:whitespace-nowrap"
    >
      <PageHero
        compact
        title="设置与任务"
        meta="外观、阅读体验、本机分析计划与媒体服务配置。"
      />
      <PageTabs
        page={TAB_PAGES.settings}
        active={tab}
        label="设置与任务分区"
        runStatus={summary?.status}
      />
      {SETTINGS_TABS.map(({ id, label }) => {
        if (id !== tab && !visited.has(id)) return null;
        const Panel = panels[id];
        return (
          <section
            key={id}
            id={"settings-panel-" + id}
            aria-label={label + "分区"}
            hidden={id !== tab}
          >
            <Panel active={id === tab} />
          </section>
        );
      })}
    </Page>
  );
}
