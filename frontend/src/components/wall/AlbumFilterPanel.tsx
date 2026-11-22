import { useMemo, useState } from "react";
import type { AlbumFilterFacets } from "../../api/library";
import ErrorBanner from "../common/ErrorBanner";
import Segmented from "../common/Segmented";
import {
  albumMonthInRange,
  albumMonthRange,
  albumYearLabel,
  albumYearRange,
  type AlbumFilterState,
} from "../../utils/albumFilter";

interface Props {
  state: AlbumFilterState;
  facets?: AlbumFilterFacets;
  facetsLoading?: boolean;
  facetsError?: boolean;
  retryingFacets?: boolean;
  onRetryFacets?: () => void;
  onChange: (next: AlbumFilterState) => void;
  onClear: () => void;
  /** 筛选后留下的照片数。 */
  resultCount: number;
}

/** 一段标题：说明这一段管的是什么。 */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-0.5 pb-1.5 pt-3 text-meta font-medium text-fg-subtle first:pt-0">
      {children}
    </div>
  );
}

/** 一句说明：这一段现在为什么不能用。 */
function Reason({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-0.5 py-1 text-meta leading-relaxed text-fg-subtle">
      {children}
    </p>
  );
}

/**
 * 照片墙的筛选面板。
 *
 * 每一段只摆这本相册里真实存在的选项：没跑过分析的那一段不摆按钮，
 * 直接写清为什么不能用 —— 摆一个点下去空空如也的按钮，比不摆更糟。
 */
