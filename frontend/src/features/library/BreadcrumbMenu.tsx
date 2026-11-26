import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  libraryApi,
  type AppMode,
  type LibraryNodeSummary,
  type LibraryRootSummary,
} from "../../api/library";
import { libraryRoute } from "../../utils/path";
import Popover, { PopoverItem, PopoverLabel } from "../../ui/Popover";
import { ChevronDownIcon, ChevronRightIcon } from "../../ui/icons";

type Crumb = { id: string; name: string };

export default function BreadcrumbMenu({
  mode,
  nodeId,
  roots,
  chain,
  onSelect,
}: {
  mode: AppMode;
  nodeId: string;
  roots: LibraryRootSummary[];
  chain: LibraryNodeSummary[];
  onSelect: (id: string) => void;
}) {
  const currentRoot = roots.find(({ id }) => id === nodeId);
  const source = chain[0];
  const root =
    currentRoot ??
    roots.find(
      ({ id, name }) =>
        id === source?.sourceRoot || name === source?.sourceName,
    );
  return (
    <nav aria-label="目录位置" className="library-crumbs flex items-center gap-1 mt-1.5 text-caption text-ink-3 flex-nowrap m-0 min-w-0">
      <Link
        to={libraryRoute(mode)}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
            return;
          event.preventDefault();
          onSelect("");
        }}
        className="library-crumbs__link text-ink-2 no-underline rounded-sm hover:text-ink hover:underline hover:[text-underline-offset:3px] inline-flex gap-[3px] items-center min-w-0 max-w-[120px] whitespace-nowrap touch:min-h-11 touch:min-w-11"
      >
        {mode === "comic" ? "书架" : "相册"}
      </Link>
      {root && (
        <CrumbMenu
          mode={mode}
          item={root}
          siblings={roots}
          current={root.id === nodeId}
          onSelect={onSelect}
        />
      )}
      {chain.map((item, index) => (
        <CrumbMenu
          key={item.id}
          mode={mode}
          item={{ id: item.id, name: item.displayName || item.name }}
          parentId={item.parentId || chain[index - 1]?.id || root?.id}
          current={item.id === nodeId}
          onSelect={onSelect}
        />
      ))}
    </nav>
  );
}

function CrumbMenu({
  mode,
  item,
  parentId,
  siblings,
  current,
  onSelect,
}: {
  mode: AppMode;
  item: Crumb;
  parentId?: string;
  siblings?: Crumb[];
  current: boolean;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const children = useInfiniteQuery({
    queryKey: ["library", "breadcrumb", mode, parentId],
    queryFn: ({ pageParam, signal }) =>
      libraryApi.childrenPage(
        parentId ?? "",
        mode,
        pageParam,
        undefined,
        signal,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (result) => result.page.nextCursor || undefined,
    enabled: open && Boolean(parentId),
    staleTime: 30_000,
  });
  const choices =
    siblings ??
    (children.data?.pages ?? []).flatMap(({ page }) =>
      (page.items ?? [])
        .filter(({ kind }) => kind === "collection")
        .map((node) => ({ id: node.id, name: node.displayName || node.name })),
    );
  const entries = choices.some(({ id }) => id === item.id)
    ? choices
    : [item, ...choices];
  return (
    <span className="library-crumbs__segment flex items-center flex-nowrap gap-1 m-0 min-w-0 [&>div]:min-w-0 [&>div]:shrink">
      <ChevronRightIcon
        size={12}
        className="shrink-0 text-ink-2"
        aria-hidden
      />
      <Popover
        aria-label={`${item.name}的同级目录`}
        align="start"
        open={open}
        onOpenChange={setOpen}
        className="breadcrumb-menu max-w-[calc(100vw_-_20px)] max-h-[min(55dvh,420px)] overflow-auto touch:[&_button]:min-h-11 touch:[&_button]:min-w-11 scroll-thin [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar]:h-1.5"
        trigger={
          <button
            type="button"
            className="library-crumbs__link text-ink-2 no-underline rounded-sm hover:text-ink hover:underline hover:[text-underline-offset:3px] inline-flex gap-[3px] items-center min-w-0 max-w-[120px] whitespace-nowrap touch:min-h-11 touch:min-w-11"
            aria-current={current ? "location" : undefined}
            title={item.name}
          >
            <span className="truncate">{item.name}</span>
            <ChevronDownIcon size={12} className="shrink-0" />
          </button>
        }
      >
        <PopoverLabel>同级目录</PopoverLabel>
        {entries.map((entry) => (
          <PopoverItem
            key={entry.id}
            active={entry.id === item.id}
            onClick={() => onSelect(entry.id)}
            title={entry.name}
          >
            <span className="truncate">{entry.name}</span>
          </PopoverItem>
        ))}
        {children.isError && (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="btn btn-ghost"
            onClick={() => void children.refetch()}
          >
            重试读取同级目录
          </button>
        )}
        {children.hasNextPage && (
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="btn btn-ghost"
            disabled={children.isFetchingNextPage}
            onClick={() => void children.fetchNextPage()}
          >
            {children.isFetchingNextPage ? "正在读取…" : "更多目录"}
          </button>
        )}
      </Popover>
    </span>
  );
}
