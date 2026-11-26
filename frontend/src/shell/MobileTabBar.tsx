import { Link, useLocation } from "react-router-dom";
import { useAppMode } from "../hooks/useAppMode";
import { useNavVisibility } from "../hooks/useNavVisibility";
import { isNavEntryActive, mobileTabsFor } from "../utils/navEntries";
import { cx } from "../ui/cx";
import { MoreHorizontalIcon } from "../ui/icons";
export function MobileTabBar({
  onMore,
  immersive = false,
  open = false,
}: {
  onMore: () => void;
  immersive?: boolean;
  open?: boolean;
}) {
  const { mode } = useAppMode(),
    { pathname } = useLocation(),
    { isVisible } = useNavVisibility();
  if (immersive) return null;
  const tabs = mobileTabsFor(mode, isVisible);
  return (
    <nav
      aria-label="主导航"
      className="mobile-tabs fixed inset-x-0 bottom-0 z-tabbar flex border-t border-line pb-[env(safe-area-inset-bottom)]"
      data-open={open}
    >
      {tabs.map((entry) => {
        const active = isNavEntryActive(entry, pathname, mode),
          Icon = active ? (entry.ActiveIcon ?? entry.Icon) : entry.Icon;
        return (
          <Link
            key={entry.key}
            to={entry.to}
            aria-current={active ? "page" : undefined}
            className={cx(
              "flex h-tabbar flex-1 flex-col items-center justify-center gap-1 text-micro",
              active ? "font-semibold text-fg" : "text-fg-subtle",
            )}
          >
            <Icon size={24} />
            {entry.label}
          </Link>
        );
      })}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={onMore}
        className="flex h-tabbar flex-1 flex-col items-center justify-center gap-1 text-micro text-fg-muted"
      >
        <MoreHorizontalIcon size={24} />
        更多
      </button>
    </nav>
  );
}
