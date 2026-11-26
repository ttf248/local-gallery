import type { MouseEvent } from "react";
import { ThumbImage } from "../common";
import { StarIcon } from "../../ui/icons";

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
   * 照片下方的日期。
   *
   * 「什么时候拍的」是选中一张照片之后最想知道的事；文件名
   * （IMG_20230824_224824.jpg）只是文件系统里的编号，写在照片下面
   * 读起来像一份技术清单。
   */
  date?: (item: T) => string | undefined;
  /** 日期的来源说明：悬停提示照实说，推断出来的日期不是拍摄时间。 */
  dateHint?: (item: T) => string | undefined;
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
  date,
  dateHint,
  ratio,
  selecting = false,
  isSelected,
  onToggleSelect,
  onContextMenu,
}: Props<T>) {
  return (
    <div
      className="flex flex-wrap items-start justify-center gap-8 rounded-xl bg-sunken px-4 py-12"
      data-testid="pick-showcase"
    >
      {items.map((item, index) => {
        const selected = isSelected?.(item.id) ?? false;
        const origin = source?.(item);
        const takenAt = date?.(item);
        const hint = dateHint?.(item);
        const raw = ratio?.(item);
        // 框按照片自己的形状长：多出来的留白会让人以为照片缺了一块。
        const frameRatio = raw && Number.isFinite(raw) && raw > 0 ? raw : 4 / 3;
        // 框的宽由照片的形状与两个上限一起定：
        // 一张竖幅照不该占满一整行的宽度，一张横幅照也不该高过半个屏幕。
        return (
          <figure key={item.id} className="group relative m-0 w-fit max-w-full">
            {/* 框：照片完整地摆在框里，多余的地方留白而不是裁掉。 */}
            <div
              className="relative overflow-hidden rounded-lg bg-media shadow-2"
              style={{
                width: `min(420px, ${560 * frameRatio}px, 76vw)`,
                maxWidth: "100%",
                aspectRatio: String(frameRatio),
              }}
            >
              <ThumbImage
                fileId={item.id}
                alt={name(item)}
                displayWidth={520}
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
                className="absolute inset-0 block h-full w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
              />
              {selected ? (
                <span className="pointer-events-none absolute left-2 top-2 rounded-md bg-primary px-1.5 py-0.5 text-caption text-on-primary">
                  已选
                </span>
              ) : null}
              <button
                type="button"
                onClick={() => onTogglePick(item)}
                aria-label={`把 ${name(item)} 移出精选`}
                title="移出精选"
                className="opacity-100 pointer-fine:opacity-0 absolute right-2 top-2 grid size-10 place-items-center rounded-full bg-raised text-favorite shadow-1 group-hover:opacity-100 group-focus-within:opacity-100"
              >
                <StarIcon size={18} filled />
              </button>
            </div>
            {/* 照片下面写来源与日期。
                文件名（IMG_20230824_224824.jpg）是文件系统里的编号，
                摆在照片下面读起来像一份技术清单：它退到悬停提示里，
                眼睛看到的是「这本相册里的、2024年1月2日的那张」。 */}
            <figcaption className="mt-2 min-w-0">
              <span
                className="block truncate text-label font-semibold text-ink"
                title={
                  hint
                    ? `${origin ?? name(item)} · ${hint}`
                    : (origin ?? name(item))
                }
              >
                {origin ?? name(item)}
              </span>
              {takenAt ? (
                <span className="block truncate text-caption text-ink-2">
                  {takenAt}
                </span>
              ) : null}
            </figcaption>
          </figure>
        );
      })}
    </div>
  );
}
