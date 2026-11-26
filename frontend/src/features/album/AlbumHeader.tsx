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
import { PageHeader } from "../../shell/PageHeader";

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
  onBack,
  actions,
  children,
}: Props) {
  const counts = mediaCountParts(album);
  const parent = album.parentName;
  return (
    <PageHeader
      title={title}
      meta={
        <>
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
        </>
      }
      actions={
        <>
          {actions}
          <button
            type="button"
            className="toolbar-icon"
            aria-pressed={selectionActive}
            title={selectionActive ? "退出选择" : "选择照片"}
            aria-label={selectionActive ? "退出选择" : "选择照片"}
            onClick={onToggleSelection}
          >
            <SelectIcon size={16} />
          </button>
          <button
            type="button"
            className={`toolbar-icon ${isFavorite ? "text-favorite" : ""}`}
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
                className="toolbar-icon"
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
            <PopoverItem
              onClick={onOpenInExplorer}
              disabled={!canOpenInExplorer}
            >
              <FolderIcon size={14} /> 在文件管理器中打开
            </PopoverItem>
            <PopoverItem onClick={onCopyLink}>
              <CopyIcon size={14} /> 复制相册链接
            </PopoverItem>
          </Popover>
        </>
      }
      toolbar={children}
      eyebrow={
        <div className="flex items-center gap-2">
          {
            <button
              type="button"
              className="toolbar-icon"
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
                className="album-parent-link inline-flex items-center gap-1 max-w-full text-fg-muted text-caption [&>svg]:shrink-0"
              >
                <FolderIcon size={14} />
                <span className="truncate">{parent}</span>
              </Link>
            ) : (
              <span className="album-parent-link inline-flex items-center gap-1 max-w-full text-fg-muted text-caption [&>svg]:shrink-0">{parent}</span>
            ))}
        </div>
      }
    />
  );
}
