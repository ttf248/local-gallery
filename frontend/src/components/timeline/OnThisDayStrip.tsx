import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useOnThisDayAlbums } from "../../hooks/useLibrary";
import ThumbImage from "../common/ThumbImage";
import { albumRoute } from "../../utils/path";

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
      className="flex items-center gap-2 overflow-x-auto scroll-thin"
      data-testid="on-this-day-strip"
    >
      <span className="shrink-0 text-meta text-fg-muted">那年今日</span>
      {photos.map((item) => (
        <Link
          key={item.id}
          to={albumRoute("photo", item.id)}
          title={`${item.photo?.date ?? ""} 拍的这张照片`}
          className="shrink-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        >
          <ThumbImage
            fileId={item.photo?.id ?? ""}
            alt={`${item.photo?.date ?? ""} 拍的照片`}
            version={item.photo?.version}
            displayWidth={56}
            className="h-14 w-14 rounded-md object-cover"
          />
        </Link>
      ))}
    </div>
  );
}
