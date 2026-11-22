import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import type { LibraryNodeSummary } from "../../api/library";
import DensityControl from "../wall/DensityControl";
import Popover, { PopoverItem, PopoverLabel } from "../common/Popover";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CopyIcon,
  FolderIcon,
  MoreHorizontalIcon,
  SelectIcon,
  StarIcon,
} from "../common/Icon";
import { albumRoute } from "../../utils/path";
import { mediaCountParts } from "../../utils/mediaCount";
import type { WallDensity } from "../../store/photoStore";

interface Props {
  /** 相册摘要：标题、归属目录与数量。 */
  album: LibraryNodeSummary;
  /** 页头标题。 */
  title: string;
  /** 媒体根数量：单根时不必在页头上重复来源。 */
  multiRoot: boolean;
  /** 墙的密度。 */
  density: WallDensity;
  onDensityChange: (density: WallDensity) => void;
  /** 是否处于多选模式。 */
  selectionActive: boolean;
  onToggleSelection: () => void;
  /** 这本相册是不是收藏着。 */
  isFavorite: boolean;
  onToggleFavorite: () => void;
  /** 能不能在文件管理器里打开。 */
  canOpenInExplorer: boolean;
  onOpenInExplorer: () => void;
  onCopyLink: () => void;
  /** 返回上一级（应用内历史或来源集合）。 */
  onBack: () => void;
  /** 第二行：分组方式与筛选条由页面自己摆。 */
  children?: ReactNode;
}

/**
 * 相册页的页头。
 *
 * 它压成一行：返回 · 归属目录 · 相册名 · 数量，右侧是密度、多选、
 * 收藏与更多。照片墙是浏览页，页头占的每一行都是照片的位置。
 *
 * 相册级动作（收藏、复制链接、在文件管理器里打开）收在这一行里，
 * 不占用一整屏的封面区。
 */
