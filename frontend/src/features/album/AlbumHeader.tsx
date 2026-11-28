import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LibraryNodeSummary } from "../../api/library";
import Popover, { PopoverItem, PopoverLabel } from "../../ui/Popover";
import {
  ChevronLeftIcon,
  CopyIcon,
  FolderIcon,
  MoreHorizontalIcon,
  SelectIcon,
  HeartIcon,
  InfoIcon,
} from "../../ui/icons";
import { albumRoute } from "../../utils/path";
import { mediaCountParts } from "../../utils/mediaCount";
import { usePageChrome } from "../../shell/PageChrome";

interface Props {
  album: LibraryNodeSummary;
  title: string;
  multiRoot: boolean;
  selectionActive: boolean;
  onToggleSelection: () => void;
  isFavorite: boolean;
  onToggleFavorite: () => void;
  canOpenInExplorer: boolean;
  onOpenInExplorer: () => void;
  onCopyLink: () => void;
  onProperties: () => void;
  onInfo: () => void;
  onBack: () => void;
  actions?: ReactNode;
  children?: ReactNode;
}

export default function AlbumHeader({
  album,
  title,
  multiRoot,
  selectionActive,
  onToggleSelection,
  isFavorite,
  onToggleFavorite,
  canOpenInExplorer,
  onOpenInExplorer,
  onCopyLink,
  onProperties,
  onInfo,
  onBack,
  actions,
  children,
}: Props) {
  const counts = mediaCountParts(album);
  const parent = album.parentName;
  const { titleRef } = usePageChrome({ title });
  return (
    <header
      data-page-header
      className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-line-subtle py-3"
    >
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        {" "}
        <div className="flex items-center gap-2">
          {
            <button
              type="button"
              className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-3 transition duration-base hover:bg-sunken hover:text-ink touch:active:bg-sunken touch:active:text-ink touch:w-11 touch:h-11"
              aria-label="返回"
              onClick={onBack}
            >
              <ChevronLeftIcon size={18} />
            </button>
          }{" "}
          {parent &&
            (album.parentId ? (
              <Link
                to={albumRoute("photo", album.parentId)}
                title={`回到「${parent}」`}
                className="album-parent-link inline-flex min-h-8 touch:min-h-10 items-center gap-1 max-w-full text-ink-2 text-caption [&>svg]:shrink-0"
              >
                <FolderIcon size={14} />
                <span className="truncate">{parent}</span>
              </Link>
            ) : (
              <span className="album-parent-link inline-flex min-h-8 touch:min-h-10 items-center gap-1 max-w-full text-ink-2 text-caption [&>svg]:shrink-0">
                {parent}
              </span>
            ))}
        </div>
        <h1
          ref={titleRef}
          className="min-w-0 break-words text-title font-semibold tracking-tight"
        >
          {title}
        </h1>
        <span className="text-caption tabular-nums text-ink-2">
          {counts.lead}
          {counts.rest && ` · ${counts.rest}`}
          {album.date &&
            album.dateSource !== "modified" &&
            " · " +
              album.date
                .slice(0, 7)
                .replace(
                  /^(\d{4})-(\d{2})$/,
                  (_, year: string, month: string) =>
                    year + " 年 " + Number(month) + " 月",
                )}
          {multiRoot && album.sourceName && ` · 来自 ${album.sourceName}`}
        </span>
      </div>
      <div
        role="toolbar"
        aria-label="相册照片工具"
        className="flex flex-wrap items-center gap-1"
      >
        {actions}

        <button
          type="button"
          className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-3 transition duration-base hover:bg-sunken hover:text-ink touch:active:bg-sunken touch:active:text-ink touch:w-11 touch:h-11"
          aria-pressed={selectionActive}
          title={selectionActive ? "退出选择" : "选择照片"}
          aria-label={selectionActive ? "退出选择" : "选择照片"}
          onClick={onToggleSelection}
        >
          <SelectIcon size={16} />
        </button>
        <button
          type="button"
          className="grid size-10 place-items-center rounded-md hover:bg-hover"
          onClick={onInfo}
          aria-label="相册信息"
        >
          <InfoIcon size={16} />
        </button>
        <button
          type="button"
          className={`inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-3 transition duration-base hover:bg-sunken hover:text-ink touch:active:bg-sunken touch:active:text-ink touch:w-11 touch:h-11 ${isFavorite ? "text-favorite" : ""}`}
          title={isFavorite ? "取消收藏" : "收藏"}
          aria-label={isFavorite ? "取消收藏" : "收藏"}
          onClick={onToggleFavorite}
        >
          <HeartIcon size={16} filled={isFavorite} />
        </button>
        <Popover
          align="end"
          aria-label="相册更多操作"
          trigger={
            <button
              type="button"
              className="inline-flex items-center justify-center w-9 h-9 rounded-md text-ink-3 transition duration-base hover:bg-sunken hover:text-ink touch:active:bg-sunken touch:active:text-ink touch:w-11 touch:h-11"
              title="更多"
              aria-label="相册更多操作"
            >
              <MoreHorizontalIcon size={18} />
            </button>
          }
        >
          <PopoverLabel>相册</PopoverLabel>
          <PopoverItem onClick={onProperties}>
            <InfoIcon size={14} /> 属性
          </PopoverItem>
          <PopoverItem onClick={onOpenInExplorer} disabled={!canOpenInExplorer}>
            <FolderIcon size={14} /> 在文件管理器中打开
          </PopoverItem>
          <PopoverItem onClick={onCopyLink}>
            <CopyIcon size={14} /> 复制相册链接
          </PopoverItem>
        </Popover>
      </div>
      {children && <div className="w-full empty:hidden">{children}</div>}
    </header>
  );
}
