import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { LIST_PARAM } from "../../utils/listFilterParams";
import { FolderSearchIcon, SearchIcon } from "./Icon";
import { useDebounce } from "../../hooks/useDebounce";
import { useAppMode } from "../../hooks/useAppMode";
import { albumsApi, type SearchHit } from "../../api/albums";
import { aiJobsApi, type AIWorkerStatus } from "../../api/aiJobs";
import RenditionImage from "./RenditionImage";
import SearchScopeMenu from "./SearchScopeMenu";
import {
  albumRoute,
  searchRoute,
  tagRoute,
} from "../../utils/path";
import {
  SEARCH_SCOPE_PARAM,
  searchScopeFromParams,
  type SearchScope,
} from "../../utils/searchScope";
import { albumCountUnit, collectionTypeWord, mediaUnit, workbenchCopy } from "../../utils/workbench";

// 全局搜索框：输入时显示下拉建议（来自后端 /api/search）。
//   - 草稿独立于列表筛选，只有搜索结果页从地址预填
//   - 作用域说清搜的是「容器的名字」还是「照片里的画面与文字」
//   - 回车进入搜索结果页
export default function GlobalSearch() {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { mode } = useAppMode();
  const isSearchPage = location.pathname === searchRoute(mode);
  const routeQuery = isSearchPage ? params.get(LIST_PARAM.query) ?? "" : "";
  // 漫画侧只有名字可搜：内容搜索只查照片。
  const routeScope = mode === "comic" ? "name" : searchScopeFromParams(params);
  const [query, setQuery] = useState(routeQuery);
  const [scope, setScope] = useState<SearchScope>(routeScope);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    // 切到搜索结果页时恢复地址里的关键词与作用域；其他页面不借用列表 q。
    setQuery(routeQuery);
    setScope(routeScope);
  }, [location.pathname, routeQuery, routeScope]);

  /**
   * 换作用域。
   *
   * 在搜索结果页上换，结果也要跟着换 —— 否则顶栏说「正在搜画面」，
   * 页面还摆着名字的结果，两处各说各话。因此那里把作用域写进地址。
   * 其它页面上作用域只是草稿：它决定回车去哪一档的结果页。
   */
  function changeScope(next: SearchScope) {
    setScope(next);
    if (!isSearchPage) return;
    const nextParams = new URLSearchParams(params);
    if (next === "content") nextParams.set(SEARCH_SCOPE_PARAM, "content");
    else nextParams.delete(SEARCH_SCOPE_PARAM);
    setParams(nextParams, { replace: true });
  }

  // 叶级目录两侧都叫「相册」：一个词，不必按侧记两套。
  const albumWord = workbenchCopy(mode).albumTypeLabel;
  const debounced = useDebounce(query, 200);
  const searchTerm = debounced.trim();
  const searchEnabled = searchTerm.length >= 2;
  const nameScope = scope === "name";
  const searchQuery = useQuery({
    queryKey: ["library", "search", mode, searchTerm, 10],
    queryFn: () => albumsApi.search(searchTerm, mode, 10),
    enabled: nameScope && searchEnabled,
    staleTime: 30_000,
    retry: false,
  });
  const hits = nameScope ? (searchQuery.data?.results ?? []) : [];
  // 内容搜索的运行环境：模型没就绪或还没建索引时，先说清楚，
  // 别让用户以为库里没有那张照片。
  const embeddingStatus = useQuery({
    queryKey: ["ai-embedding-status"],
    queryFn: aiJobsApi.embeddingStatus,
    enabled: !nameScope && open && searchEnabled,
    staleTime: 30_000,
    retry: false,
  });

  useEffect(() => {
    // 不默认选中第一条。
    //
    // 选中态是「用户正在挑哪一条」：回车应当落到**看得见结果的那一页**，
    // 而不是直接打开列表里的第一项 —— 那等于用户没挑就替他挑了。
    // 用方向键往下走才进入逐条挑选。
    setActiveIndex(-1);
  }, [searchTerm, hits.length, scope]);

  function onPick(hit: SearchHit) {
    setOpen(false);
    setActiveIndex(-1);
    setQuery("");
    if (hit.kind === "smartCollection" && hit.path.startsWith("smart:")) {
      navigate(tagRoute(mode, hit.path.slice("smart:".length)));
      return;
    }
    navigate(albumRoute(mode, hit.path));
  }

  function moveActive(step: -1 | 1) {
    if (hits.length === 0) return;
    setOpen(true);
    setActiveIndex((index) => {
      const next = index < 0 ? (step > 0 ? 0 : hits.length - 1) : index + step;
      return (next + hits.length) % hits.length;
    });
  }

  const inputLabel = nameScope
    ? `搜索${albumWord}或标签`
    : "搜索照片里的画面与文字";
  const placeholder = nameScope
    ? `搜索${albumWord} / 标签…`
    : "描述画面，或输入照片里的文字…";

  return (
    <div className="relative w-full max-w-[480px] min-w-0">
      {/* 搜索框：浅灰底 + 一圈极淡的描边，指针落进去时底色换成面板白、
          描边换成强调色 —— 聚焦的那一刻背景先变白，焦点才真的看得见。
          圆角与控件同档（10px），不再是药丸。 */}
      <div className="toolbar-search input-focus-ring flex items-center gap-1.5 bg-bg-subtle rounded-md px-3 border border-border-faint focus-within:bg-bg-elevated focus-within:border-accent min-w-0">
        <SearchScopeMenu
          value={scope}
          onChange={(next) => {
            changeScope(next);
            setOpen(true);
            setActiveIndex(-1);
          }}
          options={
            mode === "comic"
              ? [{ value: "name", label: "名称", hint: "作品、卷与标签的名字" }]
              : undefined
          }
        />
        <SearchIcon size={15} className="text-fg-subtle shrink-0" />
        <input
          value={query}
          aria-label={inputLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            switch (e.key) {
              case "ArrowDown":
                if (!nameScope) return;
                e.preventDefault();
                moveActive(1);
                break;
              case "ArrowUp":
                if (!nameScope) return;
                e.preventDefault();
                moveActive(-1);
                break;
              case "Enter": {
                const activeHit = hits[activeIndex];
                if (open && activeHit) {
                  e.preventDefault();
                  onPick(activeHit);
                } else {
                  setOpen(false);
                  // 回车没有命中：进结果页。
                  //
                  // 以前是带着关键词回首页 —— 而首页那一段是智能相册预览，
                  // 搜到的相册被一片不相关的推荐盖住了，用户看不见自己
                  // 搜到了什么。回车必须落在**看得见结果**的页面上。
                  const target = new URLSearchParams();
                  if (query) target.set(LIST_PARAM.query, query);
                  if (!nameScope) target.set(SEARCH_SCOPE_PARAM, "content");
                  const search = target.toString();
                  navigate(`${searchRoute(mode)}${search ? `?${search}` : ""}`);
                }
                break;
              }
              case "Escape":
                setOpen(false);
                setActiveIndex(-1);
                setQuery("");
                break;
            }
          }}
          placeholder={placeholder}
          /* h-full：输入框本身要撑满 40px 的胶囊。外壳是 h-10，输入框却
             只有内容高度（23px）—— 真正能点到的只有中间那一小条，
             低于 28px 的触控下限。 */
          className="flex-1 min-w-0 h-full bg-transparent border-0 outline-none text-body placeholder:text-fg-subtle"
          role="combobox"
          aria-autocomplete="list"
          aria-controls="global-search-results"
          aria-expanded={open && searchEnabled}
          aria-activedescendant={
            activeIndex >= 0 ? `global-search-result-${activeIndex}` : undefined
          }
        />
        <kbd className="hidden sm:inline-flex kbd">/</kbd>
      </div>

      {open && nameScope && hits.length > 0 && (
        <div
          id="global-search-results"
          role="listbox"
          /* 结果多时下拉会长到半屏，把整页盖住。限高并自己滚动，
             搜索框下方始终留得住当前页的上下文。 */
          className="absolute top-full left-0 right-0 mt-1.5 max-h-[min(60vh,420px)] overflow-y-auto overscroll-contain bg-bg-elevated border border-border rounded-lg shadow-lg z-30 fade-up py-1"
        >
          {hits.map((h, index) => (
            <button
              key={h.path}
              onMouseDown={() => onPick(h)}
              id={`global-search-result-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex items-center gap-3 w-full px-3 py-2 text-left transition-colors ${
                // 首末两行跟着面板的圆角走：面板 overflow-hidden，
                // 选中的高亮是直角矩形，不修的话会在圆角处露出一个方角。
                index === 0 ? "rounded-t-lg" : ""
              } ${index === hits.length - 1 ? "rounded-b-lg" : ""} ${
                index === activeIndex
                  ? "bg-bg-subtle text-fg"
                  : "hover:bg-bg-subtle"
              }`}
            >
              {h.coverImage ? (
                <RenditionImage
                  fileId={h.coverImage}
                  version={h.coverImageVersion}
                  alt=""
                  displayWidth={32}
                  /* 漫画侧也是一本书（竖版 + 装订边），与网格卡同一套语言。
                     32px 宽的缩略图上装订边只剩一条黑线，看着像划痕，
                     因此这里只保留不对称的圆角轮廓。 */
                  className={`w-8 h-10 object-cover ${
                    mode === "comic"
                      ? "rounded-[4px_7px_7px_4px]"
                      : "rounded border border-border-faint"
                  }`}
                />
              ) : (
                <div
                  className={`w-8 h-10 bg-bg-subtle ${
                    mode === "comic"
                      ? "rounded-[4px_7px_7px_4px]"
                      : "rounded border border-border-faint"
                  }`}
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="text-body truncate">{h.name}</div>
                <div className="text-meta text-fg-subtle truncate">
                  {/* 类型词跟着工作台走：照片侧的中间目录叫「文件夹」，
                      漫画侧叫「作品」—— 与那一侧结构页的眉标同一个词。
                      同名的两个结果（同名相册与同名文件夹）靠它才分得开。 */}
                  {h.kind === "album"
                    ? h.virtual
                      ? "散图"
                      : "相册"
                    : h.kind === "smartCollection"
                      ? "标签"
                      : collectionTypeWord(mode)}
                  {" · "}
                  {/* 计数与单位单独成节点：单位跟着当前工作台走
                      （照片「张 / 本」，漫画「页 / 卷」）。 */}
                  <span>
                    {h.count}{" "}
                    {h.kind === "album"
                      ? mediaUnit(mode)
                      : albumCountUnit(mode)}
                  </span>
                </div>
              </div>
            </button>
          ))}
          {/* 面板底部：名字搜索与内容搜索的关系。
              两者检索的东西不一样（名字 vs 画面与图片文字），共用一个输入框
              会让人以为搜不到就是没有。这里给一枚直接切换作用域的入口 ——
              作用域本身由输入框左边那枚按钮说明，这一行不再重复一遍
              「内容」两个字。 */}
          {mode === "photo" ? (
            <div className="mt-1 border-t border-border-faint">
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  setOpen(false);
                  setScope("content");
                  setQuery("");
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-body text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors"
              >
                <FolderSearchIcon size={14} className="shrink-0" />
                <span>改搜照片里的画面与文字</span>
              </button>
            </div>
          ) : null}
        </div>
      )}

      {/* 内容搜索：没有逐条建议可给，但要说清现在能不能搜。
          搜的是哪一类由输入框左边的作用域按钮与输入框里的提示词说了，
          这里只补运行状态 —— 同一句话不在一处说两遍。 */}
      {open && !nameScope && searchEnabled && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-30 fade-up">
          <div className="px-3 py-2.5">
            <p className="text-meta text-fg-muted">
              {contentScopeNote(
                embeddingStatus.data?.status,
                embeddingStatus.isError,
              )}
            </p>
          </div>
        </div>
      )}

      {/* 无结果提示：用户至少敲了 2 个字符才显示，避免抖动 */}
      {open && nameScope && searchEnabled && searchQuery.isFetching && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-30 fade-up">
          <div className="px-3 py-2.5 text-meta text-fg-muted">搜索中…</div>
        </div>
      )}

      {open && nameScope && searchEnabled && searchQuery.isError && !searchQuery.isFetching && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-30 fade-up">
          <div className="px-3 py-2.5 text-meta text-fg-muted">
            搜索暂不可用，请稍后重试
          </div>
        </div>
      )}

      {/* 无结果提示：用户至少敲了 2 个字符且请求完成才显示，避免把加载误报为无结果。 */}
      {open && nameScope && searchEnabled && !searchQuery.isFetching && !searchQuery.isError && hits.length === 0 && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-bg-elevated border border-border rounded-lg shadow-lg overflow-hidden z-30 fade-up">
          <div className="px-3 py-2.5 text-meta text-fg-muted">
            没有匹配「{searchTerm}」的{albumWord}或标签
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 内容搜索这一档现在能不能搜。
 *
 * 三种情况说三句话：没就绪、还没建索引、可以搜。用户按下回车之前
 * 就该知道这一档能不能给出结果 —— 否则搜不到会被误读成「库里没有」。
 */
function contentScopeNote(
  status: AIWorkerStatus | undefined,
  failed: boolean,
): string {
  if (failed) return "本机分析状态暂时读不出来，可以先到任务中心看看。";
  if (!status) return "正在检查本机的画面索引…";
  if (!status.runtimeReady || !status.modelValid) {
    return "本机画面模型还没就绪，现在只能按图片里的文字找。";
  }
  if (status.coverage.total > 0 && status.coverage.indexed === 0) {
    return "还没有建立画面索引，先到任务中心运行一次向量任务。";
  }
  return `已索引 ${status.coverage.indexed.toLocaleString()} / ${status.coverage.total.toLocaleString()} 张，回车查看结果。`;
}