export default function AlbumHeader({
  album,
  title,
  multiRoot,
  density,
  onDensityChange,
  selectionActive,
  onToggleSelection,
  isFavorite,
  onToggleFavorite,
  canOpenInExplorer,
  onOpenInExplorer,
  onCopyLink,
  onBack,
  children,
}: Props) {
  const counts = mediaCountParts(album);
  return (
    <header className="shrink-0 border-b border-border-faint bg-bg">
      {/* 照片墙与其它页面的内容左缘保持一致：留白用同一套 gutter，
          宽屏时照片铺满但边缘不跑掉。 */}
      <div className="page-shell">
        <div className="album-bar">
          <button
            type="button"
            onClick={onBack}
            className="btn btn-sm btn-ghost -ml-2 shrink-0"
            aria-label="返回"
          >
            <ChevronLeftIcon size={13} />
            <span className="hidden sm:inline">返回</span>
          </button>

          {/* 标题行：集合 › 相册 › 计数。
              身份信息摊在同一行上（左）比堆成两行更省高度，
              也让「这一本在库里的哪个位置」一眼可读。 */}
          <div className="min-w-0 flex-1 flex flex-wrap items-baseline gap-x-2 gap-y-1">
            {/* 这一本在库里的位置：所属文件夹。散图相册的标题本身就是
                归属目录，没有第二层可说，就不重复报。
                文件夹名是一段路径，不是一段文字：点它回到那个文件夹，
                否则从相册里找不到回去的路。 */}
            {album.parentName && (
              <>
                {album.parentId ? (
                  <Link
                    to={albumRoute("photo", album.parentId)}
                    className="album-bar__crumb inline-flex items-center gap-1 truncate hover:text-accent-ink transition-colors"
                    title={`回到「${album.parentName}」`}
                  >
                    <FolderIcon size={11} className="shrink-0" />
                    {album.parentName}
                  </Link>
                ) : (
                  <span className="album-bar__crumb inline-flex items-center gap-1 truncate">
                    <FolderIcon size={11} className="shrink-0" />
                    {album.parentName}
                  </span>
                )}
                <ChevronRightIcon
                  size={12}
                  className="shrink-0 text-fg-subtle"
                />
              </>
            )}
            <h1 className="album-bar__title truncate">{title}</h1>
            <div className="album-bar__meta tabular-nums">
              {/* 计数口径与其它地方一致：纯视频相册说「2 个视频」，
                  不再写「0 张 · 2 个视频」。 */}
              <span>
                <span className="text-fg font-medium">{counts.lead}</span>
                {counts.rest && (
                  <>
                    {" "}
                    <span className="text-fg-subtle">·</span>{" "}
                    <span className="text-fg font-medium">{counts.rest}</span>
                  </>
                )}
              </span>
              {/* 媒体根：只有配置了多个根才值得说，否则每本都挂一句
                  同样的来源，是噪音。 */}
              {multiRoot && album.sourceName && (
                <>
                  <span className="text-fg-subtle">·</span>
                  <span className="truncate">来自 {album.sourceName}</span>
                </>
              )}
            </div>
          </div>

          {/* 右侧操作收成一组：多选、密度切换、收藏、更多。
              组内用 hairline 分隔，读起来是一个工具条而不是几个孤立按钮。

              收藏与「更多」在窄屏也留着：窄屏上右键菜单用不了，
              没有这一组，这一页就再也点不到「收藏」「复制链接」
              「设为封面」。密度切换只留宽屏 —— 窄屏的照片墙固定
              两列，给一个改不动的控件只是噪音。 */}
          <div className="flex items-center gap-2">
            <div className="hidden items-center gap-2 md:flex">
              <span className="text-meta text-fg-subtle">密度</span>
              <DensityControl value={density} onChange={onDensityChange} />
            </div>

            {/* 多选：批量加入精选、并排对比都从这里进。
                它必须在窄屏也在 —— 触摸设备没有右键菜单，
                批量挑选只能靠这个按钮。

                放在密度控件之后：密度是「怎么看」，多选与收藏是
                「对这一本做什么」，两组不是一件事。 */}
            <button
              type="button"
              onClick={onToggleSelection}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                selectionActive
                  ? "bg-accent/15 text-accent"
                  : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
              }`}
              title={selectionActive ? "退出选择" : "选择照片"}
              aria-label={selectionActive ? "退出选择" : "选择照片"}
              aria-pressed={selectionActive}
            >
              <SelectIcon size={15} />
            </button>

            <button
              type="button"
              onClick={onToggleFavorite}
              className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors ${
                isFavorite
                  ? "text-favorite hover:bg-favorite/10"
                  : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
              }`}
              title={isFavorite ? "取消收藏" : "收藏"}
              aria-label={isFavorite ? "取消收藏" : "收藏"}
            >
              <StarIcon size={15} filled={isFavorite} />
            </button>

            <Popover
              align="end"
              aria-label="相册更多操作"
              trigger={
                <button
                  type="button"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-fg-muted transition-colors hover:bg-bg-subtle hover:text-fg"
                  title="更多"
                  aria-label="更多操作"
                >
                  <MoreHorizontalIcon size={15} />
                </button>
              }
            >
              <PopoverLabel>相册</PopoverLabel>
              <PopoverItem
                onClick={onOpenInExplorer}
                disabled={!canOpenInExplorer}
              >
                <FolderIcon size={13} />
                <span>在文件管理器中打开</span>
              </PopoverItem>
              <PopoverItem onClick={onCopyLink}>
                <CopyIcon size={13} />
                <span>复制相册链接</span>
              </PopoverItem>
              {/* 「用当前查看的图片设为封面」原先在这里，但它是个死动作：
                查看器是一层全屏浮层，打开时根本够不到这个菜单；
                关掉查看器后 viewerIndex 已经清空，点了也不会有任何反应。
                真正可用的两个入口是查看器里的「设为封面」按钮，
                以及照片墙上右键单张照片时的「设为封面」。 */}
            </Popover>
          </div>
        </div>
        {children}
      </div>
    </header>
  );
}
