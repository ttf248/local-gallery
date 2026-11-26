import {
  useRef,
  useState,
  useLayoutEffect,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../../store/uiStore";
import { useMediaQuery, WIDE_LAYOUT_QUERY } from "../../hooks/useMediaQuery";
import { useFocusTrap } from "../../ui/useFocusTrap";
import { useKeyboard } from "../../hooks/useKeyboard";
import { hasOpenModal } from "../../utils/shortcuts";
import { CloseIcon } from "../../ui/icons";

// eslint-disable-next-line react-refresh/only-export-components
export function useFolderDrawer() {
  const desktop = useMediaQuery(WIDE_LAYOUT_QUERY);
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
  triggerRef,
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
  return createPortal(
    <MobileDrawer triggerRef={triggerRef} onClose={onClose}>
      {children}
    </MobileDrawer>,
    document.body,
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

function MobileDrawer({
  triggerRef,
  onClose,
  children,
}: {
  triggerRef?: RefObject<HTMLButtonElement>;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLElement>(null);
  useFocusTrap(ref, true);

  useLayoutEffect(() => {
    const before = document.activeElement;
    const trigger = triggerRef?.current;
    const main = document.querySelector<HTMLElement>(".app-main");
    const navOpen = main?.getAttribute("data-nav-open");
    const scrim = ref.current?.parentElement;
    const background = Array.from(document.body.children)
      .filter((element) => element !== scrim)
      .concat(main ? [main] : [])
      .filter((element) => !element.hasAttribute("inert"));
    background.forEach((element) => element.setAttribute("inert", ""));
    main?.setAttribute("data-nav-open", "true");
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => {
      background.forEach((element) => element.removeAttribute("inert"));
      if (navOpen != null) main?.setAttribute("data-nav-open", navOpen);
      else main?.removeAttribute("data-nav-open");
      if (
        before instanceof HTMLElement &&
        before !== document.body &&
        before.isConnected
      )
        before.focus({ preventScroll: true });
      else trigger?.focus({ preventScroll: true });
    };
  }, [triggerRef]);

  return (
    <div
      className="folder-drawer-scrim"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <aside
        ref={ref}
        id="library-tree"
        className="folder-drawer folder-drawer--modal"
        role="dialog"
        aria-modal="true"
        aria-label="目录抽屉"
        onKeyDown={(event) => {
          if (event.key !== "Escape" || event.nativeEvent.isComposing) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
      >
        <FolderDrawerContent onClose={onClose}>{children}</FolderDrawerContent>
      </aside>
    </div>
  );
}
