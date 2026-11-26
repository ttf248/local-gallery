import { Segmented } from "../ui/Segmented";
import { thumbUrl } from "../api/thumbs";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { albumsApi } from "../api/albums";
import { libraryApi } from "../api/library";
import { useAppMode } from "../hooks/useAppMode";
import { useDebounce } from "../hooks/useDebounce";
import { useFocusTrap } from "../ui/useFocusTrap";
import { useHistoryCards } from "../hooks/useHistory";
import { useUIStore, type ThemePref } from "../store/uiStore";
import {
  albumRoute,
  homeRoute,
  libraryRoute,
  randomPhotosRoute,
  searchRoute,
  tagRoute,
} from "../utils/path";
import { workbenchCopy } from "../utils/workbench";
import { CloseIcon, SearchIcon } from "../ui/icons";

export type CommandScope = "name" | "content";

export interface CommandQuickAction {
  id: string;
  label: string;
  keywords: string[];
  shortcut?: string;
  group: "navigation" | "action";
  onSelect: () => void;
}

export interface CommandPaletteProps {
  open: boolean;
  onRefresh?: () => void;
  onScan?: () => void;
  canScan?: boolean;
  onClose: () => void;
}

interface CommandRow {
  id: string;
  label: string;
  detail?: string;
  thumb?: string;
  onSelect: () => void;
}

export default function CommandPalette({
  open,
  ...props
}: CommandPaletteProps) {
  return open ? createPortal(<Palette {...props} />, document.body) : null;
}

