import { Link } from "react-router-dom";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import SmartAlbumWall from "../album/SmartAlbumWall";
import AlbumGridSkeleton from "../album/AlbumGridSkeleton";
import EmptyState from "../common/EmptyState";
import ErrorBanner from "../common/ErrorBanner";

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
        description="精选主题只展示至少 12 张、至少两类线索一致且不与所在文件夹重复的照片组合；时间、地点、人物和场景详细分类仍可在专页查看。"
        action={
          <Link to="/photo/smart-albums" className="btn btn-sm btn-outline">
            查看详细分类
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
          全库有 {total} 个推荐主题，这里精选了 {preview.length} 个
        </p>
      )}
    </div>
  );
}
