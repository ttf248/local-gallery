import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  ChevronRightIcon,
  FolderIcon,
  ImageIcon,
} from "../common/Icon";
import { libraryApi, type AppMode, type LibraryNodeSummary } from "../../api/library";
import { useLibraryManifest } from "../../hooks/useLibrary";
import { albumRoute } from "../../utils/path";
import { albumCountUnit } from "../../utils/workbench";

interface Props {
  mode: AppMode;
  /** 当前选中的集合 id（空串 = 顶层）。 */
  selectedId: string;
  /** 选中一个集合：内容区切到它的下一层。 */
  onSelect: (id: string) => void;
}

/**
 * 目录树：媒体根 → 集合 → 子集合 → 相册。
 *
 * 它展示的是**磁盘上真实存在的结构**，不是分析出来的分组。智能主题
 * （时间、人物、地点、场景的聚合）是另一回事，在探索页里，不在这里 ——
 * 用自动分组冒充文件夹树，用户就找不到自己的文件。
 *
 * 子项按需取：展开一个节点才去读它的下一层。目录可能很深，一次性把
 * 整棵树拉下来既慢又没人看。
 */
export default function FolderTree({ mode, selectedId, onSelect }: Props) {
  const manifest = useLibraryManifest().data?.manifest;
  // 只列当前这一侧的根：照片工作台的目录树里摆一个漫画根，点进去
  // 右边是空的 —— 用户只会以为自己走错了地方。
  const roots = (manifest?.roots ?? []).filter(
    (root) => (root.contentKind ?? "photo") === mode,
  );
  if (roots.length === 0) return null;
  return (
    <nav aria-label="目录" className="library-tree">
      <ul className="library-tree__list">
        {roots.map((root) => (
          <TreeRoot
            key={root.id}
            id={root.id}
            name={root.name}
            mode={mode}
            selectedId={selectedId}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </nav>
  );
}

/** 一个媒体根（配置里的一条 mediaRoots）。它本身就是目录的第一层。 */
function TreeRoot({
  id,
  name,
  mode,
  selectedId,
  onSelect,
}: {
  id: string;
  name: string;
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  // 根默认展开：用户进来先看到「库里有哪几个目录」。
  const [expanded, setExpanded] = useState(true);
  const children = useFolderChildren(id, mode, expanded);
  return (
    <li className="library-tree__item">
      <TreeRow
        label={name}
        icon={<FolderIcon size={15} />}
        depth={0}
        expanded={expanded}
        hasChildren
        onToggle={() => setExpanded((v) => !v)}
        active={selectedId === ""}
        onSelect={() => onSelect("")}
      />
      {expanded ? (
        <TreeChildren
          items={children.data ?? []}
          mode={mode}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={1}
        />
      ) : null}
    </li>
  );
}

/** 一个集合（目录树的中间节点）。点它看它的下一层，再点里面的相册进照片墙。 */
function TreeCollection({
  node,
  mode,
  selectedId,
  onSelect,
  depth,
}: {
  node: LibraryNodeSummary;
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const [expanded, setExpanded] = useState(depth === 1);
  const children = useFolderChildren(node.id, mode, expanded);
  const count = node.albumCount ?? 0;
  return (
    <li className="library-tree__item">
      <TreeRow
        label={node.displayName || node.name}
        icon={<FolderIcon size={15} />}
        depth={depth}
        expanded={expanded}
        hasChildren
        onToggle={() => setExpanded((v) => !v)}
        active={selectedId === node.id}
        onSelect={() => onSelect(node.id)}
        meta={`${count} ${albumCountUnit(mode)}`}
      />
      {expanded ? (
        <TreeChildren
          items={children.data ?? []}
          mode={mode}
          selectedId={selectedId}
          onSelect={onSelect}
          depth={depth + 1}
        />
      ) : null}
    </li>
  );
}

/** 一层子项：集合可展开，相册直接进照片墙。 */
function TreeChildren({
  items,
  mode,
  selectedId,
  onSelect,
  depth,
}: {
  items: LibraryNodeSummary[];
  mode: AppMode;
  selectedId: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  const navigate = useNavigate();
  if (items.length === 0) return null;
  return (
    <ul className="library-tree__list">
      {items.map((node) =>
        node.kind === "collection" ? (
          <TreeCollection
            key={node.id}
            node={node}
            mode={mode}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={depth}
          />
        ) : (
          <li key={node.id} className="library-tree__item">
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
              meta={`${node.imageCount ?? 0} 张`}
            />
          </li>
        ),
      )}
    </ul>
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
      className={`library-tree__row${active ? " is-active" : ""}`}
      style={{ paddingLeft: 8 + depth * 14 }}
    >
      {hasChildren ? (
        <button
          type="button"
          className="library-tree__toggle"
          onClick={onToggle}
          aria-expanded={expanded}
          aria-label={expanded ? `收起 ${label}` : `展开 ${label}`}
        >
          <ChevronRightIcon
            size={13}
            className={`library-tree__chevron${expanded ? " is-open" : ""}`}
          />
        </button>
      ) : (
        <span className="library-tree__toggle library-tree__toggle--leaf" />
      )}
      <button type="button" className="library-tree__label" onClick={onSelect}>
        {icon}
        <span className="truncate">{label}</span>
      </button>
      {meta ? <span className="library-tree__meta tabular-nums">{meta}</span> : null}
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
    queryKey: ["library", "children", parentId, mode],
    queryFn: ({ signal }) => libraryApi.childrenAll(parentId, mode, signal),
    enabled: enabled && parentId.length > 0,
    staleTime: 60_000,
  });
}
