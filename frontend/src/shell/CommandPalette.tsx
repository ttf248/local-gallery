import { Segmented } from "../ui/Segmented";
import ThumbImage from "../features/common/ThumbImage";
import { Kbd } from "../ui/Kbd";
import { IconButton } from "../ui/IconButton";
import {SearchField} from "../ui/SearchField";
import {cx} from "../ui/cx";
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
import {
  ArrowRightLineIcon,
  ChevronDownIcon,
  CloseIcon,
  FolderIcon,
  HashIcon,
  HomeIcon,
  ImageIcon,
  LibraryIcon,
  MonitorIcon,
  MoonIcon,
  ReaderIcon,
  RefreshIcon,
  ScanIcon,
  SearchIcon,
  SettingsIcon,
  ShuffleIcon,
  SparkleIcon,
  SunIcon,
  TasksIcon,
} from "../ui/icons";

export type CommandScope = "name" | "content";

export interface CommandQuickAction {
  id: string;
  label: string;
  icon: typeof SearchIcon;
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
  icon: typeof SearchIcon;
  coverId?: string;
  coverVersion?: string;
  shortcut?: string;
  onSelect: () => void;
}

interface CommandSection {
  label: string;
  layout: "covers" | "navigation" | "commands" | "list";
  rows: CommandRow[];
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
    mode === "photo" && (useUIStore.getState().commandScope === "content" || (onResults && params.get("scope") === "content"))
      ? "content"
      : "name",
  );
  const [actionsOpen, setActionsOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const commandGroup = useRef<HTMLDivElement>(null);
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
      icon: HomeIcon,
      label: mode === "comic" ? "漫画首页" : "照片库",
      keywords: ["首页"],
      group: "navigation",
      onSelect: () => navigate(homeRoute(mode)),
    },
    {
      id: "library",
      icon: LibraryIcon,
      label: mode === "comic" ? "书架" : "相册",
      keywords: ["目录"],
      group: "navigation",
      onSelect: () => navigate(libraryRoute(mode)),
    },
    {
      id: "tasks",
      icon: TasksIcon,
      label: "任务中心",
      keywords: ["分析", "任务"],
      group: "navigation",
      onSelect: () => navigate("/tasks/run"),
    },
    ...(onRefresh
      ? [
          {
            id: "refresh",
            icon: RefreshIcon,
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
            icon: ScanIcon,
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
      icon: SettingsIcon,
      label: "设置",
      keywords: ["偏好"],
      shortcut: "Ctrl+,",
      group: "navigation",
      onSelect: () => navigate("/settings"),
    },
    {
      id: "mode",
      icon: mode === "comic" ? ImageIcon : ReaderIcon,
      label: mode === "comic" ? "切换到照片" : "切换到漫画",
      keywords: ["工作台"],
      group: "action",
      onSelect: () => setMode(mode === "comic" ? "photo" : "comic"),
    },
    ...(
      [
        ["light", "浅色", SunIcon],
        ["dark", "深色", MoonIcon],
        ["system", "跟随系统", MonitorIcon],
      ] satisfies [ThemePref, string, typeof SunIcon][]
    ).map(([theme, label, icon]) => ({
      icon,
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
            icon: SparkleIcon,
            label: "随手看看",
            keywords: ["随机照片"],
            group: "navigation" as const,
            onSelect: () => navigate(randomPhotosRoute()),
          },
        ]
      : []),
    {
      id: "shuffle",
      icon: ShuffleIcon,
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
          coverId: hit.coverImage || undefined,
          coverVersion: hit.coverImageVersion,
          icon:
            hit.kind === "smartCollection"
              ? HashIcon
              : hit.kind === "collection"
                ? FolderIcon
                : LibraryIcon,
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
    coverId: card.coverPath,
    coverVersion: card.coverVersion,
    icon: mode === "comic" ? ReaderIcon : LibraryIcon,
    onSelect: () => navigate(card.to),
  }));
  const quickMatches = quickActions.filter(
    ({ label, keywords }) =>
      !term ||
      (scope === "name" &&
        [label, ...keywords].some((word) => word.includes(term))),
  );
  const sections: CommandSection[] = term
    ? [
        { label: "匹配内容", layout: "list", rows: matches },
        {
          label: "快捷操作",
          layout: "list",
          rows: quickMatches,
        },
        {
          label: "搜索",
          layout: "list",
          rows: [
            {
              id: "results",
              icon: ArrowRightLineIcon,
              label: scope === "name" ? "查看全部结果" : "搜索画面与文字",
              onSelect: showResults,
            },
          ],
        },
      ]
    : [
        { label: "最近浏览", layout: "covers", rows: recent },
        {
          label: "快捷导航",
          layout: "navigation",
          rows: quickActions.filter((action) => action.group === "navigation"),
        },
        {
          label: "快捷操作",
          layout: "commands",
          rows: actionsOpen
            ? quickActions.filter((action) => action.group === "action")
            : [],
        },
      ];
  const rows = sections.flatMap((section) => section.rows);
  const activeIndex = rows.findIndex(({ id }) => id === activeId);
  const optionId = (index: number) => `${listId}-${index}`;

  useEffect(() => {
    if (actionsOpen)
      commandGroup.current?.scrollIntoView?.({ block: "nearest" });
  }, [actionsOpen]);

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

  function onPanelKey(event: KeyboardEvent<HTMLElement>) {
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
      className="fixed inset-x-0 top-0 bottom-[var(--keyboard-inset)] z-dialog flex items-start justify-center bg-black/40 px-4 pb-4 pt-[max(8px,env(safe-area-inset-top))] backdrop-blur-[8px] sm:pt-[12dvh]"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label="命令面板"
        className="flex max-h-full w-full max-w-[640px] flex-col overflow-hidden rounded-xl bg-raised shadow-3"
        onKeyDown={onPanelKey}
      >
        <div className="flex shrink-0 items-center gap-1 border-b border-line-subtle px-2">
            <SearchField size="lg" className="min-w-0 flex-1 !bg-transparent focus-within:!shadow-none"
              enterKeyHint="search"
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
                  : `搜索${copy.albumTypeLabel}、标签或命令`
              }
              value={query}
              onValueChange={(value) => {
                setQuery(value);
                setActiveId("");
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Escape") { onPanelKey(event); return; }
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
                  if (term && (event.shiftKey || scope === "content"))
                    showResults();
                  else if (activeIndex >= 0) choose(rows[activeIndex]);
                  else if (matches[0]?.label === term) choose(matches[0]);
                  else showResults();
                }
              }}
            trailing={mode === "photo" && (
            <Segmented<CommandScope>
              className="shrink-0"
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
          )}/>
          <IconButton
            label="关闭命令面板"
            className="text-ink-2"
            onClick={onClose}
          >
            <CloseIcon />
          </IconButton>
        </div>
        <div
          className="min-h-0 overflow-y-auto overscroll-contain px-3 py-3 sm:px-4"
          id={listId}
          role="listbox"
          aria-label="命令与搜索结果"
        >
          {nameSearch && (debounced !== term || suggestions.isFetching) && (
            <p role="status" className="px-3 py-2 text-caption text-ink-3">
              正在搜索…
            </p>
          )}
          {nameSearch && suggestions.isError && (
            <p role="status" className="px-3 py-2 text-caption text-ink-3">
              名称建议读取失败，可打开结果页重试。
            </p>
          )}
          {sections.map(
            ({ label, layout, rows: sectionRows }) =>
              sectionRows.length > 0 && (
                <div
                  key={label}
                  ref={layout === "commands" ? commandGroup : undefined}
                  role="group"
                  aria-label={label}
                  className="mb-4 last:mb-0"
                >
                  <div
                    aria-hidden
                    className="mb-1.5 px-1 text-caption font-medium text-ink-2"
                  >
                    {label}
                  </div>
                  <div className={cx("grid gap-1", layout==="covers" && "grid-flow-col auto-cols-[72px] justify-start gap-2 overflow-x-auto", (layout==="commands" || layout==="navigation") && "grid-cols-2 gap-x-2")} data-layout={layout}>
                    {sectionRows.map((row) => (
                      <button
                        key={row.id}
                        id={optionId(rows.indexOf(row))}
                        type="button"
                        role="option"
                        aria-selected={row.id === activeId}
                        tabIndex={-1}
                        title={row.label}
                        className={cx("flex min-h-11 min-w-0 items-center gap-2 rounded-md px-2 text-left text-label text-ink hover:bg-hover aria-selected:bg-selected aria-selected:ring-1 aria-selected:ring-accent",layout==="covers" && "flex-col items-stretch gap-1 p-1")}
                        onClick={() => choose(row)}
                        onMouseDown={(event) => event.preventDefault()}
                      >
                        <span aria-hidden className={cx("grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-sunken text-ink-2",layout==="covers" && "aspect-square h-auto w-full bg-media",(layout==="commands" || layout==="navigation") && "bg-transparent")}>
                          {row.coverId ? (
                            <ThumbImage
                              key={row.coverId}
                              fileId={row.coverId}
                              version={row.coverVersion}
                              alt=""
                              displayWidth={layout === "covers" ? 128 : 36}
                              className="size-full object-cover"
                            />
                          ) : (
                            <row.icon size={18} />
                          )}
                        </span>
                        <span className="min-w-0 truncate">{row.label}</span>
                        {row.detail && (
                          <span className="ml-auto shrink-0 text-caption text-ink-2">
                            {row.detail}
                          </span>
                        )}
                        {row.shortcut && (
                          <kbd className="ml-auto hidden shrink-0 font-sans text-caption text-ink-3 sm:pointer-fine:inline">
                            {row.shortcut}
                          </kbd>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              ),
          )}
        </div>
        <footer
          className={`shrink-0 items-center gap-3 border-t border-line px-4 text-caption text-ink-2 ${term ? "hidden py-2 pointer-fine:flex" : "flex py-1"}`}
        >
          {!term && (
            <button
              type="button"
              aria-expanded={actionsOpen}
              aria-controls={listId}
              className="mr-auto flex min-h-10 items-center gap-1 rounded-md px-2 text-caption hover:bg-sunken"
              onClick={(event) => {
                setActionsOpen(!actionsOpen);
                setActiveId(
                  !actionsOpen && event.detail === 0
                    ? (quickActions.find((action) => action.group === "action")
                        ?.id ?? "")
                    : "",
                );
                if (event.detail === 0) input.current?.focus();
              }}
            >
              快捷操作
              <ChevronDownIcon
                size={14}
                className={actionsOpen ? "rotate-180" : undefined}
              />
            </button>
          )}
          <span className="hidden pointer-fine:inline">
            <Kbd keys={["↑↓"]} /> 选择
          </span>
          <span className="hidden pointer-fine:inline">
            <Kbd keys={["↵"]} /> 打开
          </span>
          <span className="hidden pointer-fine:inline">
            <Kbd keys={["Esc"]} /> {query ? "清空" : "关闭"}
          </span>
        </footer>
      </div>
    </div>
  );
}
