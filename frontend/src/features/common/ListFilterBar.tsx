import {Tabs} from "../../ui/Tabs";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { SortKey } from "../../utils/listFilterParams";
import { useUIStore } from "../../store/uiStore";
import { ChevronDownIcon, GridIcon, ListIcon, FilterIcon } from "../../ui/icons";
import { useAppMode } from "../../hooks/useAppMode";
import type { AppMode } from "../../api/library";

// 共享 filter strip: 视图 chips (可选) + 总数 + 排序 + 视图模式
//
// 设计约定（与 .chip / .btn 共享组件层一致）：
// - 所有控件高度统一 30px，文字 13px，激活态 accent-soft + accent 字
// - 左：视图切换；右：最少图数 · 总数 · 排序 · 网格/列表
// - 控件之间用 gap-2 分组，不画分隔线，避免视觉噪声
export interface ListFilterBarProps {
  // 视图 chips (全部 / 文件夹 / 集合 / 标签),不需要就传 undefined
  viewChips?: { key: string; label: string; count?: number }[];
  // 当前激活的 view chip key
  activeViewKey?: string;
  onChangeView?: (key: string) => void;
  // 总数(用于 "共 N 项")
  totalCount: number;
  /** 当前列表按名称筛选的词；全局搜索输入与列表 q 参数相互独立。 */
  filterQuery?: string;
  /** 移除名称筛选。 */
  onClearQuery?: () => void;
  /** 可选的整组筛选清除动作。调用方只在筛选生效时传入。 */
  onClearFilters?: () => void;
  // 显示「最少图数」过滤(默认 true)。如果某页不希望显示(如纯 smart
  // 集合页,过滤不适用),传 false。
  showMinImageFilter?: boolean;
  // 隐藏「网格 / 列表」切换。某些页面只有一种形态（例如照片侧的
  // 「最近浏览」按时间排成一条足迹），摆一个切不动的开关只是噪音。
  hideViewToggle?: boolean;
  /** 隐藏排序。内容自带顺序、或排序不适用于当前视图时使用。 */
  hideSort?: boolean;
  /** 隐藏右侧重复总数。当前视图已有自己的计数口径时使用。 */
  hideTotalCount?: boolean;
  /**
   * 生效的排序与最少图数。
   *
   * 筛选状态在地址里（见 hooks/useListFilters），这条工具条只负责把它
   * 画出来、改回去 —— 它自己不再存一份。
   */
  sort: SortKey;
  onSortChange: (s: SortKey) => void;
  minImageCount: number;
  onMinImageCountChange: (n: number) => void;
  /**
   * 工具条最右端的附加控件（批量选择的「选择」按钮）。
   *
   * 它原来单独占一整行浮在网格上方，一排列表页都多出一枚孤零零的
   * 按钮。放进这条工具条，列表页顶部就只有一行控件。
   */
  trailing?: ReactNode;
  compact?: boolean;
}

