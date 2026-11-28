import { useState, useLayoutEffect, useRef } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Menu } from "../../ui/Menu";
import { Button } from "../../ui/Button";
import { ChevronLeftIcon } from "../../ui/icons";
import { useUIStore } from "../../store/uiStore";
import {activityApi} from "../../api/activity";
import {useConfirm} from "../common/ConfirmDialog";
import { fsApi } from "../../api/fs";
import type { LibraryNodeSummary } from "../../api/library";
import { comicSourceLabels } from "../../api/comicMeta";
import {
  useComicEpisodeType,
  useComicMeta,
  useRefreshComicMeta,
} from "../../hooks/useComicMeta";
import { useFavorites } from "../../hooks/useFavorites";
import { useLibraryDashboard, useMultiRoot } from "../../hooks/useLibrary";
import { buttonStyles } from "../../ui/buttonStyles";
import { readerRoute } from "../../utils/path";
import { ThumbImage } from "../common";
import ComicMetaEditDialog from "./ComicMetaEditDialog";

export function ComicEpisodeFilter({ node }: { node: LibraryNodeSummary }) {
  const [params, set] = useSearchParams();
  const ep = useComicEpisodeType();
  const m = node.comic;
  if (!m?.mainCount || !m.extraCount) return null;
  return (
    <div aria-label="章节类型" className="flex flex-wrap gap-2">
      {(
        [
          ["all", "全部", node.albumCount],
          ["main", "正篇", m.mainCount],
          ["extra", "番外", m.extraCount],
        ] as const
      ).map(([key, title, count]) => (
        <button
          key={key}
          aria-pressed={key === ep}
          className={buttonStyles({
            variant: key === ep ? "secondary" : "ghost",
          })}
          onClick={() => {
            const next = new URLSearchParams(params);
            if (key === "all") next.delete("ep");
            else next.set("ep", key);
            set(next);
          }}
        >
          {title} {count}
        </button>
      ))}
    </div>
  );
}

