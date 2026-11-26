import { ExploreSection, PreviewSkeleton } from "./ExploreSection";
import { ScrollRow } from "../../ui/ScrollRow";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaFeed } from "../../hooks/useMediaFeed";
import { InlineAlert } from "../../ui/InlineAlert";

/**
 * 发现页的时间预览。
 *
 * 年份索引直接取自照片时间线：年份、数量和点击后的照片范围都按单张
 * 媒体的日期证据计算。只有年份精度的媒体也计入对应年份，不补月份。
 *
 * 年份没有封面 —— 时间线索引只给年份与数量，给不出这一年的代表照。
 * 与其摆一块空框或一枚文件夹图标（读起来像「这里缺一张图」），不如把
 * 年份本身当成画面：数字占住与照片卡一样的那块方框，年份是索引，
 * 照片是内容，两者在页面上分得开。
 */
export default function YearRibbon() {
  const navigate = useNavigate();
  const query = useMediaFeed(
    useMemo(() => ({ kind: "photo" as const, scope: "timeline" as const }), []),
  );

  return (
    <ExploreSection
      id="explore-time"
      title="时间"
      to={"/photo"}
      linkLabel="时间线"
    >
      {query.isError ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        >
          年份索引暂时读不出来。
        </InlineAlert>
      ) : query.isPending ? (
        <PreviewSkeleton label="正在读取年份索引…" shape="year" />
      ) : query.years.length > 0 ? (
        <ScrollRow label="按年份浏览" gap={0} data-testid="year-timeline">
          {query.years.map((year) => (
            <button
              key={year.year}
              type="button"
              className="group/year flex h-[72px] w-28 shrink-0 flex-col justify-center border-l border-line px-3 text-left first:border-l-0"
              onClick={() => navigate("/photo?year=" + year.year)}
            >
              <span className="flex items-center gap-2 text-[28px] leading-tight text-fg-muted tabular-nums group-hover/year:text-fg">
                {year.year}
                {year.year === new Date().getFullYear() && (
                  <span
                    aria-label="今年"
                    className="size-1.5 rounded-full bg-signal"
                  />
                )}
              </span>
              <span className="text-caption tabular-nums text-fg-muted">
                {year.count.toLocaleString("zh-CN")} 张
              </span>
              <span
                aria-hidden
                className="mt-1 h-0.5 w-5 bg-fg opacity-0 group-hover/year:opacity-100 group-focus-visible/year:opacity-100"
              />
            </button>
          ))}
        </ScrollRow>
      ) : (
        <p className="text-body text-fg-muted">
          目前没有带日期证据的年份。只有文件修改时间的媒体不会归入某一年，可在照片页的「日期未知」中查看。
        </p>
      )}
    </ExploreSection>
  );
}
