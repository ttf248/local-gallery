import { useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ChevronRightIcon,
  CloseIcon,
  FolderIcon,
  ImageIcon,
  SearchIcon,
} from "../../ui/icons";
import {
  libraryApi,
  type AppMode,
  type LibraryNodeSummary,
} from "../../api/library";
import { libraryQueryKeys } from "../../api/queryKeys";
import {
  useLibraryAncestors,
  useLibraryManifest,
} from "../../hooks/useLibrary";
import { albumRoute } from "../../utils/path";
import {
  albumCountUnit,
  mediaUnit,
  workbenchCopy,
} from "../../utils/workbench";

interface Props {
  mode: AppMode;
  /** 当前选中的媒体根或文件夹 id（空串 = 所有根）。 */
  selectedId: string;
  /** 选中一个媒体根或文件夹：内容区切到它的下一层。 */
  onSelect: (id: string) => void;
}

/** 定位一次最多列多少条命中。 */
const SEARCH_LIMIT = 50;

/**
 * 目录树：媒体根 → 文件夹 → 子文件夹 → 相册。
 *
 * 它展示的是**磁盘上真实存在的结构**，不是分析出来的分组。智能主题
 * （时间、人物、地点、场景的聚合）是另一回事，在发现页里，不在这里 ——
 * 用自动分组冒充文件夹树，用户就找不到自己的文件。
 *
 * 三件事决定它好不好用：
 *
 * - **默认只展开当前位置相关的那条路**。一棵全部摊开的树会把用户淹在
 *   别人的目录里；站在哪一层，就只展开到那一层。
 * - **能搜**。目录可能很深，靠一层层点找文件夹是体力活；搜到就跳过去。
 * - **能收起**。看得见的只有需要的那几层。
 *
 * 子项按需取：展开一个节点才去读它的下一层。目录可能很深，一次性把
 * 整棵树拉下来既慢又没人看。
 */
export default function FolderTree({ mode, selectedId, onSelect }: Props) {
  const manifest = useLibraryManifest().data?.manifest;
  // 只列当前这一侧的根：照片工作台的目录树里摆一个漫画根，点进去
  // 右边是空的 —— 用户只会以为自己走错了地方。
  const roots = useMemo(
    () =>
      (manifest?.roots ?? []).filter(
        (root) => (root.contentKind ?? "photo") === mode,
      ),
    [manifest, mode],
  );

  // 当前位置的祖先链：默认展开的就是这条链上的层级。
  const ancestors = useLibraryAncestors(selectedId);
  const pathIds = useMemo(
    () => new Set((ancestors.data ?? []).map((node) => node.id)),
    [ancestors.data],
  );
  // 用户手动展开或收起的层级：手动优先于默认。
  const [manual, setManual] = useState<Record<string, boolean>>({});
  // 默认展开到什么程度：只展开当前所在的那条路。
  //
  // 媒体根那一层也默认收着：根下面常常是几十个年份文件夹，全部摊开
  // 就是一份巨大的导航列表，而内容区此刻正摆着同一批文件夹 —— 树与
  // 内容各说一遍，树上那份还把「我在哪儿」这件事挤没了。用户想翻目录
  // 时点一下根即可。
  const isExpanded = (id: string) => manual[id] ?? pathIds.has(id);
  const toggle = (id: string) =>
    setManual((previous) => ({ ...previous, [id]: !isExpanded(id) }));

  const [query, setQuery] = useState("");
  const trimmed = query.trim();

  if (roots.length === 0) return null;
  return (
    <nav aria-label="目录" className="library-tree text-body">
      <div className="library-tree__search flex items-center gap-1.5 h-8 [padding:0_4px_0_8px] mb-2 border border-line rounded-control bg-bg focus-within:border-signal focus-within:[outline:2px_solid_var(--signal)] focus-within:[outline-offset:1px] touch:min-h-11 touch:min-w-11">
        <SearchIcon size={13} className="shrink-0 text-fg-subtle" />
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="定位文件夹或相册"
          aria-label="在目录中定位"
          className="h-full min-w-0 flex-1 bg-transparent text-body text-fg outline-none placeholder:text-fg-subtle"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            className="library-tree__search-clear inline-flex items-center justify-center w-7 h-7 shrink-0 rounded-sm text-fg-subtle hover:bg-bg-subtle hover:text-fg touch:min-h-11 touch:min-w-11"
            aria-label="清除定位"
          >
            <CloseIcon size={12} />
          </button>
        ) : null}
      </div>

      {trimmed ? (
        <TreeSearchResults
          mode={mode}
          query={trimmed}
          onPickFolder={(id) => {
            setQuery("");
            onSelect(id);
          }}
        />
      ) : (
        <ul className="library-tree__list [list-style:none] m-0 p-0">
          {roots.map((root) => (
            <TreeRoot
              key={root.id}
              id={root.id}
              name={root.name}
              mode={mode}
              selectedId={selectedId}
              onSelect={onSelect}
              expanded={isExpanded(root.id)}
              onToggle={() => toggle(root.id)}
              isExpanded={isExpanded}
              onToggleChild={toggle}
            />
          ))}
        </ul>
      )}
    </nav>
  );
}

