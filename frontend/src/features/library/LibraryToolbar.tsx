import { type ReactNode, useState } from "react";
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
