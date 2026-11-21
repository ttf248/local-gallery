import { useMemo } from "react";
import { useMediaFeed } from "../../hooks/useMediaFeed";
import YearTimeline from "../home/YearTimeline";
import ErrorBanner from "../common/ErrorBanner";

/**
 * 发现页的时间预览。
 *
 * 年份索引直接取自照片时间线：年份、数量和点击后的照片范围都按单张
 * 媒体的日期证据计算。只有年份精度的媒体也计入对应年份，不补月份。
 */
export default function ExploreTimePreview() {
  const query = useMediaFeed(
    useMemo(() => ({ kind: "photo" as const, scope: "timeline" as const }), []),
  );

  return (
    <section className="page-shell page-section" aria-labelledby="explore-time">
      <div className="section-heading">
        <h2 id="explore-time" className="section-title">
          时间
        </h2>
        <span className="section-meta">按时间证据</span>
      </div>
      {query.isError ? (
        <ErrorBanner
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        >
          年份索引暂时读不出来。
        </ErrorBanner>
      ) : query.isPending ? (
        <p className="text-body text-fg-muted">正在读取年份索引…</p>
      ) : query.years.length > 0 ? (
        <YearTimeline timelineYears={query.years} showFilter={false} />
      ) : (
        <p className="text-body text-fg-muted">
          目前没有带日期证据的年份。只有文件修改时间的媒体不会归入某一年，可在照片页的「日期未知」中查看。
        </p>
      )}
    </section>
  );
}