/**
 * 定位结果：一份扁平清单。
 *
 * 搜目录不该再画一棵树 —— 树在这里只会把命中埋起来。给名字、类型与
 * 数量，点一下就过去。
 */
function TreeSearchResults({
  mode,
  query,
  onPickFolder,
}: {
  mode: AppMode;
  query: string;
  onPickFolder: (id: string) => void;
}) {
  const navigate = useNavigate();
  const copy = workbenchCopy(mode);
  const search = useQuery({
    queryKey: libraryQueryKeys.treeSearch(mode, query),
    queryFn: ({ signal }) =>
      libraryApi
        .overview({ kind: mode, q: query }, undefined, signal)
        .then((response) => response.page),
    staleTime: 30_000,
  });
  const nodes = (search.data?.items ?? [])
    .filter((item) => item.kind !== "smart")
    .map((item) => item.node);

  if (search.isLoading) {
    return <p className="library-tree__hint py-1.5 px-2 text-caption text-fg-subtle">正在查找…</p>;
  }
  if (search.isError) {
    return (
      <div className="library-tree__hint py-1.5 px-2 text-caption text-fg-subtle">
        <p role="alert" className="text-danger">
          查找失败。
        </p>
        <button
          type="button"
          className="btn btn-sm btn-outline"
          onClick={() => void search.refetch()}
        >
          重试
        </button>
      </div>
    );
  }
  if (nodes.length === 0) {
    return <p className="library-tree__hint py-1.5 px-2 text-caption text-fg-subtle">没有找到「{query}」。</p>;
  }

  return (
    <ul className="library-tree__list [list-style:none] m-0 p-0" data-testid="tree-search-results">
      {nodes.map((node) => {
        const isFolder = node.kind === "collection";
        const label = node.displayName || node.name;
        return (
          <li key={node.id} className="library-tree__item m-0">
            <div className="library-tree__row flex items-center gap-1 min-h-8 pr-2 rounded-sm text-fg-muted hover:bg-bg-subtle hover:text-fg [&.is-active]:text-fg [&.is-active]:font-semibold [&.is-active]:bg-bg-elevated [&.is-active]:shadow-1" style={{ paddingLeft: 8 }}>
              <span className="library-tree__toggle inline-flex items-center justify-center w-7 h-7 ml-[-4px] shrink-0 rounded-sm text-fg-subtle hover:bg-bg-strong hover:text-fg touch:min-h-11 touch:min-w-11 library-tree__toggle--leaf pointer-events-none" />
              <button
                type="button"
                className="library-tree__label flex items-center gap-[7px] flex-1 min-w-0 py-[3px] px-0 text-left text-body [color:inherit] touch:min-h-11 touch:min-w-11"
                onClick={() => {
                  if (isFolder) {
                    onPickFolder(node.id);
                    return;
                  }
                  navigate(albumRoute(mode, node.id));
                }}
              >
                {isFolder ? <FolderIcon size={14} /> : <ImageIcon size={14} />}
                <span className="truncate">{label}</span>
              </button>
              <span className="library-tree__meta shrink-0 text-caption text-fg-subtle tabular-nums">
                {isFolder
                  ? `${node.albumCount ?? 0} ${albumCountUnit(mode)}`
                  : `${node.imageCount ?? 0} ${mediaUnit(mode)}`}
              </span>
            </div>
          </li>
        );
      })}
      {nodes.length >= SEARCH_LIMIT ? (
        <li className="library-tree__hint py-1.5 px-2 text-caption text-fg-subtle">只列出了前 {SEARCH_LIMIT} 条。</li>
      ) : null}
      <li className="library-tree__hint py-1.5 px-2 text-caption text-fg-subtle">
        {mode === "comic" ? copy.albumTypeLabel : "相册"}点开是内容，
        {copy.collectionTypeLabel}点开是下一层。
      </li>
    </ul>
  );
}

