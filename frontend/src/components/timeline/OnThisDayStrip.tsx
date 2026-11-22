import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOnThisDayAlbums } from "../../hooks/useLibrary";
import ThumbImage from "../common/ThumbImage";
import { albumRoute } from "../../utils/path";
import {
  ON_THIS_DAY_THUMB_HEIGHT,
  onThisDayThumbWidth,
} from "../../utils/onThisDay";

interface Props {
  /** 这一侧有没有内容。 */
  enabled: boolean;
}

/**
 * 「那年今日」：往年同一天拍过照的那些照片，紧凑地摆成一条。
 *
 * 它是回忆的入口，不是浏览的主线 —— 时间线才是这一页的主内容。因此
 * 这里只留一条窄窄的缩略图带：看一眼，点进去是那一张照片，回得到它的
 * 相册。
 *
 * 摆的是「那天拍的那一张」，不是相册封面：这一条回答的是「往年这天
 * 我拍到了什么」，给一张封面等于什么也没说。
 *
 * 因此缩略图要看得清：太小的一格格认不出拍的是什么，这一行就退化成了
 * 装饰。而且按照片自己的比例摆，不裁成方块 —— 回忆里缺的那一角往往正是
 * 内容本身。整条仍然是横向的一条，宽度不够时自己滚。
 */
export default function OnThisDayStrip({ enabled }: Props) {
  const today = new Date();
  const query = useOnThisDayAlbums(
    "photo",
    today.getMonth() + 1,
    today.getDate(),
    8,
    enabled,
    true,
  );
  const photos = useMemo(
    () =>
      (query.data?.page.items ?? []).filter((item) => item.photo).slice(0, 8),
    [query.data],
  );
  if (photos.length === 0) return null;

  return (
    <div
      /* 窄屏让「接着看」换到下一行：照片才是这一条的内容，
         chip 不该从照片那里抢宽度。宽屏再并到一行。 */
      className="flex w-full min-w-0 items-center gap-2 overflow-x-auto scroll-thin sm:flex-1"
      data-testid="on-this-day-strip"
    >
      <span className="shrink-0 text-meta text-fg-muted">那年今日</span>
      {photos.map((item) => {
        const photo = item.photo;
        const width = onThisDayThumbWidth(photo?.width, photo?.height);
        return (
          <Link
            key={item.id}
            to={albumRoute("photo", item.id)}
            title={`${photo?.date ?? ""} 拍的这张照片`}
            className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          >
            <span
              className="block overflow-hidden rounded-md"
              style={{ height: ON_THIS_DAY_THUMB_HEIGHT, width }}
            >
              <ThumbImage
                fileId={photo?.id ?? ""}
                alt={`${photo?.date ?? ""} 拍的照片`}
                version={photo?.version}
                displayWidth={width}
                className="h-full w-full object-cover"
              />
            </span>
          </Link>
        );
      })}
    </div>
  );
}
