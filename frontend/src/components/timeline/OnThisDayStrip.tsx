import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useOnThisDayAlbums } from "../../hooks/useLibrary";
import ThumbImage from "../common/ThumbImage";
import { ClockIcon } from "../common/Icon";
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
 * 「那年今日」：往年同一天拍过照的那些照片。
 *
 * 它是回忆的**入口**，不是这一页的主线 —— 时间线才是主内容。因此收起
 * 时只是一枚 chip，不占首屏；想看的时候展开，照片带才出现。
 *
 * 展开的那一条摆的是「那天拍的那一张」，不是相册封面：这一条回答的是
 * 「往年这天我拍到了什么」，给一张封面等于什么也没说。缩略图按照片
 * 自己的比例摆，不裁成方块 —— 回忆里缺的那一角往往正是内容本身。
 */
export default function OnThisDayStrip({ enabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
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

  // 展开着的时候点别处就收起：这一条是浮在页面上的，不该挡住别处。
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  if (photos.length === 0) return null;

  return (
    <div
      ref={rootRef}
      className="timeline-memory shrink-0"
      data-testid="on-this-day-strip"
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        title="往年这一天拍过的照片"
        className="ui-btn ui-btn--ghost"
      >
        <ClockIcon size={13} />
        那年今日<span className="hidden sm:inline"> · {photos.length} 张</span>
      </button>
      {open ? (
        /* 窄屏时靠左展开（那一行的 chip 在左边），宽屏靠右（chip 在
           筛选行末尾）。两种对齐都贴着视口内侧，不让面板撑出屏幕。
           面板贴着内容宽：只有两张照片时不必留一块空板。 */
        <div className="timeline-memory__panel ui-popover p-3">
          <div className="flex items-center gap-2 overflow-x-auto scroll-thin">
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
        </div>
      ) : null}
    </div>
  );
}