export default function AlbumFilterPanel({
  state,
  facets,
  facetsLoading = false,
  facetsError = false,
  retryingFacets = false,
  onRetryFacets,
  onChange,
  onClear,
  resultCount,
}: Props) {
  const [openYear, setOpenYear] = useState<string | null>(null);

  const years = useMemo(() => {
    const grouped = new Map<string, { month: string; count: number }[]>();
    for (const bucket of facets?.time.months ?? []) {
      const year = bucket.month.slice(0, 4);
      const list = grouped.get(year) ?? [];
      list.push(bucket);
      grouped.set(year, list);
    }
    return [...grouped.entries()].sort((left, right) =>
      right[0].localeCompare(left[0]),
    );
  }, [facets]);

  const togglePerson = (personId: string) => {
    onChange(
      state.personId === personId
        ? { ...state, personId: undefined }
        : { ...state, personId },
    );
  };

  const togglePlace = (adcode: number) => {
    onChange(
      state.adcode === adcode
        ? { ...state, adcode: undefined }
        : { ...state, adcode },
    );
  };

  const selectYear = (year: string) => {
    // 整年已经选中时再点一次是取消；否则一律选整年 ——
    // 上一次选的是这年里的某个月时，点年份要的是整年，不是取消。
    if (state.from === `${year}-01` && state.to === `${year}-12`) {
      onChange({ ...state, from: undefined, to: undefined });
      setOpenYear(null);
      return;
    }
    onChange({ ...state, ...albumYearRange(year) });
    setOpenYear(year);
  };

  const selectMonth = (month: string) => {
    if (state.from === month && state.to === month) {
      onChange({ ...state, from: undefined, to: undefined });
      return;
    }
    onChange({ ...state, ...albumMonthRange(month) });
  };

  return (
    <div>
      <div className="flex items-center justify-between pb-1">
        <span className="text-label text-fg">筛选照片</span>
        <button
          type="button"
          className="btn-text text-meta text-fg-muted hover:text-fg"
          onClick={onClear}
        >
          清除全部
        </button>
      </div>

      {facetsError ? (
        <ErrorBanner
          kind={facets ? "warning" : "danger"}
          className="mb-2"
          onRetry={onRetryFacets}
          retrying={retryingFacets}
        >
          {facets
            ? "筛选条件更新失败，仍显示上次读取到的内容。"
            : "筛选条件读取失败。"}
        </ErrorBanner>
      ) : null}
      {facetsLoading && !facets ? (
        <Reason>正在读取这本相册的筛选条件…</Reason>
      ) : null}

      {/* 面板要能整个落在视口里：窄屏上它下面就是照片墙，
          盖住自己的入口比内容多几行更糟。 */}
      <div className="max-h-[min(56vh,460px)] overflow-y-auto pr-0.5">
        <SectionTitle>拍摄时间</SectionTitle>
        {!facets ? null : !facets.time.available ? (
          <Reason>{facets.time.reason}</Reason>
        ) : (
          <div className="space-y-0.5">
            {years.map(([year, months]) => {
              const selected =
                state.from?.startsWith(year) || state.to?.startsWith(year);
              const expanded = openYear === year || selected;
              return (
                <div key={year}>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => selectYear(year)}
                      className={`flex-1 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
                        selected
                          ? "bg-accent/12 text-accent"
                          : "text-fg hover:bg-bg-subtle"
                      }`}
                      aria-pressed={selected}
                    >
                      {albumYearLabel(year)}
                    </button>
                    <button
                      type="button"
                      className="rounded-md p-1 text-fg-subtle transition-colors hover:bg-bg-subtle hover:text-fg"
                      onClick={() =>
                        setOpenYear(expanded && openYear === year ? null : year)
                      }
                      aria-expanded={expanded}
                      aria-label={`${expanded ? "收起" : "展开"}${albumYearLabel(year)}的月份`}
                    >
                      <span
                        className={`block transition-transform ${expanded ? "rotate-90" : ""}`}
                      >
                        ›
                      </span>
                    </button>
                  </div>
                  {expanded && (
                    <div className="mt-0.5 flex flex-wrap gap-1 pl-2">
                      {months.map((bucket) => {
                        const active =
                          state.from === bucket.month &&
                          state.to === bucket.month;
                        const inRange = albumMonthInRange(state, bucket.month);
                        return (
                          <button
                            key={bucket.month}
                            type="button"
                            onClick={() => selectMonth(bucket.month)}
                            aria-pressed={active}
                            className={`rounded-md px-2 py-1 text-meta tabular-nums transition-colors ${
                              active
                                ? "bg-accent/12 text-accent"
                                : inRange
                                  ? "text-fg hover:bg-bg-subtle"
                                  : "text-fg-subtle hover:bg-bg-subtle"
                            }`}
                          >
                            {Number(bucket.month.slice(5, 7))}月 ·{" "}
                            {bucket.count}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <SectionTitle>人物</SectionTitle>
        {!facets ? null : !facets.people.available ? (
          <Reason>{facets.people.reason}</Reason>
        ) : (
          <div className="max-h-[160px] space-y-0.5 overflow-y-auto">
            {facets.people.items.map((person) => {
              const active = state.personId === person.id;
              return (
                <button
                  key={person.id}
                  type="button"
                  onClick={() => togglePerson(person.id)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
                    active
                      ? "bg-accent/12 text-accent"
                      : "text-fg hover:bg-bg-subtle"
                  }`}
                >
                  <span className="truncate">{person.name}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">
                    {person.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <SectionTitle>地点</SectionTitle>
        {!facets ? null : !facets.places.available ? (
          <Reason>{facets.places.reason}</Reason>
        ) : (
          <div className="max-h-[160px] space-y-0.5 overflow-y-auto">
            {facets.places.items.map((place) => {
              const active = state.adcode === place.adcode;
              return (
                <button
                  key={place.adcode}
                  type="button"
                  onClick={() => togglePlace(place.adcode)}
                  aria-pressed={active}
                  className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-meta transition-colors ${
                    active
                      ? "bg-accent/12 text-accent"
                      : "text-fg hover:bg-bg-subtle"
                  }`}
                >
                  <span className="truncate">{place.name}</span>
                  <span className="shrink-0 tabular-nums text-fg-subtle">
                    {place.count}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <SectionTitle>精选</SectionTitle>
        <Segmented
          label="精选口径"
          value={state.picks ?? "all"}
          onChange={(value) =>
            onChange({
              ...state,
              picks: value === "all" ? undefined : (value as "only" | "none"),
            })
          }
          options={[
            { label: "全部", value: "all" },
            { label: "已精选", value: "only" },
            { label: "未精选", value: "none" },
          ]}
        />

        <SectionTitle>画面</SectionTitle>
        {!facets ? null : !facets.groupPhotos.available &&
          !facets.similarity.available ? (
          <Reason>
            {facets.groupPhotos.reason || facets.similarity.reason}
          </Reason>
        ) : (
          <Segmented
            label="画面口径"
            value={state.scene ?? "all"}
            onChange={(value) =>
              onChange({
                ...state,
                scene:
                  value === "all"
                    ? undefined
                    : (value as "groupPhoto" | "similar"),
              })
            }
            options={[
              { label: "全部", value: "all" },
              {
                label: "合照",
                value: "groupPhoto",
                disabled: !facets.groupPhotos.available,
                title: facets.groupPhotos.available
                  ? `这本相册里有 ${facets.groupPhotos.count} 张合照`
                  : facets.groupPhotos.reason,
              },
              {
                label: "相似照片",
                value: "similar",
                disabled: !facets.similarity.available,
                title: facets.similarity.available
                  ? `这本相册里有 ${facets.similarity.photoCount} 张属于相似组`
                  : facets.similarity.reason,
              },
            ]}
          />
        )}
      </div>

      <div className="mt-2 border-t border-border-faint pt-2 text-meta text-fg-subtle">
        看到 {resultCount} 张
      </div>
    </div>
  );
}
