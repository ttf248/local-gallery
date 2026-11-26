import {
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from "react";
import { Sheet } from "../../ui/Sheet";
import { useUIStore } from "../../store/uiStore";
import { useMediaQuery, SPLIT_LAYOUT_QUERY } from "../../hooks/useMediaQuery";

import { useKeyboard } from "../../hooks/useKeyboard";
import { hasOpenModal } from "../../utils/shortcuts";
import { CloseIcon } from "../../ui/icons";

// eslint-disable-next-line react-refresh/only-export-components
export function useFolderDrawer() {
  const desktop = useMediaQuery(SPLIT_LAYOUT_QUERY);
  const pinned = useUIStore((state) => state.folderDrawerOpen);
  const setPinned = useUIStore((state) => state.setFolderDrawerOpen);
  const [mobileOpen, setMobileOpen] = useState(false);
  const open = desktop ? pinned : mobileOpen;
  const setOpen = desktop ? setPinned : setMobileOpen;
  const triggerRef = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    if (desktop) setMobileOpen(false);
  }, [desktop]);

  useKeyboard(
    {
      "ctrl+\\": () => {
        if (hasOpenModal() && (desktop || !mobileOpen)) return;
        setOpen(!open);
      },
    },
    !useUIStore((state) => state.immersiveOverlay),
  );

  return { desktop, open, setOpen, triggerRef };
}

export default function FolderDrawer({
  open,
  desktop,
  onClose,
  children,
}: {
  open: boolean;
  desktop: boolean;
  triggerRef?: RefObject<HTMLButtonElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  if (!open) return null;
  if (desktop)
    return (
      <aside
        id="library-tree"
        className="folder-drawer folder-drawer--pinned"
        aria-label="目录抽屉"
      >
        <FolderDrawerContent onClose={onClose}>{children}</FolderDrawerContent>
      </aside>
    );
  return (
    <Sheet
      id="library-tree"
      open={open}
      side="left"
      label="目录抽屉"
      className="flex flex-col overflow-y-auto"
      onClose={onClose}
    >
      <FolderDrawerContent onClose={onClose}>{children}</FolderDrawerContent>
    </Sheet>
  );
}

function FolderDrawerContent({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <>
      <div className="folder-drawer__heading">
        <h2>目录</h2>
        <button
          type="button"
          className="toolbar-icon"
          aria-label="关闭目录抽屉"
          onClick={onClose}
        >
          <CloseIcon size={17} />
        </button>
      </div>
      {children}
    </>
  );
}
