import { buttonStyles } from "../../ui/buttonStyles";
import { Link } from "react-router-dom";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import { smartAlbumPreviewColumns } from "../../utils/smartAlbum";
import { SmartAlbumWall } from "../album";
import { AlbumGridSkeleton } from "../library";
import { EmptyState } from "../common";
import { ErrorBanner } from "../common";

/** 首页精选最多六个不同来源文件夹的推荐主题。 */
export const HOME_SMART_ALBUM_PREVIEW = 6;

interface Props {
  items: SmartAlbumDirectoryItem[];
  total?: number;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
}

/**
 * 首页的智能相册预览。
 *
 * 首页是发现页：它给的是一屏样张，不是全部分组 —— 全库四千多组
 * 铺在首页会把这一页拖到几千像素高，真正的浏览在智能相册页。
 */
export default function SmartAlbumPreview({
  items,
  total,
  isLoading,
  isError,
  onRetry,
}: Props) {
  // API 的 featured 视图已经按质量和来源文件夹多样性挑选，不在 UI
  // 里从全库分组墙截取前几项。
  const preview = items;

  if (isLoading && preview.length === 0) {
    return (
      <AlbumGridSkeleton count={6} bare label="正在汇总已生成的智能相册…" />
    );
  }

  if (isError && preview.length === 0) {
    return (
      <ErrorBanner onRetry={onRetry} retrying={isLoading}>
        智能相册汇总暂时读不出来。
      </ErrorBanner>
    );
  }

  if (preview.length === 0) {
    return (
      <EmptyState
        title="暂时没有精选推荐"
        description="精选主题只展示至少 12 张、至少两类线索一致且不与所在文件夹重复的照片组合。"
        action={
          <Link
            to="/photo/smart-albums"
            className={buttonStyles({ variant: "secondary", size: "sm" })}
          >
            查看精选推荐
          </Link>
        }
        icon={<span aria-hidden="true">✦</span>}
        size="compact"
      />
    );
  }

  return (
    <div>
      {/* 六张卡要排成整整齐齐的矩形：列数得能整除它，否则末行只挂一张。 */}
      <SmartAlbumWall
        items={preview}
        targetColumnWidth={300}
        columns={(computed) =>
          smartAlbumPreviewColumns(computed, preview.length)
        }
      />
      {typeof total === "number" && (
        <p className="mt-4 text-caption tabular-nums text-ink-3">
          全库有 {total} 个推荐主题，这里精选了 {preview.length} 个
        </p>
      )}
    </div>
  );
}