/** 一个媒体根（配置里的一条 mediaRoots）。它本身就是目录的第一层。 */
function TreeRoot({
  id,
  name,
  mode,
  selectedId,
  onSelect,
  expanded,
  onToggle,
  isExpanded,
  onToggleChild,
}: {
  id: string;
  name: string;
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  expanded: boolean;
  onToggle: () => void;
  isExpanded: (id: string) => boolean;
  onToggleChild: (id: string) => void;
}) {
  const children = useFolderChildren(id, mode, expanded);
  return (
    <li className="library-tree__item m-0">
      <TreeRow
        label={name}
        icon={<FolderIcon size={15} />}
        depth={0}
        expanded={expanded}
        hasChildren
        onToggle={onToggle}
        active={selectedId === id}
        onSelect={() => onSelect(id)}
      />
      {expanded ? (
        <TreeChildrenContent
          items={children.data ?? []}
          loading={children.isLoading}
          error={children.isError}
          onRetry={() => void children.refetch()}
          mode={mode}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={1}
          isExpanded={isExpanded}
          onToggle={onToggleChild}
        />
      ) : null}
    </li>
  );
}

/** 一个文件夹（目录树的中间节点）。点它看它的下一层，再点里面的相册进照片墙。 */
function TreeCollection({
  node,
  mode,
  selectedId,
  onSelect,
  depth,
  expanded,
  onToggle,
  isExpanded,
  onToggleChild,
}: {
  node: LibraryNodeSummary;
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
  expanded: boolean;
  onToggle: () => void;
  isExpanded: (id: string) => boolean;
  onToggleChild: (id: string) => void;
}) {
  const children = useFolderChildren(node.id, mode, expanded);
  const count = node.albumCount ?? 0;
  return (
    <li className="library-tree__item m-0">
      <TreeRow
        label={node.displayName || node.name}
        icon={<FolderIcon size={15} />}
        depth={depth}
        expanded={expanded}
        hasChildren
        onToggle={onToggle}
        active={selectedId === node.id}
        onSelect={() => onSelect(node.id)}
        meta={`${count} ${albumCountUnit(mode)}`}
      />
      {expanded ? (
        <TreeChildrenContent
          items={children.data ?? []}
          loading={children.isLoading}
          error={children.isError}
          onRetry={() => void children.refetch()}
          mode={mode}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
          isExpanded={isExpanded}
          onToggle={onToggleChild}
        />
      ) : null}
    </li>
  );
}

/** 一层子项：文件夹可展开，相册直接进照片墙。 */
function TreeChildren({
  items,
  mode,
  selectedId,
  onSelect,
  depth,
  isExpanded,
  onToggle,
}: {
  items: LibraryNodeSummary[];
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <ul className="library-tree__list [list-style:none] m-0 p-0">
      {items.map((node) =>
        node.kind === "collection" ? (
          <TreeCollection
            key={node.id}
            node={node}
            mode={mode}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={depth}
            expanded={isExpanded(node.id)}
            onToggle={() => onToggle(node.id)}
            isExpanded={isExpanded}
            onToggleChild={onToggle}
          />
        ) : (
          <li key={node.id} className="library-tree__item m-0">
            <TreeRow
              label={node.displayName || node.name}
              icon={<ImageIcon size={14} />}
              depth={depth}
              expanded={false}
              hasChildren={false}
              onToggle={() => {}}
              active={false}
              onSelect={() => {
                navigate(albumRoute(mode, node.id));
              }}
              meta={`${node.imageCount ?? 0} ${mediaUnit(mode)}`}
            />
          </li>
        ),
      )}
    </ul>
  );
}

