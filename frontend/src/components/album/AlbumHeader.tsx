import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LibraryNodeSummary } from "../../api/library";
import Popover, { PopoverItem, PopoverLabel } from "../common/Popover";
import {
  ChevronLeftIcon,
  CopyIcon,
  FolderIcon,
  MoreHorizontalIcon,
  SelectIcon,
  StarIcon,
} from "../common/Icon";
import { albumRoute } from "../../utils/path";
import { mediaCountParts } from "../../utils/mediaCount";
import StickyPageHeader from "../layout/StickyPageHeader";

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
  onBack,
  actions,
  children,
}: Props) {
  const counts = mediaCountParts(album);
  const parent = album.parentName;
  return (
    <StickyPageHeader
      className="photo-album-header"
      title={title}
      leading={
        <button
          type="button"
          className="toolbar-icon"
          aria-label="返回"
          onClick={onBack}
        >
          <ChevronLeftIcon size={18} />
        </button>
      }
      breadcrumbs={
        parent &&
        (album.parentId ? (
          <Link
            to={albumRoute("photo", album.parentId)}
            title={`回到「${parent}」`}
            className="album-parent-link"
          >
            <FolderIcon size={14} />
            <span className="truncate">{parent}</span>
          </Link>
        ) : (
          <span className="album-parent-link">{parent}</span>
        ))
      }
      meta={
        <>
          {counts.lead}
          {counts.rest && ` · ${counts.rest}`}
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
            <StarIcon size={16} filled={isFavorite} />
          </button>
          <Popover
            align="end"
            aria-label="相册更多操作"
            trigger={
              <button
                type="button"
                className="toolbar-icon"
                title="更多"
                aria-label="更多操作"
              >
                <MoreHorizontalIcon size={18} />
              </button>
            }
          >
            <PopoverLabel>相册</PopoverLabel>
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
      subbar={children}
    />
  );
}