export default function ComicWorkHeader({
  node,
}: {
  node: LibraryNodeSummary;
}) {
  const detail = useComicMeta(node.id);
  const refresh = useRefreshComicMeta(node.id);
  const fav = useFavorites();
  const multi = useMultiRoot("comic");
  const dash = useLibraryDashboard();
  const [editing, setEditing] = useState<"info" | "cover" | null>(null),
    [expanded, setExpanded] = useState(false);
  const confirm=useConfirm();
  const toast = useUIStore(s => s.pushToast);
  const m = detail.data?.meta ?? node.comic;
  const title = m?.cleanTitle ?? node.displayName;
  const syn = detail.data?.meta.fullSynopsis ?? m?.synopsis;
  const paragraph = useRef<HTMLParagraphElement>(null);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = paragraph.current;
    if (!el || expanded) return;
    const measure = () =>
      setOverflows(
        el.scrollHeight > el.clientHeight + 1 ||
          (!el.clientHeight &&
            Boolean(syn && (syn.length > 110 || syn.split("\n").length > 3))),
      );
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [syn, expanded]);
  const source = m?.metaSource ?? "rule";
  const resume = dash.data?.dashboard.inProgress
    .filter((p) => p.album.parentId === node.id)
    .sort((a, b) => b.updated.localeCompare(a.updated))[0];
  const first = detail.data?.meta.firstEpisodeId;
  const target = resume?.album.id ?? first;
  const identify = () =>
    refresh.mutate(undefined, {
      onSuccess: (r) => toast({kind:"info", message:r?.warning ?? "作品信息已更新"}),
      onError: () => toast({kind:"error",message:"识别失败，请重试。"}),
    });
  return (
    <section className="comic-work-header flex flex-col gap-4 py-5 md:flex-row md:gap-6">
      <div className="group relative w-[104px] shrink-0 self-start md:w-[148px]">
        <ThumbImage
          fileId={node.coverImage ?? ""}
          version={node.coverImageVersion}
          alt={title + " 总封面"}
          className="book-binding--series aspect-[2/3] w-full rounded-xl object-cover shadow-1"
        />
        <button
          className="absolute inset-x-0 bottom-0 rounded-b-xl bg-gradient-to-t from-theater-bg to-transparent px-2 py-2 text-caption text-theater-fg pointer-fine:opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          onClick={() => setEditing("cover")}
        >
          更换封面
        </button>
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <nav className="text-caption text-ink-2">
          <Link className="inline-flex min-h-10 items-center gap-1" to="/comic/library"><ChevronLeftIcon size={16} />书架</Link> /{" "}
          {multi && node.sourceName ? node.sourceName + " / " : ""}
          {title}
        </nav>
        <h1 className="font-display text-title font-semibold">{title}</h1>
        {m?.originalName && (
          <p className="text-caption text-ink-3">原目录：{m.originalName}</p>
        )}
        <p className="text-body text-ink-2">
          {m?.author && "作者：" + m.author + " · "}
          {node.albumCount ?? 0} 卷 ·{" "}
          {(node.imageCount ?? 0).toLocaleString("zh-CN")} 页
          {m?.mainCount ? " · 正篇 " + m.mainCount + " 话" : ""}
          {m?.extraCount ? " · 番外 " + m.extraCount + " 话" : ""}
        </p>
        {m?.genres?.length ? (
          <div className="flex flex-wrap gap-2">
            {m.genres.slice(0, 6).map((g) => (
              <span
                className="rounded-sm bg-sunken px-2 py-0.5 text-caption text-ink-2"
                key={g}
              >
                {g}
              </span>
            ))}
          </div>
        ) : null}
        {syn ? (
          <>
            <p
              ref={paragraph}
              className={`whitespace-pre-line leading-relaxed text-ink-2 ${expanded ? "" : "line-clamp-3"}`}
            >
              {syn}
            </p>
            {(expanded || overflows) && (
              <Button size="sm" variant="ghost"
                aria-expanded={expanded}
                onClick={() => setExpanded(!expanded)}
              >
                {expanded ? "收起" : "展开全文"}
              </Button>
            )}
            <p className="text-caption text-ink-3">
              简介来源：
              {detail.data?.meta.provider || comicSourceLabels[source]}
            </p>
          </>
        ) : (
          <p className="text-ink-2">
            暂无故事大纲{" "}
            <Button variant="ghost" size="sm" disabled={refresh.isPending} onClick={identify}>
              智能识别
            </Button>{" "}
            <Button variant="ghost" size="sm" onClick={() => setEditing("info")}>手动添加</Button>
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {target && (
            <Link
              className={buttonStyles({ variant: "primary" })}
              to={readerRoute(target)}
            >
              {resume
                ? "继续阅读 · " +
                  (resume.album.comic?.chapterLabel ?? resume.album.displayName)
                : "开始阅读 · " +
                  (detail.data?.meta.firstEpisodeLabel ?? "第 1 话")}
            </Link>
          )}
          <button
            className={buttonStyles({ variant: "secondary" })}
            aria-pressed={fav.favorites.includes(node.id)}
            onClick={() =>
              void fav.toggle(node.id).catch(() => toast({kind:"error",message:"收藏操作失败"}))
            }
          >
            {fav.favorites.includes(node.id) ? "取消收藏" : "收藏"}
          </button>
          <button
            className={buttonStyles({ variant: "secondary" })}
            onClick={() => setEditing("info")}
          >
            编辑信息
          </button>
          <Menu label="更多" trigger={<Button variant="ghost">更多</Button>} items={[
            {id:"refresh",label:"重新识别内容",disabled:refresh.isPending,onSelect:identify},
            {id:"cover",label:"更换总封面",onSelect:()=>setEditing("cover")},
            {id:"resetReading",label:"重置整部阅读进度",onSelect:()=>void (async()=>{if(!await confirm({title:"重置整部阅读进度？",description:"所有章节将恢复为未读。",confirmLabel:"重置"}))return;try{const r=await activityApi.markWorkRead(node.id,"reset");toast({kind:"success",message:`已重置 ${r.updatedCount} 话阅读进度`})}catch{toast({kind:"error",message:"重置阅读进度失败"})}})()},
            {id:"folder",label:"在文件管理器中打开",onSelect:()=>void fsApi.openInExplorer(node.id).catch(()=>toast({kind:"error",message:"无法在文件管理器中打开"}))}
          ]}/>
        </div>
      </div>
      {editing && (
        <ComicMetaEditDialog
          id={node.id}
          cover={editing === "cover"}
          onClose={() => setEditing(null)}
        />
      )}
    </section>
  );
}
