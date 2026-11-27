import { ArrowUpIcon, ArrowDownIcon } from "../../ui/icons";

interface Props {
  onPrevAlbum?: () => void;
  onNextAlbum?: () => void;
  /** 目标卷名：悬停时浮在箭头旁边，回答「点下去会翻到哪一卷」。 */
  prevLabel?: string;
  nextLabel?: string;
}

// 宽屏显示同作品的相邻卷，较窄时归入更多菜单。
export default function GalleryAlbumNav({
  onPrevAlbum,
  onNextAlbum,
  prevLabel,
  nextLabel,
}: Props) {
  if (!onPrevAlbum && !onNextAlbum) return null;

  return (
    <div className="reader-volume-nav absolute left-2 top-1/2 z-10 -translate-y-1/2 flex-col gap-1">
      {onPrevAlbum && (
        <NavButton onClick={onPrevAlbum} title="上一卷 (P)" label={prevLabel}>
          <ArrowUpIcon size={17} />
        </NavButton>
      )}
      {onNextAlbum && (
        <NavButton onClick={onNextAlbum} title="下一卷 (N)" label={nextLabel}>
          <ArrowDownIcon size={17} />
        </NavButton>
      )}
    </div>
  );
}

function NavButton({
  children,
  onClick,
  title,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  label?: string;
}) {
  return (
    <div className="group/nav flex items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-label={label ? `${title}：${label}` : title}
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-theater-surface/55 text-theater-fg backdrop-blur-[2px] ring-1 ring-theater-border transition-colors hover:bg-theater-surface/75 hover:text-theater-fg"
      >
        {children}
      </button>
      {/* 目标卷名：只在悬停时浮出，平时不占画面。 */}
      {label && (
        <span className="pointer-events-none max-w-[10rem] truncate rounded-md bg-theater-surface/80 px-2 py-1 text-caption text-theater-fg opacity-100 pointer-fine:opacity-0 backdrop-blur-[2px] transition-opacity duration-150 group-hover/nav:opacity-100 group-focus-within/nav:opacity-100">
          {label}
        </span>
      )}
    </div>
  );
}
