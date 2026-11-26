import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CloseIcon } from "../../ui/icons";

interface Props {
  chromeVisible: boolean;
  onClose: () => void;
  albumHref?: string;
  albumName: string;
  date?: string;
  multiple: boolean;
  index: number;
  total: number;
  children: ReactNode;
}

export function ViewerChrome({
  chromeVisible,
  onClose,
  albumHref,
  albumName,
  date,
  multiple,
  index,
  total,
  children,
}: Props) {
  return (
    <>
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/80 to-transparent"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/70 to-transparent"
      />
      {/* 顶栏：返回、标题、位置与操作 */}
      <header
        className={
          "relative z-10 flex h-16 shrink-0 items-center gap-2 bg-gradient-to-b from-black/60 to-transparent px-2 transition-opacity focus-within:opacity-100 sm:px-5 " +
          (chromeVisible ? "" : "opacity-0")
        }
      >
        <button
          type="button"
          onClick={onClose}
          className="inline-flex h-9 w-9 items-center justify-center rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
          title="关闭 (Esc)"
          aria-label="关闭大图预览"
        >
          <CloseIcon size={16} />
        </button>
        <div className="min-w-0 flex-1">
          {/* 相册名用衬线：与照片工作台的标题同一套字体，
              大图预览也是这个工作台的一部分。
              精选页的照片来自不同相册，标题给出去处，并可点回那本。 */}
          {albumHref ? (
            <Link
              to={albumHref}
              title={`回到相册「${albumName}」`}
              className="flex min-h-8 min-w-8 items-center touch:min-h-10 touch:min-w-10 font-display text-body font-semibold text-white/95 underline decoration-white/30 underline-offset-4 transition-colors hover:decoration-white/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            >
              <span className="truncate">{albumName}</span>
            </Link>
          ) : (
            <div className="truncate font-display text-body font-semibold text-white/95">
              {albumName}
            </div>
          )}
          {/* 位置读数只在能翻的时候出现：一张照片时说「第 1 张 ·
              共 1 张」是废话，界面上只留相册名。 */}
          <div className="flex min-w-0 items-center gap-2 overflow-hidden whitespace-nowrap text-caption tabular-nums text-white/75">
            {date && <span className="truncate">{date}</span>}
            {multiple && (
              <span className="truncate">
                第 {index + 1} 张 · 共 {total} 张
              </span>
            )}
          </div>
        </div>
        {children}
      </header>
    </>
  );
}
