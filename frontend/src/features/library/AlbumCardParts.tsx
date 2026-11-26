import { HeartIcon, FolderIcon, ImageIcon, HashIcon } from "../../ui/icons";
import type { CardVariant } from "./AlbumTile";
export function TypeChip({ variant }: { variant: CardVariant }) {
  const Icon =
    variant === "album"
      ? ImageIcon
      : variant === "smart"
        ? HashIcon
        : FolderIcon;
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-caption text-fg-subtle">
      <Icon aria-hidden size={14} />
      {variant === "smart" && "标签"}
    </span>
  );
}
export function FavoriteButton({
  fav,
  label,
  onToggle,
  className = "",
  alwaysVisible = false,
}: {
  fav: boolean;
  label: string;
  onToggle: () => void;
  className?: string;
  alwaysVisible?: boolean;
}) {
  // 显隐由 .hover-reveal 统一管：触摸设备上常驻，鼠标设备上悬停
  // 才浮出来（focus-visible 让键盘也能看到它）。
  const visibility =
    fav || alwaysVisible
      ? "opacity-100"
      : "hover-reveal group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100";
  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={fav}
      aria-label={fav ? `取消收藏「${label}」` : `收藏「${label}」`}
      title={fav ? "取消收藏" : "收藏"}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-full bg-bg-elevated/90 backdrop-blur shadow-sm transition-opacity ${visibility} ${
        fav ? "text-favorite" : "text-fg-muted hover:text-fg"
      } ${className}`}
    >
      <HeartIcon size={16} filled={fav} />
    </button>
  );
}

/** 长目录名常以日期或卷号结尾，给末尾单独保留空间。 */
export function AlbumName({ name }: { name: string }) {
  const chars = Array.from(name);
  return chars.length <= 34 ? (
    <span className="truncate" title={name}>
      {name}
    </span>
  ) : (
    <span className="flex min-w-0" title={name}>
      <span className="truncate">{chars.slice(0, -10).join("")}</span>
      <span className="shrink-0">{chars.slice(-10).join("")}</span>
    </span>
  );
}
