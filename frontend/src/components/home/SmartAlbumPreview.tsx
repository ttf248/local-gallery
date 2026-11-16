import { Link } from "react-router-dom";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import SmartAlbumWall from "../album/SmartAlbumWall";
import AlbumGridSkeleton from "../album/AlbumGridSkeleton";
import EmptyState from "../common/EmptyState";
import ErrorBanner from "../common/ErrorBanner";

/** 首页只给一屏预览：完整的墙在智能相册页。 */
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
  const preview = items.slice(0, HOME_SMART_ALBUM_PREVIEW);

  if (isLoading && preview.length === 0) {
    return (
      <AlbumGridSkeleton
        count={6}
        bare
        label="正在汇总已生成的智能相册…"
      />
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
        title="还没有智能相册分组"
        description="智能相册按时间、地点、人物和场景分组。每一类都需要对应的照片线索：到任务中心跑一次分析，再打开照片相册生成分组。"
        action={
          <Link to="/tasks/run" className="btn btn-sm btn-outline">
            打开任务中心
          </Link>
        }
        icon={<span aria-hidden="true">✦</span>}
        dense
      />
    );
  }

  return (
    <div>
      <SmartAlbumWall items={preview} targetColumnWidth={300} />
      {typeof total === "number" && (
        <p className="mt-4 text-meta tabular-nums text-fg-subtle">
          共 {total} 组，这里是其中 {preview.length} 组
        </p>
      )}
    </div>
  );
}
