import { useEffect, useMemo, useRef, useState } from "react";
import { Virtuoso, type VirtuosoHandle } from "react-virtuoso";
import { useNavigate } from "react-router-dom";
import { useChapterPages } from "../../hooks/useChapterPages";
import { useImageActivities } from "../../hooks/useImageActivity";
import Segmented from "../../ui/Segmented";
import { Button } from "../../ui/Button";
import { readerRoute } from "../../utils/path";
import PageOverview, { type PageOverviewProps } from "./PageOverview";
import type { ReaderController } from "./useReaderController";
export default function ReaderDrawer({
  reader,
  ...props
}: PageOverviewProps & { reader: ReaderController }) {
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState<"all" | "main" | "extra">("all"),
    [desc, setDesc] = useState(false);
  const { nodes, query } = useChapterPages(
    reader.albumSummary?.parentId,
    reader.pathParam,
    Boolean(q.trim() || desc || filter !== "all"),
  );
  const ids = useMemo(() => nodes.map((n) => n.id), [nodes]);
  const visible = reader.drawerTab === "chapters";
  const activity = useImageActivities(ids, visible);
  const navigate = useNavigate(),
    list = useRef<VirtuosoHandle>(null);
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const items = nodes.filter((n) => {
      const type = n.comic?.episodeType,
        extra = type === "extra" || type === "special";
      return (
        (filter === "all" || (filter === "extra") === extra) &&
        [n.name, n.comic?.cleanTitle, n.comic?.chapterLabel]
          .join(" ")
          .toLowerCase()
          .includes(term)
      );
    });
    return desc ? items.reverse() : items;
  }, [nodes, q, filter, desc]);
  const current = filtered.findIndex((n) => n.id === reader.pathParam);
  useEffect(() => {
    if (visible && current >= 0)
      list.current?.scrollIntoView({ index: current, align: "center" });
  }, [visible, current]);
  return (
    <PageOverview
      {...props}
      onShortcut={(k) => {
        if (k !== "t" && k !== "c") return false;
        reader.toggleDrawer(k === "t" ? "pages" : "chapters");
        return true;
      }}
      tabs={
        <Segmented
          label="目录页签"
          value={reader.drawerTab}
          onChange={reader.setDrawerTab}
          options={[
            {
              value: "chapters",
              label: `目录（${query.data?.pages[0]?.page.total ?? nodes.length} 话）`,
            },
            { value: "pages", label: `页码（${props.images.length} 页）` },
          ]}
        />
      }
      chapterList={
        visible ? (
          <div className="flex min-h-0 flex-1 flex-col gap-2 px-3 pb-3">
            <input
              className="field"
              type="search"
              aria-label="搜索章节"
              placeholder="话号或章节名"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <div className="flex items-center justify-between">
              <Segmented
                label="章节类型"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: "all", label: "全部" },
                  { value: "main", label: "正篇" },
                  { value: "extra", label: "番外" },
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDesc((v) => !v)}
              >
                {desc ? "倒序" : "正序"}
              </Button>
            </div>
            {query.isError && (
              <Button onClick={() => void query.refetch()}>重试读取目录</Button>
            )}
            {!filtered.length && !query.isFetching && <p>没有匹配章节</p>}
            <Virtuoso
              ref={list}
              className="flex-1"
              data={filtered}
              computeItemKey={(_, n) => n.id}
              endReached={() => {
                if (query.hasNextPage && !query.isFetching)
                  void query.fetchNextPage();
              }}
              itemContent={(_, n) => {
                const a = activity.data?.[n.id],
                  selected = n.id === reader.pathParam;
                return (
                  <button
                    aria-current={selected ? "page" : undefined}
                    className="grid min-h-[52px] w-full gap-1 border-l-[3px] border-transparent px-3 py-1 text-left aria-[current=page]:border-primary aria-[current=page]:bg-accent-soft"
                    onClick={() => {
                      props.onClose();
                      if (!selected) navigate(readerRoute(n.id));
                    }}
                  >
                    <span
                      className={
                        a?.status === "completed" ? "text-ink-3" : "text-ink"
                      }
                    >
                      {a?.status === "completed" ? "✓ " : ""}
                      {[
                        n.comic?.chapterLabel,
                        n.comic?.cleanTitle || n.displayName,
                      ]
                        .filter((v, i, s) => v && s.indexOf(v) === i)
                        .join(" · ")}
                    </span>
                    <span className="text-caption text-ink-2">
                      {n.comic?.episodeType === "extra" ||
                      n.comic?.episodeType === "special"
                        ? "番外"
                        : "正篇"}{" "}
                      · {n.imageCount ?? 0} 页
                    </span>
                    {a && (
                      <span className="h-1 overflow-hidden rounded-full bg-sunken">
                        <span
                          className="block h-full bg-primary"
                          style={{
                            width:
                              Math.min(
                                100,
                                (100 * (a.pageIndex + 1)) /
                                  Math.max(1, a.pageCount),
                              ) + "%",
                          }}
                        />
                      </span>
                    )}
                  </button>
                );
              }}
            />
          </div>
        ) : undefined
      }
    />
  );
}
