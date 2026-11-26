import { PageTabs } from "../../shell/PageTabs";
import { TAB_PAGES } from "../../utils/pageTabs";
export function SettingsNav({ active }: { active: string }) {
  return (
    <PageTabs active={active} page={TAB_PAGES.settings} label="设置页分区" />
  );
}
