import { CheckIcon, AlertIcon } from "../common/Icon";
import type { FieldStatus } from "../../hooks/useServerConfigSave";

/** 字段的保存状态指示：空 / 保存中 / 已保存 / 保存失败。 */
export default function StatusBadge({ status }: { status: FieldStatus }) {
  if (status === "idle") return <span className="w-4 shrink-0" />;
  if (status === "saving") {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-2 border-fg-muted border-t-transparent animate-spin shrink-0"
        aria-label="保存中"
      />
    );
  }
  if (status === "saved") {
    return (
      <CheckIcon
        size={14}
        className="text-accent shrink-0"
        aria-label="已保存"
      />
    );
  }
  return (
    <AlertIcon
      size={14}
      className="text-danger shrink-0"
      aria-label="保存失败"
    />
  );
}
