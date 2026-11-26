import { type ReactNode, useState } from "react";
import { usePageChromeState } from "../../shell/PageChrome";
import { FilterDropdown } from "../common";

export function LibraryToolbar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <FilterDropdown
      label="显示与排序"
      dialogLabel="相册显示与排序"
      count={0}
      open={open}
      onOpenChange={setOpen}
      panel={children}
    />
  );
}

export function CompactLibraryToolbar({ children }: { children: ReactNode }) {
  const { titleCollapsed } = usePageChromeState();
  return titleCollapsed ? <LibraryToolbar>{children}</LibraryToolbar> : null;
}
