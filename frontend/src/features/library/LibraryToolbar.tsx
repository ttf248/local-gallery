import { type ReactNode, useState } from "react";
import { FilterBar } from "../common";

export function LibraryToolbar({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <FilterBar
      label="显示与排序"
      dialogLabel="相册显示与排序"
      count={0}
      open={open}
      onOpenChange={setOpen}
      panel={children}
    />
  );
}
