import { useState } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { libraryApi, type UnreadWorkGroup } from "../../api/library";
import { libraryQueryKeys } from "../../api/queryKeys";
import { activityApi } from "../../api/activity";
import { Page } from "../../shell/Page";
import { PageHero } from "../../shell/PageHero";
import { Menu } from "../../ui/Menu";
import { Button } from "../../ui/Button";
import { buttonStyles } from "../../ui/buttonStyles";
import { readerRoute } from "../../utils/path";
import { useUIStore } from "../../store/uiStore";
import { ThumbImage } from "../common";

export function UnreadWorks({
  q,
  setQuery,
  openVolumes,
}: {
  q: string;
  setQuery: (q: string) => void;
  openVolumes: (id: string) => void;
}) {
  const client = useQueryClient(),
    toast = useUIStore((s) => s.pushToast);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const key = [...libraryQueryKeys.unreadAlbums("comic"), "works", q];
  const feed = useInfiniteQuery({
    queryKey: key,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      libraryApi.unreadWorkPage(q, pageParam, signal),
    getNextPageParam: (last) => last.page.nextCursor,
  });
  async function mark(g: UnreadWorkGroup) {
    const id = g.work.id;
    setPending((old) => new Set(old).add(id));
    try {
      let ids: string[];
      if (g.isStandalone) {
        await activityApi.setImage(
          id,
          Math.max(0, (g.work.imageCount ?? 1) - 1),
          g.work.imageCount ?? 1,
          "explicit",
        );
        ids = [id];
      } else {
        ids = (await activityApi.markWorkRead(id)).affectedAlbums;
      }
      toast({
        kind: "success",
        ttl: 5000,
        message: `已将《${g.work.comic?.cleanTitle || g.work.displayName}》的 ${ids.length} 话标为已读`,
        action: ids.length
          ? {
              label: "撤销",
              onClick: () => {
                void (async () => {
                  for (let start = 0; start < ids.length; start += 1000)
                    await activityApi.removeImages(
                      ids.slice(start, start + 1000),
                    );
                  await client.invalidateQueries({
                    queryKey: libraryQueryKeys.unreadAlbums("comic"),
                  });
                })().catch(() =>
                  toast({ kind: "error", message: "撤销失败，请重试" }),
                );
              },
            }
          : undefined,
      });
      await feed.refetch();
    } catch {
      toast({ kind: "error", message: "更新阅读状态失败，请重试" });
    } finally {
      setPending((old) => {
        const next = new Set(old);
        next.delete(id);
        return next;
      });
    }
  }
  return (
    <Page>
      <PageHero
        title="待读漫画"
        meta={
          feed.data
            ? `还有 ${feed.data.pages[0].page.total} 部作品未读`
            : undefined
        }
      />
      <input
        aria-label="搜索待读作品"
        className="my-3 w-full max-w-md rounded-lg border border-line-subtle bg-raised px-3 py-2"
        placeholder="搜索作品或作者"
        value={q}
        onChange={(e) => setQuery(e.target.value)}
      />
      {feed.isLoading ? (
        <p>正在统计待读作品…</p>
      ) : feed.isError ? (
        <Button onClick={() => void feed.refetch()}>读取失败，重试</Button>
      ) : !feed.data?.pages[0].page.total ? (
        <p>{q ? "没有匹配的作品" : "暂时没有待读作品"}</p>
      ) : null}
      <div className="grid gap-3 xl:grid-cols-2">
        {feed.data?.pages
          .flatMap((p) => p.page.items)
          .filter((g) => !pending.has(g.work.id))
          .map((g) => (
            <UnreadWorkCard
              key={g.work.id}
              g={g}
              mark={mark}
              openVolumes={openVolumes}
            />
          ))}
      </div>
      {feed.hasNextPage && (
        <Button
          disabled={feed.isFetchingNextPage}
          onClick={() => void feed.fetchNextPage()}
        >
          加载更多作品
        </Button>
      )}
    </Page>
  );
}

function UnreadWorkCard({
  g,
  mark,
  openVolumes,
}: {
  g: UnreadWorkGroup;
  mark: (g: UnreadWorkGroup) => Promise<void>;
  openVolumes: (id: string) => void;
}) {
  const w = g.work,
    c = g.nextChapter,
    title = w.comic?.cleanTitle || w.displayName,
    chapter = c.comic?.chapterLabel || c.displayName;
  return (
    <article
      key={w.id}
      className="grid grid-cols-[80px_minmax(0,1fr)] items-center gap-3 rounded-xl border border-line-subtle bg-raised p-3"
    >
      <div className="relative">
        <ThumbImage
          fileId={w.coverImage ?? c.coverImage ?? ""}
          version={w.coverImageVersion ?? c.coverImageVersion}
          alt=""
          className="aspect-[2/3] w-full rounded-lg object-cover"
        />
        <span className="absolute left-1 top-1 rounded bg-theater-surface px-1 text-caption text-theater-fg">
          {g.unreadCount} 话未读
        </span>
      </div>
      <div className="min-w-0">
        <h2 className="truncate text-subheading">{title}</h2>
        {w.comic?.synopsis && (
          <p className="truncate text-caption text-ink-2">{w.comic.synopsis}</p>
        )}
        <p className="truncate text-caption text-ink-2">下一话 · {chapter}</p>
        <div className="mt-2 flex flex-wrap gap-1">
          <Link
            to={readerRoute(c.id)}
            className={`${buttonStyles({ variant: "primary", size: "sm" })} max-w-full`}
            title={`从${chapter}开读`}
          >
            <span className="truncate">从{chapter}开读</span>
          </Link>
          <Menu
            label={title + "的操作"}
            trigger={
              <Button variant="ghost" size="sm">
                更多
              </Button>
            }
            items={[
              {
                id: "chapters",
                label: "查看全部未读话",
                onSelect: () => openVolumes(w.id),
              },
              {
                id: "read",
                label: "整部标为已读",
                onSelect: () => void mark(g),
              },
            ]}
          />
        </div>
      </div>
    </article>
  );
}
