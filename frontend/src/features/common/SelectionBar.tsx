import { useEffect, type ReactNode } from "react";
import { hasOpenModal, shouldIgnoreShortcut } from "../../utils/shortcuts";
import { CloseIcon } from "../../ui/icons";
export interface SelectionAction {
  id: string;
  label: string;
  icon?: ReactNode;
  description?: string;
  title?:string;
  tone?: "default" | "danger";
  disabled?: boolean;
  onRun: () => void | Promise<void>;
}
interface Props {
  count: number;
  noun: string;
  active?: boolean;
  busy?: boolean;
  label?: string;
  detail?: string;
  actions: SelectionAction[];
  onExit: () => void;
  onSelectLoaded?: () => void;
}
export function SelectionBar({
  count,
  noun,
  active = false,
  busy = false,
  label = "多选操作",
  detail,
  actions,
  onExit,
  onSelectLoaded,
}: Props) {
  const visible = active || count > 0;
  useEffect(() => {
    if (!visible || busy) return;
    function key(e: KeyboardEvent) {
      if (
        e.defaultPrevented ||
        e.isComposing ||
        hasOpenModal() ||
        shouldIgnoreShortcut(e)
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        onExit();
      } else if (
        onSelectLoaded &&
        e.key.toLowerCase() === "a" &&
        (e.ctrlKey || e.metaKey) &&
        !e.altKey
      ) {
        e.preventDefault();
        onSelectLoaded();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [visible, busy, onExit, onSelectLoaded]);
  if (!visible) return null;
  return (
    <div
      role="toolbar"
      aria-label={label}
      className="fixed inset-x-2 bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom)+12px)] z-popover mx-auto flex min-h-[52px] w-fit max-w-[calc(100%-16px)] flex-wrap items-center justify-center gap-1 rounded-3xl bg-inverse px-2.5 py-1.5 text-caption text-on-inverse shadow-3 md:bottom-5"
    >
      <button
        type="button"
        disabled={busy}
        aria-label="退出选择"
        title="退出选择 (Esc)"
        className="grid size-9 place-items-center rounded-full hover:bg-white/15"
        onClick={onExit}
      >
        <CloseIcon size={15} />
      </button>
      <span role="status" className="mr-2 tabular-nums">
        已选 {count} {noun}
        {detail && <span> · {detail}</span>}
        {busy && <span className="inline-flex items-center gap-1"> · <i aria-hidden className="size-3 animate-spin rounded-full border border-current border-r-transparent"/> 正在提交…</span>}
      </span>
      {actions.map((action) => (
        <button
          type="button"
          key={action.id}
          disabled={busy || action.disabled}
          title={action.title ?? action.description ?? action.label}
          aria-label={action.description ?? action.label}
          onClick={() => void action.onRun()}
          className={
            "inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 hover:bg-white/15 disabled:opacity-45 " +
            (action.tone === "danger" ? "text-theater-danger" : "")
          }
        >
          {action.icon}
          <span className={action.icon ? "sr-only sm:not-sr-only" : undefined}>
            {action.label}
          </span>
        </button>
      ))}
    </div>
  );
}
