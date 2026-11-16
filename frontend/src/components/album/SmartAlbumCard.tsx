import { Link } from "react-router-dom";
import type {
  SmartAlbumDimension,
  SmartAlbumDirectoryItem,
} from "../../api/albums";
import {
  SMART_ALBUM_CAPTION_HEIGHT,
  SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT,
  smartGroupHref,
} from "../../utils/smartAlbum";
import RenditionImage from "../common/RenditionImage";

const DIMENSION_LABELS: Record<SmartAlbumDimension, string> = {
  recommended: "推荐",
  time: "时间",
  place: "地点",
  people: "人物",
  scene: "场景",
};

interface Props {
  item: SmartAlbumDirectoryItem;
  /** 封面区的高度（像素）：由瀑布流按封面比例算出来。 */
  coverHeight: number;
}

/**
 * 一个智能相册分组的卡片。
 *
 * 它是「这组照片长什么样」的入口：封面是组里的第一张照片，
 * 标题是这组的名字，下面写清它有多少张、出自哪本相册。
 */
export default function SmartAlbumCard({ item, coverHeight }: Props) {
  const group = item.group;
  const recommendationReasons = group.recommendationReasons ?? [];
  const recommendationCaption =
    recommendationReasons.length > 2
      ? `${recommendationReasons.slice(0, 2).join(" · ")} · 其余 ${recommendationReasons.length - 2} 类`
      : recommendationReasons.join(" · ");
  const captionHeight =
    group.dimension === "recommended"
      ? SMART_ALBUM_RECOMMENDATION_CAPTION_HEIGHT
      : SMART_ALBUM_CAPTION_HEIGHT;
  const source = [item.parentName, item.albumName].filter(Boolean).join(" / ");

  return (
    <article className="h-full overflow-hidden rounded-xl bg-bg-elevated shadow-sm ring-1 ring-inset ring-border transition-shadow hover:shadow-md">
      <Link
        to={smartGroupHref(item)}
        className="group block h-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
        aria-label={`打开智能相册 ${group.name}，来自 ${source}，${group.photoCount} 张照片`}
      >
        <div
          className="relative overflow-hidden bg-bg-subtle"
          style={{ height: coverHeight }}
        >
          {group.coverResourceId ? (
            <RenditionImage
              fileId={group.coverResourceId}
              version={group.coverVersion}
              alt=""
              displayWidth={320}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="flex h-full items-center justify-center text-meta text-fg-subtle">
              暂无封面
            </div>
          )}
          {/* 角标里是汉字：按字号阶梯，带汉字的角标走 --text-meta，
              不占 11.5px 那一档（那一档只给拉丁字母与数字）。
              压在照片上时用 --fg 而不是 --fg-muted：角标的底色是半透明的，
              遇到亮照片底色会被照片提亮，次要灰就压不住字了。 */}
          <span className="absolute left-3 top-3 rounded-full border border-border/70 bg-bg/95 px-2 py-1 text-meta text-fg backdrop-blur-sm">
            {DIMENSION_LABELS[group.dimension]}
          </span>
          {group.overrideConflict && (
            <span className="absolute right-3 top-3 rounded-full border border-warning/50 bg-bg/95 px-2 py-1 text-meta text-warning backdrop-blur-sm">
              修改待确认
            </span>
          )}
        </div>
        <div className="px-3 pt-2 pb-1" style={{ height: captionHeight }}>
          <h3
            className="truncate text-body font-medium leading-5 text-fg"
            title={group.name}
          >
            {group.name}
          </h3>
          <p
            className="mt-1 truncate text-meta leading-4 text-fg-muted"
            title={source}
          >
            {group.photoCount} 张 · {source}
          </p>
          {group.dimension === "recommended" && (
            <p
              className="mt-1 truncate text-meta leading-4 text-fg-subtle"
              title={recommendationReasons.join(" · ")}
            >
              {recommendationCaption || "多项线索一致"}
            </p>
          )}
        </div>
      </Link>
    </article>
  );
}
