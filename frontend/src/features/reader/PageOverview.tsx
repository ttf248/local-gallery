import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ModalSurface } from "../../ui/ModalSurface";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { RenditionImage } from "../common";
import { CloseIcon, SinglePageIcon } from "../../ui/icons";
import { useMediaQuery } from "../../hooks/useMediaQuery";

export interface PageOverviewProps {
  tabs?: React.ReactNode;
  chapterList?: React.ReactNode;
  onShortcut?: (key: string) => boolean;
  /** 相册内的图片文件 ID（顺序与页码一致）。 */
  images: string[];
  /** 当前页（0 基）。 */
  index: number;
  /** 跳到指定页。 */
  onJump: (index: number) => void;
  onClose: () => void;
}

const COLUMNS = {
  narrow: 3,
  medium: 5,
  wide: 7,
  huge: 9,
};

/**
 * 漫画目录：整本缩略图网格，点一下直接跳到那一页。
 *
 * 长篇漫画动辄几百页，底部进度条只能拖着刮擦，找不到具体某一页；
 * 目录提供「按页定位」的入口。它是按需打开的浮层，不打断连续阅读。
 */
export default function PageOverview({
  images,
  index,
  onJump,
  onClose,
  tabs,
  chapterList,
  onShortcut,
}: PageOverviewProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const small = useMediaQuery("(min-width: 640px)");
  const medium = useMediaQuery("(min-width: 1024px)");
  const wide = useMediaQuery("(min-width: 1440px)");
  // 档位按断点从宽到窄判断。原先 `small` 排在 `medium` 前面，
  // 于是 1024px 以上永远命中 small 那一档：640–1439px 都是 7 列，
  // 1024 的屏上每列只剩一百四十几像素，页缩略图挤成一条。
  const columns = tabs
    ? 3
    : wide
      ? COLUMNS.huge
      : medium
        ? COLUMNS.wide
        : small
          ? COLUMNS.medium
          : COLUMNS.narrow;

  // 取不到缩略图的页：留住一个空壳，记下来改画页形记号。
  const [failed, setFailed] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const markFailed = useCallback((id: string) => {
    setFailed((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }, []);

  const rows = useMemo(() => {
    const list: { key: string; items: { id: string; index: number }[] }[] = [];
    for (let start = 0; start < images.length; start += columns) {
      const items = images.slice(start, start + columns).map((id, offset) => ({
        id,
        index: start + offset,
      }));
      list.push({ key: `overview-${start}`, items });
    }
    return list;
  }, [images, columns]);

  // 换了一本册子，上一本的失败记录就不再作数。
  useEffect(() => {
    setFailed(new Set<string>());
  }, [images]);

  return (
    <ModalSurface
      open
      onClose={onClose}
      onKeyDown={(event) => {
        if ((event.target as HTMLElement).matches("input,textarea,select"))
          return;
        if (onShortcut?.(event.key.toLowerCase())) {
          event.preventDefault();
          return;
        }
        if (event.key.toLowerCase() === "t") {
          event.preventDefault();
          onClose();
          return;
        }
        if (chapterList) return;
        const changes: Record<string, number> = {
          ArrowRight: 1,
          ArrowLeft: -1,
          ArrowDown: columns,
          ArrowUp: -columns,
        };
        if (!(event.key in changes)) return;
        const active =
          event.target instanceof HTMLElement
            ? event.target.closest<HTMLElement>("[data-overview-index]")
            : null;
        const target = Math.max(
          0,
          Math.min(
            images.length - 1,
            Number(active?.dataset.overviewIndex ?? index) + changes[event.key],
          ),
        );
        event.preventDefault();
        virtuoso.current?.scrollIntoView({
          index: Math.floor(target / columns),
          done: () =>
            dialog.current
              ?.querySelector<HTMLElement>(`[data-overview-index="${target}"]`)
              ?.focus(),
        });
      }}
      ref={dialog}
      data-testid="page-overview"
      aria-label="目录"
      className={
        tabs
          ? "reader-drawer fixed m-0 flex max-h-none flex-col border border-line bg-raised p-0 text-ink shadow-3"
          : "fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-theater-bg p-0 text-theater-fg backdrop:bg-transparent"
      }
    >
      <header className="flex h-14 shrink-0 items-center gap-3 px-5 border-b border-white/10">
        {tabs ?? <h2 className="text-body font-medium text-white/90">目录</h2>}
        <span className="text-caption tabular-nums text-white/50">
          {!tabs && `共 ${images.length} 页`}
        </span>
        {/* 快捷键提示放在关闭键旁边：目录是按需打开的浮层，
            用完立刻关掉是常态，怎么关得写在眼前。 */}
        <span className="ml-auto sr-only">T / Esc 关闭</span>
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-current transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          title="关闭目录 (T / Esc)"
          aria-label="关闭目录"
        >
          <CloseIcon size={15} />
        </button>
      </header>

      {chapterList ?? (
        <div className="min-h-0 flex-1 px-5 pb-5 pt-4">
          <Virtuoso
            ref={virtuoso}
            initialTopMostItemIndex={Math.floor(index / columns)}
            data={rows}
            style={{ height: "100%" }}
            overscan={400}
            increaseViewportBy={{ top: 400, bottom: 400 }}
            computeItemKey={(_index, row) => row.key}
            itemContent={(_index, row) => (
              <div
                className="grid gap-2 pb-2"
                style={{
                  gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
                }}
              >
                {row.items.map((item) => (
                  <button
                    data-overview-index={item.index}
                    key={item.id}
                    type="button"
                    onClick={() => onJump(item.index)}
                    className={`group relative aspect-[3/4] overflow-hidden rounded border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 ${
                      item.index === index
                        ? "border-white/90 ring-1 ring-white/30"
                        : "border-white/10 hover:border-white/40"
                    }`}
                    title={`第 ${item.index + 1} 页`}
                    aria-label={`跳到第 ${item.index + 1} 页`}
                    aria-current={item.index === index ? "true" : undefined}
                  >
                    {/* 缩略图取不到时（解码失败、格式不支持）留一块底色和
                      页形记号 —— 空着的黑格子看着像页面没加载出来。 */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-0 grid place-items-center bg-white/[0.06] text-white/25"
                    >
                      <SinglePageIcon size={18} />
                    </span>
                    {!failed.has(item.id) && (
                      <RenditionImage
                        fileId={item.id}
                        alt=""
                        displayWidth={96}
                        loading="lazy"
                        className="relative h-full w-full object-cover"
                        onError={() => markFailed(item.id)}
                      />
                    )}
                    {/* 当前页的页码反过来印（白底深字）：一屏几十张缩略图
                      里，只有这一张要能一眼认出来。 */}
                    <span
                      className={`absolute bottom-1 right-1 rounded px-1.5 py-0.5 text-caption tabular-nums ${
                        item.index === index
                          ? "bg-white text-black"
                          : "bg-black/65 text-white/90"
                      }`}
                    >
                      {item.index + 1}
                    </span>
                  </button>
                ))}
              </div>
            )}
          />
        </div>
      )}
    </ModalSurface>
  );
}