/** 目录树子项的读取状态；失败时保留已有条目并提供显式重试。 */
function TreeChildrenContent({
  items,
  loading,
  error,
  onRetry,
  mode,
  selectedId,
  onSelect,
  depth,
  isExpanded,
  onToggle,
}: {
  items: LibraryNodeSummary[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
  isExpanded: (id: string) => boolean;
  onToggle: (id: string) => void;
}) {
  const indent = { paddingLeft: 8 + depth * 16 };
  return (
    <>
      {error ? (
        <div className="flex flex-wrap items-center gap-2 py-2" style={indent}>
          <span role="alert" className="text-caption text-danger">
            目录读取失败。
          </span>
          <button
            type="button"
            className="btn btn-sm btn-outline min-h-11"
            onClick={onRetry}
          >
            重试
          </button>
        </div>
      ) : null}
      {loading && items.length === 0 ? (
        <p className="py-2 text-caption text-fg-muted" style={indent}>
          正在读取目录…
        </p>
      ) : null}
      {items.length > 0 ? (
        <TreeChildren
          items={items}
          mode={mode}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth}
          isExpanded={isExpanded}
          onToggle={onToggle}
        />
      ) : null}
    </>
  );
}

/** 树里的一行。 */
function TreeRow({
  label,
  icon,
  depth,
  expanded,
  hasChildren,
  onToggle,
  active,
  onSelect,
  meta,
}: {
  label: string;
  icon: ReactNode;
  depth: number;
  expanded: boolean;
  hasChildren: boolean;
  onToggle: () => void;
  active: boolean;
  onSelect: () => void;
  meta?: string;
}) {
  return (
    <div
      className={`library-tree__row flex items-center gap-1 min-h-8 pr-2 rounded-sm text-fg-muted hover:bg-bg-subtle hover:text-fg [&.is-active]:text-fg [&.is-active]:font-semibold [&.is-active]:bg-bg-elevated [&.is-active]:shadow-1${active ? " is-active" : ""}`}
      style={{ paddingLeft: 8 + depth * 16 }}
    >
      {hasChildren ? (
        <button
          type="button"
          className="library-tree__toggle inline-flex items-center justify-center w-7 h-7 ml-[-4px] shrink-0 rounded-sm text-fg-subtle hover:bg-bg-strong hover:text-fg touch:min-h-11 touch:min-w-11"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `收起 ${label}` : `展开 ${label}`}
        >
          <ChevronRightIcon
            size={13}
            className={`library-tree__chevron transition duration-2 [&.is-open]:[transform:rotate(90deg)]${expanded ? " is-open" : ""}`}
          />
        </button>
      ) : (
        <span className="library-tree__toggle inline-flex items-center justify-center w-7 h-7 ml-[-4px] shrink-0 rounded-sm text-fg-subtle hover:bg-bg-strong hover:text-fg touch:min-h-11 touch:min-w-11 library-tree__toggle--leaf pointer-events-none" />
      )}
      <button
        type="button"
        className="library-tree__label flex items-center gap-[7px] flex-1 min-w-0 py-[3px] px-0 text-left text-body [color:inherit] touch:min-h-11 touch:min-w-11"
        onClick={onSelect}
        aria-current={active ? "location" : undefined}
      >
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {meta ? (
        <span className="library-tree__meta shrink-0 text-caption text-fg-subtle tabular-nums">{meta}</span>
      ) : null}
    </div>
  );
}

/**
 * 一个目录下的子项。
 *
 * 展开时才取：目录可能很深，一次性把整棵树拉下来既慢又没人看。
 */
function useFolderChildren(parentId: string, mode: AppMode, enabled: boolean) {
  return useQuery({
    queryKey: libraryQueryKeys.children(parentId, mode),
    queryFn: ({ signal }) => libraryApi.childrenAll(parentId, mode, signal),
    enabled: enabled && parentId.length > 0,
    staleTime: 60_000,
    retry: false,
  });
}
