import { useRef } from "react";
import { Dialog } from "../../ui/Dialog";
import { Button } from "../../ui/Button";
import type { ConfirmOptions } from "./ConfirmDialog";
export default function ConfirmSurface({
  options,
  finish,
}: {
  options: ConfirmOptions;
  finish: (result: boolean) => void;
}) {
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <Dialog
      open
      title={options.title}
      size="sm"
      initialFocus={cancel}
      onClose={() => finish(false)}
      footer={
        <>
          <Button
            ref={cancel}
            variant="secondary"
            onClick={() => finish(false)}
          >
            取消
          </Button>
          <Button
            variant={options.tone === "danger" ? "danger" : "primary"}
            onClick={() => finish(true)}
          >
            {options.confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-body text-ink-2">{options.description}</div>
    </Dialog>
  );
}
