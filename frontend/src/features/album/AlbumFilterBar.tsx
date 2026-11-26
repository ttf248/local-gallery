import { FilterDropdown } from "../common";
import type {
  AlbumFilterFacets,
  AlbumFilterUnresolved,
} from "../../api/library";
import {
  albumFilterCount,
  type AlbumFilterState,
} from "../../utils/albumFilter";
import AlbumFilterPanel from "./AlbumFilterPanel";

interface Props {
  compact?: boolean;
  state: AlbumFilterState;
  facets?: AlbumFilterFacets;
  facetsLoading?: boolean;
  facetsError?: boolean;
  retryingFacets?: boolean;
  onRetryFacets?: () => void;
  filterOpen: boolean;
  onFilterOpenChange: (open: boolean) => void;
  /** 当前条件下的照片数。 */
  resultCount: number;
  /** 这本相册里的照片数（不含视频）。 */
  photoCount: number;
  /** 因缺少依据而没能参与筛选的照片数。 */
  unresolved: AlbumFilterUnresolved;
  /** 折叠后藏起来的照片数与组数。 */
  grouped: number;
  groupedGroups: number;
  onChange: (next: AlbumFilterState) => void;
  onClear: () => void;
}

/**
 * 照片墙的筛选条。
 *
 * 它只占一行：照片墙的页头每一行都是照片的位置，筛选入口不能自己
 * 占一行。条件生效时给一枚计数，结果数与「没被算进来」的数量一并
 * 摆在旁边 —— 说不清后一个数字，筛选结果就会被当成全貌。
 */
export default function AlbumFilterBar({
  state,
  compact = false,
  facets,
  facetsLoading,
  facetsError,
  retryingFacets,
  onRetryFacets,
  filterOpen,
  onFilterOpenChange,
  resultCount,
  photoCount,
  unresolved,
  grouped,
  groupedGroups,
  onChange,
  onClear,
}: Props) {
  const count = albumFilterCount(state);
  const filtered = count > 0;
  /* 折叠也是「墙上少了东西」：折叠开着时也要报出现在墙上的张数，
     否则用户看着 136 张照片，条上却写着 159 张。 */
  const reduced = filtered || state.collapse === true;
  const missing = unresolved.total;
  const collapseUsable =
    !facets ||
    (facets.similarity.available && facets.similarity.groupCount > 0);
  const collapseKnown = facets?.similarity.available === true;

  const collapseControl = (!collapseKnown || collapseUsable) && (
    <button
      type="button"
      onClick={() => onChange({ ...state, collapse: !state.collapse })}
      disabled={!collapseUsable}
      aria-pressed={state.collapse === true}
      title={
        collapseUsable
          ? "把相似的照片折成一组，只在墙上留代表照片"
          : "这本相册里还没有相似照片的分析结果"
      }
      className={`btn btn-ghost ${
        state.collapse
          ? "bg-primary/12 text-primary"
          : "text-ink-2 hover:bg-sunken hover:text-ink"
      } disabled:cursor-not-allowed disabled:opacity-50`}
    >
      折叠相似
    </button>
  );
  const summary =
    reduced || missing > 0 ? (
      <span className="text-caption tabular-nums text-ink-3">
        {reduced ? (
          <>
            {resultCount} / {photoCount} 张
          </>
        ) : null}
        {missing > 0 && (
          <span className="ml-1 text-ink-2">· {missing} 张未纳入</span>
        )}
        {state.collapse && grouped > 0 && (
          <span className="ml-1 text-ink-2">
            · 折叠 {groupedGroups} 组 / {grouped} 张
          </span>
        )}
      </span>
    ) : null;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <FilterDropdown
        label="筛选"
        count={count}
        open={filterOpen}
        onOpenChange={onFilterOpenChange}
        panel={
          <>
            <AlbumFilterPanel
              state={state}
              facets={facets}
              facetsLoading={facetsLoading}
              facetsError={facetsError}
              retryingFacets={retryingFacets}
              onRetryFacets={onRetryFacets}
              onChange={onChange}
              onClear={onClear}
              /* 面板底下报的是「照片」：视频不参与筛选，没条件时也不该
               混进这个数里。 */
              resultCount={reduced ? resultCount : photoCount}
            />
            {compact && <div className="lg:hidden">{collapseControl}</div>}
          </>
        }
      />

      {/* 相似折叠只在真有相似组时才摆出来：没有可折叠的东西时，
          给一个点了没反应的开关键只是噪音。 */}
      {compact ? (
        <div className="hidden lg:block">{collapseControl}</div>
      ) : (
        collapseControl
      )}

      {/* 张数只在「墙上真的少了东西」时才报：页头已经写着这本相册有
          多少张，这里再写一遍是同一句话说两遍。而「13 / 20 张」这种
          读数只有筛过或折叠过才带新消息 —— 那时它说的不是重复，
          而是「现在墙上这些是从多少里挑出来的」。 */}
      {summary}

      {filtered && (
        <button
          type="button"
          className={
            compact
              ? "hidden lg:inline-flex btn btn-ghost"
              : "btn-text text-caption text-ink-2 hover:text-ink"
          }
          onClick={onClear}
        >
          清除
        </button>
      )}
    </div>
  );
}
