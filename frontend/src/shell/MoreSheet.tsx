import { Link } from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { useNavVisibility } from "../hooks/useNavVisibility";
import { moreEntriesFor } from "../utils/navEntries";
import { Sheet } from "../ui/Sheet";
import { Button } from "../ui/Button";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import { AppearanceMenu } from "./AppearanceMenu";
export function MoreSheet({
  open,
  onClose,
  onHelp,
}: {
  open: boolean;
  onClose: () => void;
  onHelp: () => void;
}) {
  const { mode, setMode } = useAppMode(),
    { isVisible } = useNavVisibility();
  return (
    <Sheet open={open} label="更多" side="bottom" onClose={onClose}>
      <WorkspaceSwitcher mobile
        mode={mode}
        onChange={(value) => {
          setMode(value);
          onClose();
        }}
      />
      <nav aria-label="更多入口" className="my-4">
        {moreEntriesFor(mode, isVisible).map((entry) => (
          <Link
            key={entry.key}
            to={entry.to}
            onClick={onClose}
            className="flex h-[52px] items-center gap-3 rounded-md px-3 text-body hover:bg-sunken"
          >
            <entry.Icon size={20} />
            {entry.label}
          </Link>
        ))}
      </nav>
      <div className="flex items-center gap-3">
        <AppearanceMenu />
        <Button
          variant="ghost"
          onClick={() => {
            onClose();
            onHelp();
          }}
        >
          快捷键帮助
        </Button>
        <Button variant="secondary" className="ml-auto" onClick={onClose}>
          关闭
        </Button>
      </div>
    </Sheet>
  );
}
