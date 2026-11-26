import { SplitNav } from "../../shell/SplitLayout";
import { TAB_PAGES } from "../../utils/pageTabs";
export function SettingsNav({ active }: { active: string }) {
  return (
    <SplitNav active={active} page={TAB_PAGES.settings} label="设置页分区" />
  );
}
