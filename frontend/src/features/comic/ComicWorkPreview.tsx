import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useComicMeta } from "../../hooks/useComicMeta";
import { useAlbumMedia } from "../../hooks/useLibrary";
import { comicSourceLabels } from "../../api/comicMeta";
import { decodeFavPath, readerRoute } from "../../utils/path";
import { timeAgo } from "../../utils/date";
import { progressPercent } from "../../utils/progress";
import type { CardData } from "../library";
import { ThumbImage } from "../common";

function EpisodeExcerpt({ id }: { id: string }) {
  const query = useComicMeta(id);
  const excerpt = query.data?.meta.fullSynopsis;
  return excerpt ? <p className="line-clamp-2 text-body">{excerpt}</p> : null;
}

interface Props {
  data: CardData;
  anchorRect: DOMRect;
  lastSeenAt?: string | null;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  onDismiss?: () => void;
  onEdit?: () => void;
}
export default function ComicWorkPreview({
  data,
  anchorRect: r,
  lastSeenAt,
  onPointerEnter,
  onPointerLeave,
  onDismiss,
  onEdit,
}: Props) {
  const box = useRef<HTMLDivElement>(null),
    [pos, setPos] = useState({ left: 12, top: 12 }),
    [closed, close] = useState(false);
  const album = data.variant === "album",
    meta = data.comic;
  const media = useAlbumMedia(album ? decodeFavPath(data.to) : "");
  const images =
    media.data?.pages[0]?.items.filter((v) => v.kind === "image").slice(0, 3) ??
    [];
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const place = () => {
      const w = Math.min(340, window.innerWidth - 24),
        h = el.offsetHeight;
      setPos({
        left: Math.max(
          12,
          Math.min(
            window.innerWidth - w - 12,
            r.right + w + 24 <= window.innerWidth
              ? r.right + 12
              : r.left - w - 12,
          ),
        ),
        top: Math.max(
          12,
          Math.min(window.innerHeight - h - 12, r.top + (r.height - h) / 2),
        ),
      });
    };
    const dismiss = () => {
      close(true);
      onDismiss?.();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") dismiss();
    };
    const scroll = (e: Event) => {
      if (!(e.target instanceof Node && el.contains(e.target))) dismiss();
    };
    place();
    const observer =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(place);
    observer?.observe(el);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("keydown", key);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("keydown", key);
    };
  }, [r, onDismiss]);
  if (closed) return null;
  return createPortal(
    <div
      ref={box}
      role="dialog"
      aria-label={`预览 ${data.title}`}
      style={{ ...pos, width: 340 }}
      onMouseEnter={onPointerEnter}
      onMouseLeave={onPointerLeave}
      className="comic-preview fixed max-h-[calc(100dvh-24px)] max-w-[calc(100vw-24px)] space-y-3 overflow-auto rounded-lg border border-line bg-raised p-4 text-ink shadow-3"
    >
      <div className="flex gap-3">
        {!album && (
          <ThumbImage
            fileId={data.coverPath}
            version={data.coverVersion}
            alt=""
            className="book-binding--series aspect-[2/3] w-20 shrink-0 self-start object-cover"
          />
        )}
        <div className="min-w-0 space-y-1">
          {album && data.parentName && (
            <p className="truncate text-caption text-ink-2">
              {data.parentName}
            </p>
          )}
          <h3 className="font-display text-heading">
            {meta?.chapterLabel && meta.chapterLabel !== data.title
              ? meta.chapterLabel + " · "
              : ""}
            {data.title}
          </h3>
          {meta?.author && <p>作者：{meta.author}</p>}
          <p className="text-caption text-ink-2">
            {!album && (
              <>
                <span>{data.count} 卷</span> ·{" "}
              </>
            )}
            {data.imageCount ?? 0} 页
          </p>
          {meta?.genres?.length ? (
            <p className="text-caption">{meta.genres.join(" · ")}</p>
          ) : null}
          {meta?.locked && <span>已锁定</span>}
        </div>
      </div>
      {album ? (
        <>
          {images.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {images.map((v) => (
                <ThumbImage
                  key={v.id}
                  fileId={v.id}
                  version={v.version}
                  alt={v.name}
                  className="aspect-[2/3] w-full rounded-sm object-cover"
                />
              ))}
            </div>
          )}
          {data.progress && (
            <p>
              阅读进度{" "}
              <progress max={100} value={progressPercent(data.progress) ?? 0} />
            </p>
          )}
          {lastSeenAt !== undefined && (
            <p>{lastSeenAt ? `上次阅读 ${timeAgo(lastSeenAt)}` : "尚未阅读"}</p>
          )}
        </>
      ) : null}
      {album && !meta?.synopsis && meta?.hasFullSynopsis && (
        <EpisodeExcerpt id={decodeFavPath(data.to)} />
      )}
      {meta?.synopsis ? (
        <section>
          <h4>故事大纲</h4>
          <p className={album ? "line-clamp-2" : "line-clamp-5"}>
            {meta.synopsis}
          </p>
          <small>{comicSourceLabels[meta.metaSource]}</small>
        </section>
      ) : (
        !album && (
          <p className="text-body text-ink-2">
            暂无故事大纲
            {meta?.mainCount ? " · 正篇 " + meta.mainCount + " 话" : ""}
            {meta?.extraCount ? " · 番外 " + meta.extraCount + " 话" : ""}
            {meta?.firstEpisodeLabel && " · 首篇：" + meta.firstEpisodeLabel}
          </p>
        )
      )}
      <div className="flex flex-wrap gap-3 text-primary">
        {data.resumeId && (
          <a href={readerRoute(data.resumeId)}>继续读 · {data.resumeLabel}</a>
        )}
        <a href={data.linkTo ?? data.to}>{album ? "阅读本话" : "查看详情"}</a>
        {!album && onEdit && (
          <button onClick={onEdit}>
            {meta?.synopsis ? "编辑简介" : "添加简介"}
          </button>
        )}
      </div>
    </div>,
    document.body,
  );
}
