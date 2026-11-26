import { Link } from "react-router-dom";
import type { SmartAlbumDirectoryItem } from "../../api/albums";
import {
  SMART_ALBUM_CAPTION_HEIGHT,
  SMART_ALBUM_DIMENSION_LABELS,
  SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT,
  smartAlbumEvidenceDimensions,
  smartGroupHref,
} from "../../utils/smartAlbum";
import SmartAlbumCover from "./SmartAlbumCover";
import SmartAlbumEvidence from "./SmartAlbumEvidence";

interface Props {
  item: SmartAlbumDirectoryItem;
  /** 封面区的高度（像素）：由瀑布流按封面比例算出来。 */
  coverHeight: number;
  /**
   * 封面槽位的宽度（像素）：决定取哪一档渲染图。
   *
   * 别写死：首页预览的列宽能到五百多像素，按固定档取图会放大发虚。
   */
  coverWidth: number;
}

/**
 * 一个智能相册分组的卡片。
 *
 * 它是「这组照片长什么样」的入口：封面是组里的第一张照片，
 * 标题是这组的名字，下面写清它有多少张、出自哪本相册。
 *
 * 推荐多一行：几类线索对上了同一批照片，这是它值得单独成组的理由。
 */
export default function SmartAlbumCard({
  item,
  coverHeight,
  coverWidth,
}: Props) {
  const group = item.group;
  const evidence = smartAlbumEvidenceDimensions(group);
  // 老缓存里可能没有 evidenceDimensions（全库刷新之前仍会列出旧推荐），
  // 这时退回理由文字：理由对人仍然成立，只是没有芯片那么好认。
  const reasons = group.recommendationReasons ?? [];
  const captionHeight =
    group.dimension === "recommended"
      ? SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT
      : SMART_ALBUM_CAPTION_HEIGHT;
  const source = [item.parentName, item.albumName].filter(Boolean).join(" / ");

  return (
    <article className="h-full overflow-hidden rounded-xl bg-raised shadow-1 ring-1 ring-inset ring-line transition-shadow hover:shadow-2">
      <Link
        to={smartGroupHref(item)}
        className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
        aria-label={`打开智能相册 ${group.name}，来自 ${source}，${group.photoCount} 张照片`}
      >
        <div
          className="relative overflow-hidden bg-sunken"
          style={{ height: coverHeight }}
          data-testid="smart-album-cover"
        >
          <SmartAlbumCover
            fileId={group.coverResourceId}
            version={group.coverVersion}
            displayWidth={coverWidth}
          />
          {/* 角标里是汉字：按字号阶梯，带汉字的角标走 --text-caption，
              不占 11.5px 那一档（那一档只给拉丁字母与数字）。
              压在照片上时用 --ink 而不是 --ink-2：角标的底色是半透明的，
              遇到亮照片底色会被照片提亮，次要灰就压不住字了。 */}
          <span
            className="absolute left-3 top-3 rounded-full border border-line/70 bg-canvas/95 px-2 py-1 text-caption text-ink"
            data-testid="smart-album-dimension"
          >
            {SMART_ALBUM_DIMENSION_LABELS[group.dimension] ?? group.dimension}
          </span>
          {group.overrideConflict && (
            <span className="absolute right-3 top-3 rounded-full border border-warning/50 bg-canvas/95 px-2 py-1 text-caption text-warning">
              修改待确认
            </span>
          )}
        </div>
        <div className="px-3 pt-2 pb-1" style={{ height: captionHeight }}>
          <h3
            className="truncate text-body font-medium leading-5 text-ink"
            title={group.name}
          >
            {group.name}
          </h3>
          <p
            className="mt-1 truncate text-caption leading-4 text-ink-2"
            title={source}
          >
            {group.photoCount} 张 · {source}
          </p>
          {group.dimension === "recommended" &&
            (evidence.length > 0 ? (
              <span className="mt-1 block">
                <SmartAlbumEvidence dimensions={evidence} />
              </span>
            ) : (
              <p
                className="mt-1 truncate text-caption leading-4 text-ink-3"
                title={reasons.join(" · ")}
              >
                {reasons.join(" · ")}
              </p>
            ))}
        </div>
      </Link>
    </article>
  );
}
