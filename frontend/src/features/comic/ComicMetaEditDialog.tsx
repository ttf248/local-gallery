import { useState } from "react";
import { Dialog } from "../../ui/Dialog";
import { buttonStyles } from "../../ui/buttonStyles";
import {
  useComicMeta,
  useUpdateComicMeta,
  useResetComicMeta,
  useSetCollectionCover,
  useClearCollectionCover,
} from "../../hooks/useComicMeta";
import type { ComicMetaDetail, ComicSeriesStatus } from "../../api/comicMeta";
import { ThumbImage } from "../common";

const coverReasons: Record<string, string> = {
  manual: "人工指定", filename_cover: "目录封面", aesthetic_poster: "彩绘高分", dedup_scene: "跨话去重", fallback_first: "规则推荐",
};

export default function ComicMetaEditDialog({
  id,
  onClose,
  cover = false,
}: {
  id: string;
  onClose: () => void;
  cover?: boolean;
}) {
  const query = useComicMeta(id);
  return (
    <Dialog
      open
      onClose={onClose}
      title={cover ? "更换总封面" : "编辑作品信息"}
    >
      {query.data ? (
        <Editor
          key={id}
          meta={query.data.meta}
          cover={cover}
          onClose={onClose}
        />
      ) : (
        <p role="status">
          {query.isError ? "无法读取作品信息" : "正在读取作品信息…"}
        </p>
      )}
    </Dialog>
  );
}
function Editor({
  meta,
  cover,
  onClose,
}: {
  meta: ComicMetaDetail;
  cover: boolean;
  onClose: () => void;
}) {
  const [title, setTitle] = useState(meta.cleanTitle),
    [author, setAuthor] = useState(meta.author ?? ""),
    [tags, setTags] = useState(meta.genres ?? []),
    [entry, setEntry] = useState("");
  const [synopsis, setSynopsis] = useState(meta.fullSynopsis ?? ""),
    [status, setStatus] = useState<ComicSeriesStatus>(meta.status ?? "unknown"),
    [locked, setLocked] = useState(meta.locked ?? false);
  const [tab, setTab] = useState(cover ? "封面" : "基本与大纲"),
    [error, setError] = useState("");
  const update = useUpdateComicMeta(meta.nodeId),
    reset = useResetComicMeta(meta.nodeId),
    pick = useSetCollectionCover(meta.nodeId),
    clear = useClearCollectionCover(meta.nodeId);
  const busy =
    update.isPending || reset.isPending || pick.isPending || clear.isPending;
  const field =
    "block mt-1 w-full rounded-md border border-line bg-canvas px-3 py-2 text-ink";
  const tagValues = () =>
    Array.from(
      new Set([
        ...tags,
        ...entry
          .split(/[,，、]/)
          .map((t) => t.trim())
          .filter(Boolean),
      ]),
    );
  const run = async (fn: () => Promise<unknown>, close = true) => {
    setError("");
    try {
      await fn();
      if (close) onClose();
    } catch {
      setError("保存失败，请检查内容后重试。");
    }
  };
  return (
    <div className="space-y-4">
      {meta.kind === "collection" && (
        <div className="flex gap-2">
          {["基本与大纲", "封面"].map((t) => (
            <button
              key={t}
              aria-pressed={t === tab}
              className={buttonStyles({
                variant: t === tab ? "secondary" : "ghost",
              })}
              onClick={() => setTab(t)}
            >
              {t}
            </button>
          ))}
        </div>
      )}
      {tab === "封面" ? (
        <section className="space-y-3">
          <h3>作品总封面</h3>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {meta.coverCandidates.map((p, i) => (
              <button
                key={p.id}
                aria-label={i === 0 ? "当前封面" : `候选封面 ${i + 1}`}
                disabled={busy}
                className="space-y-1 rounded-md text-caption focus-visible:ring-2"
                onClick={() => void run(() => pick.mutateAsync(p.id))}
              >
                <ThumbImage
                  fileId={p.id}
                  version={p.version}
                  alt=""
                  className="aspect-[2/3] w-full rounded-sm object-cover"
                />
                {i === 0 ? "当前封面" : `候选封面 ${i + 1}`}
                {i === 0 && meta.coverReason && <span className="block text-ink-2">{coverReasons[meta.coverReason]}</span>}
              </button>
            ))}
          </div>
          <p className="text-caption text-ink-2">
            从任意卷中挑选时，请在阅读器的页面菜单中选择「设为所属作品总封面」。
          </p>
          <button
            disabled={busy || !meta.hasCustomCover}
            className={buttonStyles({ variant: "secondary" })}
            onClick={() => void run(() => clear.mutateAsync(undefined))}
          >
            恢复智能推荐
          </button>
        </section>
      ) : (
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const genres = tagValues();
            if (
              !title.trim() ||
              Array.from(title).length > 120 ||
              Array.from(synopsis).length > 2000 ||
              genres.length > 8 ||
              genres.some((v) => Array.from(v).length > 24)
            ) {
              setError("请填写书名。标签最多 8 个，每个最多 24 字。");
              return;
            }
            void run(() =>
              update.mutateAsync({
                title:
                  title.trim() === meta.cleanTitle ? undefined : title.trim(),
                author: author === (meta.author ?? "") ? undefined : author,
                genres:
                  JSON.stringify(genres) === JSON.stringify(meta.genres ?? [])
                    ? undefined
                    : genres,
                status:
                  status === (meta.status ?? "unknown") ? undefined : status,
                synopsis:
                  synopsis === (meta.fullSynopsis ?? "") ? undefined : synopsis,
                locked: locked === (meta.locked ?? false) ? undefined : locked,
              }),
            );
          }}
        >
          <label className="block">
            规范书名
            <input
              required
              maxLength={120}
              className={field}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <p className="text-caption text-ink-2">
            原目录：{meta.originalName ?? meta.cleanTitle}
          </p>
          <label className="block">
            作者
            <input
              maxLength={80}
              className={field}
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </label>
          <label className="block">
            题材标签
            <input
              className={field}
              value={entry}
              placeholder="输入后按回车或逗号添加"
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === "，") {
                  e.preventDefault();
                  setTags(tagValues());
                  setEntry("");
                }
              }}
            />
          </label>
          <div className="flex flex-wrap gap-2">
            {tags.map((t) => (
              <button
                type="button"
                key={t}
                aria-label={`移除标签 ${t}`}
                onClick={() => setTags(tags.filter((v) => v !== t))}
              >
                {t} ×
              </button>
            ))}
          </div>
          <label className="block">
            连载状态
            <select
              className={field}
              value={status}
              onChange={(e) => setStatus(e.target.value as ComicSeriesStatus)}
            >
              {Object.entries({
                unknown: "未知",
                ongoing: "连载中",
                completed: "已完结",
                hiatus: "休刊",
              }).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            故事大纲
            <textarea
              className={field}
              rows={4}
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
            />
          </label>
          <p className="text-right text-caption">
            {Array.from(synopsis).length} / 2000
          </p>
          <label className="flex gap-2">
            <input
              type="checkbox"
              checked={locked}
              onChange={(e) => setLocked(e.target.checked)}
            />
            锁定人工修改
          </label>
          <div className="flex justify-between">
            <button
              type="button"
              disabled={busy}
              className={buttonStyles({ variant: "secondary" })}
              onClick={() => void run(() => reset.mutateAsync(undefined))}
            >
              恢复默认
            </button>
            <button
              disabled={busy}
              className={buttonStyles({ variant: "primary" })}
            >
              保存
            </button>
          </div>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
