import { useElementSize } from "../../hooks/useElementSize";
import type { LibraryMediaItem } from "../../api/library";
import { ThumbImage } from "../common";
import { PlayFilledIcon } from "../../ui/icons";
export function Filmstrip({
  items,
  index,
  onChange,
}: {
  items: readonly LibraryMediaItem[];
  index: number;
  onChange: (index: number) => void;
}) {
  const { ref, width } = useElementSize<HTMLElement>();
  // 两侧各留 12px，缩略图间距 6px。窄屏减少渲染数量，保留触摸目标。
  const count = width
    ? Math.max(1, Math.min(9, Math.floor((width - 18) / 46)))
    : 5;
  const start = Math.max(
    0,
    Math.min(index - Math.floor(count / 2), items.length - count),
  );
  return (
    <nav
      ref={ref}
      aria-label="胶片条"
      className="flex h-[72px] shrink-0 items-center justify-center gap-1.5 overflow-hidden px-3"
    >
      {items.slice(start, start + count).map((item, i) => (
        <button
          type="button"
          key={item.id}
          aria-label={"跳到第 " + (start + i + 1) + " 张"}
          aria-current={start + i === index || undefined}
          className="relative h-12 min-w-10 max-w-20 flex-1 overflow-hidden rounded-tile bg-overlay-panel opacity-65 transition-transform aria-current:z-10 motion-safe:aria-current:scale-110 aria-current:opacity-100 aria-current:ring-2 aria-current:ring-white"
          onClick={() => onChange(start + i)}
        >
          {item.kind === "video" ? (
            <PlayFilledIcon className="mx-auto" size={16} />
          ) : (
            <ThumbImage
              fileId={item.id}
              alt=""
              version={item.version}
              undecodable={item.undecodable}
              displayWidth={80}
              className="h-full w-full object-cover"
            />
          )}
        </button>
      ))}
    </nav>
  );
}