function Palette({
  onClose,
  onRefresh,
  onScan,
  canScan = true,
}: Omit<CommandPaletteProps, "open">) {
  const { mode, setMode } = useAppMode();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const params = new URLSearchParams(search);
  const onResults = pathname === searchRoute(mode);
  const [query, setQuery] = useState(onResults ? (params.get("q") ?? "") : "");
  const [scope, setScope] = useState<CommandScope>(
    mode === "photo" && onResults && params.get("scope") === "content"
      ? "content"
      : "name",
  );
  const [activeId, setActiveId] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const copy = workbenchCopy(mode);
  const pushToast = useUIStore((s) => s.pushToast);
  const setTheme = useUIStore((s) => s.setTheme);
  const term = query.trim();
  const debounced = useDebounce(term, 180);
  const nameSearch = scope === "name" && term.length > 0;
  const suggestions = useQuery({
    queryKey: ["library", "search", mode, debounced, 10],
    queryFn: ({ signal }) =>
      albumsApi.search(debounced, mode, 10, undefined, signal),
    enabled: nameSearch && debounced === term,
    staleTime: 30_000,
    retry: false,
  });
  const { cards } = useHistoryCards(mode, !term);
  const shuffle = useMutation({
    mutationFn: () => libraryApi.randomAlbums(mode),
    onSuccess: ({ albums }) => {
      if (albums[0]) navigate(albumRoute(mode, albums[0].id));
      else pushToast({ kind: "info", message: "没有可随机打开的相册" });
    },
    onError: () => pushToast({ kind: "info", message: "没有可随机打开的相册" }),
  });

  useFocusTrap(panel, true);
  useLayoutEffect(() => {
    const previous = document.activeElement;
    const backdrop = panel.current?.parentElement;
    const background = Array.from(document.body.children).filter(
      (element) => element !== backdrop && !element.hasAttribute("inert"),
    );
    background.forEach((element) => element.setAttribute("inert", ""));
    input.current?.focus();
    return () => {
      background.forEach((element) => element.removeAttribute("inert"));
      const active = document.activeElement;
      if (active !== document.body && !backdrop?.contains(active)) return;
      if (
        previous instanceof HTMLElement &&
        previous !== document.body &&
        previous.isConnected &&
        !previous.closest("[inert]")
      ) {
        previous.focus({ preventScroll: true });
        if (document.activeElement === previous) return;
      }
      Array.from(
        document.querySelectorAll<HTMLElement>("[data-command-trigger]"),
      )
        .find(
          (element) =>
            !element.closest("[inert]") && element.getClientRects().length,
        )
        ?.focus({ preventScroll: true });
    };
  }, []);

  const quickActions: CommandQuickAction[] = [
    {
      id: "home",
      label: mode === "comic" ? "漫画首页" : "照片库",
      keywords: ["首页"],
      group: "navigation",
      onSelect: () => navigate(homeRoute(mode)),
    },
    {
      id: "library",
      label: mode === "comic" ? "书架" : "相册",
      keywords: ["目录"],
      group: "navigation",
      onSelect: () => navigate(libraryRoute(mode)),
    },
    {
      id: "tasks",
      label: "任务中心",
      keywords: ["分析", "任务"],
      group: "navigation",
      onSelect: () => navigate("/tasks/run"),
    },
    ...(onRefresh
      ? [
          {
            id: "refresh",
            label: "刷新媒体库",
            keywords: ["刷新", "缓存"],
            group: "action" as const,
            onSelect: onRefresh,
          },
        ]
      : []),
    ...(onScan && canScan
      ? [
          {
            id: "scan",
            label: "重新扫描",
            keywords: ["扫描"],
            shortcut: "Ctrl+S",
            group: "action" as const,
            onSelect: onScan,
          },
        ]
      : []),
    {
      id: "settings",
      label: "设置",
      keywords: ["偏好"],
      shortcut: "Ctrl+,",
      group: "navigation",
      onSelect: () => navigate("/settings"),
    },
    {
      id: "mode",
      label: mode === "comic" ? "切换到照片" : "切换到漫画",
      keywords: ["工作台"],
      group: "action",
      onSelect: () => setMode(mode === "comic" ? "photo" : "comic"),
    },
    ...(
      [
        ["light", "浅色"],
        ["dark", "深色"],
        ["system", "跟随系统"],
      ] satisfies [ThemePref, string][]
    ).map(([theme, label]) => ({
      id: theme,
      label: `主题 · ${label}`,
      keywords: ["主题", "外观"],
      group: "action" as const,
      onSelect: () => setTheme(theme),
    })),
    ...(mode === "photo"
      ? [
          {
            id: "random-photos",
            label: "随手看看",
            keywords: ["随机照片"],
            group: "navigation" as const,
            onSelect: () => navigate(randomPhotosRoute()),
          },
        ]
      : []),
    {
      id: "shuffle",
      label: copy.randomLabel,
      keywords: ["随机"],
      shortcut: "R",
      group: "action",
      onSelect: () => shuffle.mutate(),
    },
  ];

  function showResults() {
    if (!term) return;
    onClose();
    const next = new URLSearchParams({ q: term, scope });
    navigate(`${searchRoute(mode)}?${next}`);
  }

  const matches: CommandRow[] =
    nameSearch && debounced === term
      ? (suggestions.data?.results ?? []).map((hit) => ({
          id: `hit-${hit.path}`,
          label: hit.name,
          thumb: hit.coverImage
            ? thumbUrl(hit.coverImage, hit.coverImageVersion, 320)
            : undefined,
          detail:
            hit.kind === "smartCollection"
              ? "标签"
              : hit.kind === "collection"
                ? copy.collectionTypeLabel
                : copy.albumTypeLabel,
          onSelect: () =>
            navigate(
              hit.kind === "smartCollection" && hit.path.startsWith("smart:")
                ? tagRoute(mode, hit.path.slice("smart:".length))
                : albumRoute(mode, hit.path),
            ),
        }))
      : [];
  const recent = cards.slice(0, 5).map((card) => ({
    id: `recent-${card.to}`,
    label: card.title,
    thumb: card.coverPath
      ? thumbUrl(card.coverPath, card.coverVersion, 320)
      : undefined,
    onSelect: () => navigate(card.to),
  }));
  const quickMatches = quickActions.filter(
    ({ label, keywords }) =>
      !term ||
      (scope === "name" &&
        [label, ...keywords].some((word) => word.includes(term))),
  );
  const sections = term
    ? [
        { label: "匹配内容", rows: matches },
        {
          label: "快捷操作",
          rows: quickMatches.map((action) => ({
            ...action,
            detail: action.shortcut,
          })),
        },
        {
          label: "搜索",
          rows: [
            {
              id: "results",
              label: scope === "name" ? "查看全部结果" : "搜索画面与文字",
              onSelect: showResults,
            } as CommandRow,
          ],
        },
      ]
    : [
        { label: "最近浏览", rows: recent },
        ...(["navigation", "action"] as const).map((group) => ({
          label: group === "navigation" ? "快捷导航" : "快捷操作",
          rows: quickActions
            .filter((action) => action.group === group)
            .map((action) => ({ ...action, detail: action.shortcut })),
        })),
      ];
  const rows = sections.flatMap(({ rows }) => rows as CommandRow[]);
  const activeIndex = rows.findIndex(({ id }) => id === activeId);
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (activeIndex >= 0)
      document
        .getElementById(`${listId}-${activeIndex}`)
        ?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, listId]);

  function choose(row: CommandRow) {
    onClose();
    row.onSelect();
  }

  function onPanelKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.nativeEvent.isComposing) return;
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    if (query) {
      setQuery("");
      setActiveId("");
      input.current?.focus();
    } else onClose();
  }

  return (
    <div
      className="fixed inset-0 z-dialog flex items-start justify-center bg-black/[.32] px-4 pt-[14dvh] backdrop-blur-[2px]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="flex max-h-[78dvh] w-full max-w-[640px] flex-col overflow-hidden rounded-sheet bg-bg-elevated shadow-3"
        onKeyDown={onPanelKey}
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2 border-b border-line px-3">
          <SearchIcon size={19} className="shrink-0 text-fg-muted" />
          <input
            className="h-14 min-w-0 flex-1 bg-transparent text-title-3"
            ref={input}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded
            aria-controls={listId}
            aria-activedescendant={
              activeIndex >= 0 ? optionId(activeIndex) : undefined
            }
            aria-label={
              scope === "content"
                ? "搜索照片里的画面与文字"
                : `搜索${copy.albumTypeLabel}或标签`
            }
            placeholder={
              scope === "content"
                ? "描述画面或输入照片里的文字…"
                : "搜索名称或命令…"
            }
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveId("");
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (
                (event.key === "ArrowDown" || event.key === "ArrowUp") &&
                rows.length
              ) {
                event.preventDefault();
                const step = event.key === "ArrowDown" ? 1 : -1;
                const next =
                  activeIndex < 0
                    ? step === 1
                      ? 0
                      : rows.length - 1
                    : (activeIndex + step + rows.length) % rows.length;
                setActiveId(rows[next].id);
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey || scope === "content") showResults();
                else if (activeIndex >= 0) choose(rows[activeIndex]);
                else if (matches[0]?.label === term) choose(matches[0]);
                else showResults();
              }
            }}
          />
          {mode === "photo" && (
            <Segmented<CommandScope>
              label="搜索范围"
              size="sm"
              value={scope}
              onChange={(next) => {
                setScope(next);
                setActiveId("");
                input.current?.focus();
              }}
              options={[
                { value: "name", label: "名称" },
                { value: "content", label: "画面与文字" },
              ]}
            />
          )}
          <button
            type="button"
            aria-label="关闭命令面板"
            className="toolbar-icon"
            onClick={onClose}
          >
            <CloseIcon size={17} />
          </button>
        </div>
        <div
          className="min-h-0 overflow-y-auto p-2"
          id={listId}
          role="listbox"
          aria-label="命令与搜索结果"
        >
          {nameSearch && (debounced !== term || suggestions.isFetching) && (
            <p role="status" className="px-3 py-2 text-micro text-fg-subtle">
              正在搜索…
            </p>
          )}
          {nameSearch && suggestions.isError && (
            <p role="status" className="px-3 py-2 text-micro text-fg-subtle">
              名称建议读取失败，可打开结果页重试。
            </p>
          )}
          {sections.map(
            ({ label, rows: sectionRows }) =>
              sectionRows.length > 0 && (
                <div key={label} role="group" aria-label={label}>
                  <div
                    aria-hidden
                    className="px-3 py-2 text-micro text-fg-subtle"
                  >
                    {label}
                  </div>
                  {(sectionRows as CommandRow[]).map((row) => (
                    <button
                      key={row.id}
                      id={optionId(rows.indexOf(row))}
                      type="button"
                      role="option"
                      aria-selected={row.id === activeId}
                      tabIndex={-1}
                      className="flex min-h-12 w-full items-center gap-3 rounded-control px-3 text-left text-callout hover:bg-bg-subtle aria-selected:bg-bg-subtle"
                      onClick={() => choose(row)}
                      onMouseDown={(event) => event.preventDefault()}
                    >
                      {row.thumb && (
                        <img
                          src={row.thumb}
                          width={32}
                          height={32}
                          alt=""
                          className="size-8 rounded-md object-cover"
                        />
                      )}
                      <span className="flex-1 truncate">{row.label}</span>
                      {row.detail && (
                        <span className="text-caption text-fg-muted">
                          {row.detail}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              ),
          )}
        </div>
        <footer className="flex min-h-9 items-center border-t border-line px-4 text-micro text-fg-muted">
          ↑↓ 选择 · ↵ 打开{mode === "photo" ? " · Tab 切换范围" : ""} · Esc 关闭
        </footer>
      </div>
    </div>
  );
}
