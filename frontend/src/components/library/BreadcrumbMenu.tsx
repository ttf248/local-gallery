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
import Popover, { PopoverItem, PopoverLabel } from "../common/Popover";
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
    <nav aria-label="目录位置" className="library-crumbs">
      <Link
        to={libraryRoute(mode)}
        onClick={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)
            return;
          event.preventDefault();
          onSelect("");
        }}
        className="library-crumbs__link"
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
    <span className="library-crumbs__segment">
      <ChevronRightIcon
        size={12}
        className="shrink-0 text-fg-muted"
        aria-hidden
      />
      <Popover
        aria-label={`${item.name}的同级目录`}
        align="start"
        open={open}
        onOpenChange={setOpen}
        className="breadcrumb-menu scroll-thin"
        trigger={
          <button
            type="button"
            className="library-crumbs__link"
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
            className="ui-btn ui-btn--ghost"
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
            className="ui-btn ui-btn--ghost"
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
