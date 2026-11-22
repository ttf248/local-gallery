import type { MouseEvent } from "react";
import ThumbImage from "../common/ThumbImage";
import { UncheckIcon } from "../common/Icon";

interface Props<T> {
  /** 摆出来的精选照片。 */
  items: T[];
  /** 打开第几张。 */
  onOpen: (index: number) => void;
  /** 切换精选状态（精选页里就是移出精选）。 */
  onTogglePick: (item: T) => void;
  /** 照片的展示名：图片的替代文本。 */
  name: (item: T) => string;
  /** 照片的出处：它出自哪本相册。 */
  source?: (item: T) => string | undefined;
  /**
   * 照片的宽高比（宽 ÷ 高）。
   *
   * 框按照片自己的形状长：多出来的留白会让人以为照片缺了一块。
   */
  ratio?: (item: T) => number | undefined;
  /** 多选模式：点照片改为勾选。 */
  selecting?: boolean;
  isSelected?: (id: string) => boolean;
  onToggleSelect?: (item: T) => void;
  onContextMenu?: (item: T, event: MouseEvent<HTMLButtonElement>) => void;
}

/**
 * 框的宽高比上下限。
 *
 * 只收极端值：一张几万像素宽的横幅不该把框拉成一条缝。
 * 中间的比例原样保留 —— 照片是什么形状，框就是什么形状。
 */
const MIN_FRAME_RATIO = 0.25;
const MAX_FRAME_RATIO = 4;

/**
 * 框的最高高度。
 *
 * 照片摆出来是为了好好看的，但摆得太高就要滚动才看得见它的名字与出处。
 * 框到这个高度就停，宽高比随之让步：照片仍然完整地摆在框里（留白，不裁）。
 */
const FRAME_MAX_HEIGHT = 560;

/** 框的最宽：再宽就成了墙，不是陈列。 */
const FRAME_MAX_WIDTH = 420;

/**
 * 少量精选的陈列。
 *
 * 照片墙是给「很多张」用的：密排、裁切、按固定行高铺满。挑出来的三五张
 * 用它排会得到一个刺眼的角落 —— 两张小图挤在左边，右边空着一大片，
 * 而且竖幅被裁掉了半张脸。用户挑出来的照片是拿来好好看的，不是拿来数
 * 的。
 *
 * 所以数量少的时候换一种摆法：每张给一个自己的框，完整地摆出来
 * （不裁、不拉伸），几个框并排摆开、整体居中。
 */
export default function PickShowcase<T extends { id: string }>({
  items,
  onOpen,
  onTogglePick,
  name,
  source,
  ratio,
  selecting = false,
  isSelected,
  onToggleSelect,
  onContextMenu,
}: Props<T>) {
  return (
    <div
      className="flex flex-wrap items-start justify-center gap-5 pb-4"
      data-testid="pick-showcase"
    >
      {items.map((item, index) => {
        const selected = isSelected?.(item.id) ?? false;
        const origin = source?.(item);
        const raw = ratio?.(item);
        // 框按照片自己的形状长：多出来的留白会让人以为照片缺了一块。
        const frameRatio =
          raw && Number.isFinite(raw) && raw > 0
            ? Math.min(Math.max(raw, MIN_FRAME_RATIO), MAX_FRAME_RATIO)
            : 4 / 3;
        // 框的宽由照片的形状与两个上限一起定：
        // 一张竖幅照不该占满一整行的宽度，一张横幅照也不该高过半个屏幕。
        const frameWidth = Math.min(
          FRAME_MAX_WIDTH,
          Math.round(FRAME_MAX_HEIGHT * frameRatio),
        );
        return (
          <figure
            key={item.id}
            className="group relative m-0 w-fit max-w-full"
          >
            {/* 框：照片完整地摆在框里，多余的地方留白而不是裁掉。 */}
            <div
              className="relative overflow-hidden rounded-lg bg-bg-subtle"
              style={{
                width: `${frameWidth}px`,
                maxWidth: "100%",
                aspectRatio: String(frameRatio),
              }}
            >
              <ThumbImage
                fileId={item.id}
                alt={name(item)}
                displayWidth={420}
                className="h-full w-full object-contain"
              />
              <button
                type="button"
                onClick={() =>
                  selecting && onToggleSelect
                    ? onToggleSelect(item)
                    : onOpen(index)
                }
                onContextMenu={(event) => onContextMenu?.(item, event)}
                aria-label={
                  selecting && onToggleSelect
                    ? `选择「${name(item)}」`
                    : `查看 ${name(item)}`
                }
                className="absolute inset-0 block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
              />
              {selected ? (
                <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-accent px-1.5 py-0.5 text-meta text-accent-contrast">
                  已选
                </span>
              ) : null}
              {/* 精选角标常驻：这一页摆的每张都在精选里，
                  角标是「它为什么在这儿」的说明，也是移出精选的入口。 */}
              <button
                type="button"
                onClick={() => onTogglePick(item)}
                aria-label={`把 ${name(item)} 移出精选`}
                title="移出精选"
                className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-full bg-black/65 text-white/90 ring-1 ring-white/25 backdrop-blur transition-colors hover:bg-black/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
              >
                <UncheckIcon size={13} />
              </button>
            </div>
            <figcaption className="mt-2 min-w-0">
              <span
                className="block truncate text-body text-fg"
                title={name(item)}
              >
                {name(item)}
              </span>
              {origin ? (
                <span
                  className="block truncate text-meta text-fg-muted"
                  title={origin}
                >
                  {origin}
                </span>
              ) : null}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