export function ListFilterBar({
  viewChips,
  activeViewKey,
  onChangeView,
  totalCount,
  filterQuery,
  onClearQuery,
  onClearFilters,
  showMinImageFilter = true,
  hideViewToggle = false,
  hideSort = false,
  hideTotalCount = false,
  sort,
  onSortChange,
  minImageCount,
  onMinImageCountChange,
  trailing,
  compact = false,
}: ListFilterBarProps) {
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);

  return (
    <div className={compact ? "compact-list-filter" : "page-shell"}>
      <div className="filter-strip flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
        <div className="flex items-center gap-1 flex-wrap min-w-0">
          {filterQuery ? (
            <button
              type="button"
              className="ui-chip"
              onClick={onClearQuery}
              aria-label={`清除名称筛选「${filterQuery}」`}
            >
              <span>名称：{filterQuery}</span>
              <span aria-hidden>×</span>
            </button>
          ) : null}
          {!!viewChips?.length && <Tabs label="内容类型" items={viewChips.map(chip=>({id:chip.key,label:chip.label,count:chip.count}))} value={activeViewKey ?? "all"} onChange={onChangeView}/>}
          {/* 没有视图切换 chip 的页面（如未读 / 最近）：总数靠左，
              避免整条筛选条只剩右半边、左侧空一大片。 */}
          {!hideTotalCount && !viewChips?.length && (
            <span
              className="text-meta text-fg-muted tabular-nums"
              data-testid="filter-bar-count"
            >
              共 {totalCount} 项
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {showMinImageFilter && (
            <MinImageFilter
              value={minImageCount}
              onChange={onMinImageCountChange}
            />
          )}
          {!hideTotalCount &&
          viewChips?.length &&
          totalCount !== viewChips.find((c) => c.key === "all")?.count ? (
            <span
              className="text-meta text-fg-muted tabular-nums"
              data-testid="filter-bar-count"
            >
              共 {totalCount} 项
            </span>
          ) : null}
          {!hideSort && <SortMenu value={sort} onChange={onSortChange} />}
          {onClearFilters ? (
            <button
              type="button"
              className="ui-btn ui-btn--ghost"
              onClick={onClearFilters}
            >
              清除筛选
            </button>
          ) : null}
          {/* 网格 / 列表：一条分段控件（跟主题切换同一套语言）。
              早先两个 30px 的方块各自带一圈边框，激活态只是把底色改成
              --bg-subtle，在浅色画布上几乎看不出差别 —— 两个图标悬在
              筛选条右端像两枚散落的方块。现在轨道有一个底，选中的那一段
              抬起来成为白底深色字。 */}
          {!hideViewToggle && (
            <div
              role="group"
              aria-label="视图模式"
              className="ui-segmented shrink-0"
            >
              <button
                onClick={() => setViewMode("grid")}
                title="网格"
                aria-label="网格视图"
                aria-pressed={viewMode === "grid"}
                className="inline-flex items-center justify-center"
              >
                <GridIcon size={14} />
              </button>
              <button
                onClick={() => setViewMode("list")}
                title="列表"
                aria-label="列表视图"
                aria-pressed={viewMode === "list"}
                className="inline-flex items-center justify-center"
              >
                <ListIcon size={14} />
              </button>
            </div>
          )}
          {trailing}
        </div>
      </div>
    </div>
  );
}

// 排序项：按数量的说法跟着工作台走 —— 照片数「张」，漫画数「页」。
//
// 「按拍摄时间 / 按加入时间」说的也是同一件事的两面：照片侧的日期是
// 拍摄时间（从文件名推断），漫画侧没有拍摄时间，只有目录日期与修改
// 时间。两侧各说各的，别让照片侧也叫「加入」。
function sortOptions(
  mode: AppMode,
): { value: SortKey; label: string; title?: string }[] {
  return [
    { value: "name", label: "按名称" },
    { value: "count", label: mode === "comic" ? "按页数" : "按张数" },
    { value: "recent", label: "按最近改" },
    mode === "comic"
      ? {
          value: "added",
          label: "按加入时间",
          title: "按目录日期排序，没有目录日期时按文件修改时间",
        }
      : {
          value: "added",
          label: "按拍摄时间",
          title: "按拍摄时间排序，没有拍摄时间的相册按文件修改时间",
        },
    { value: "viewed", label: "按最近看" },
  ];
}

function SortMenu({
  value,
  onChange,
}: {
  value: SortKey;
  onChange: (v: SortKey) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionsId = useId();
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (e.target instanceof Node && !ref.current?.contains(e.target))
        setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const { mode } = useAppMode();
  const options = sortOptions(mode);
  const cur = options.find((o) => o.value === value) ?? options[0];

  return (
    <div
      ref={ref}
      className="relative"
      onBlur={(e) => {
        if (
          !(e.relatedTarget instanceof Node) ||
          !e.currentTarget.contains(e.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
        triggerRef.current?.focus();
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="btn btn-sm btn-outline"
        title="排序"
        aria-label="排序"
        aria-expanded={open}
        aria-controls={open ? optionsId : undefined}
      >
        <span>{cur.label}</span>
        <ChevronDownIcon size={11} />
      </button>
      {open && (
        <div
          id={optionsId}
          role="group"
          aria-label="排序选项"
          className="absolute right-0 top-full mt-1.5 min-w-[140px] ui-popover py-1 z-40 fade-up"
        >
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={o.value === value}
              title={o.title}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
                triggerRef.current?.focus();
              }}
              className={`w-full text-left px-3 py-1.5 text-body transition-colors ${
                /* 当前选中的那一项要有底色：只把字色加深的话，
                   一列灰字里夹着一行深字，得逐行读才知道选了哪个。
                   与全局搜索的结果列表同一套高亮。 */
                o.value === value
                  ? "bg-bg-subtle text-fg font-medium"
                  : "text-fg-muted hover:bg-bg-subtle hover:text-fg"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// 最少图数过滤:小尺寸 inline 控件,带「≥」前缀和 Filter 图标。
//
// 未启用时只留一枚漏斗按钮:一排控件里杵着个「≥ 0」读不出任何意思,
// 0 本来就是「不过滤」。点一下才展开数字输入。
// 启用后(≥ N)保持完整形态,旁边一个「×」一键回到不过滤。
//
// 用 popover 数字步进 vs 直接 inline input:本项目用户调这个值的频次
// 极低(设一次就忘),inline 1 个 input 足够,不必为它做一个完整 popover。
function MinImageFilter({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(value));
  const active = value > 0;
  const { mode } = useAppMode();
  // 计数单位跟着工作台走:照片说「张」,漫画说「页」。
  const unit = mode === "comic" ? "页" : "张";
  // 被过滤掉的东西是什么,也跟着工作台走:照片过滤掉的是"照片太少的
  // 相册",漫画是"页数太少的卷"。早先两边都写「册」,照片这边读着像
  // 从漫画那边漏过来的词。
  const label =
    mode === "comic" ? "隐藏少于 N 页的卷" : "隐藏少于 N 张的本相册";
  const inputRef = useRef<HTMLInputElement>(null);
  // 漏斗按钮点开后输入框才挂上来，得主动把焦点送进去，
  // 否则用户还得再点一次才能输数字。
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);
  // 关闭编辑时把 draft 写回 store(允许"键入数字后点别处"这种 commit)
  function commit() {
    const n = parseInt(draft, 10);
    if (Number.isFinite(n) && n >= 0) onChange(n);
    else setDraft(String(value));
    setEditing(false);
  }
  // 未启用且没在编辑:只给一枚漏斗按钮。
  if (!active && !editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          setDraft("0");
        }}
        className="inline-flex items-center justify-center w-[34px] h-[34px] rounded-md border border-border text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors shrink-0"
        title={label}
        aria-label={`最少${unit}数`}
      >
        <FilterIcon size={12} className="shrink-0" />
      </button>
    );
  }
  return (
    <div
      className={`inline-flex items-center gap-1 h-[34px] px-2.5 rounded-md border transition-colors ${
        active
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-border text-fg-muted hover:bg-bg-subtle"
      }`}
      title={label}
    >
      <FilterIcon size={11} className="shrink-0" />
      <span className="text-meta whitespace-nowrap">≥</span>
      <input
        ref={inputRef}
        type="number"
        min={0}
        max={9999}
        value={editing ? draft : value}
        onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
        onFocus={() => {
          setEditing(true);
          setDraft(String(value));
        }}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            setEditing(false);
            setDraft(String(value));
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="w-9 h-7 bg-transparent border-0 outline-none text-meta tabular-nums text-right focus:outline-none"
        aria-label={`最少${unit}数`}
      />
      {active && (
        <button
          onClick={() => onChange(0)}
          className="btn-text text-fg-subtle hover:text-fg text-body leading-none px-0.5"
          title="清除"
          aria-label="清除最小图数"
        >
          ×
        </button>
      )}
    </div>
  );
}
