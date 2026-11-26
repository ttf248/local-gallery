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
import { PageToolbar } from "../../shell/PageToolbar";
import { PageHero } from "../../shell/PageHero";

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
  return (
    <>
      <PageHero
        compact
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
        eyebrow={
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
                  className="album-parent-link inline-flex items-center gap-1 max-w-full text-ink-2 text-caption [&>svg]:shrink-0"
                >
                  <FolderIcon size={14} />
                  <span className="truncate">{parent}</span>
                </Link>
              ) : (
                <span className="album-parent-link inline-flex items-center gap-1 max-w-full text-ink-2 text-caption [&>svg]:shrink-0">
                  {parent}
                </span>
              ))}
          </div>
        }
      />
      <PageToolbar
        label="相册照片工具"
        start={children}
        end={
          <>
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
          </>
        }
      />
    </>
  );
}
