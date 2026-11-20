import { useMemo } from "react";
import { useLibraryList, listYearGroups } from "../../hooks/useLibraryList";
import YearTimeline from "../home/YearTimeline";
import ErrorBanner from "../common/ErrorBanner";

/**
 * 发现页的时间预览。
 *
 * 年份索引按相册目录名归组，不依赖单独的 AI 分析任务 —— 因此这一档
 * 永远有话说（哪怕库里的目录名里没有年份，那也是一句实话）。
 */
export default function ExploreTimePreview() {
  const query = useLibraryList(
    useMemo(() => ({ kind: "photo" as const, view: "all" as const }), []),
    true,
  );
  const groups = useMemo(
    () => listYearGroups(query.summary, query.query),
    [query.summary, query.query],
  );

  return (
    <section
      className="page-shell page-section"
      aria-labelledby="explore-time"
    >
      <div className="section-heading">
        <h2 id="explore-time" className="section-title">
          时间
        </h2>
        <span className="section-meta">按年份翻</span>
      </div>
      {query.isError ? (
        <ErrorBanner
          onRetry={() => void query.refetch()}
          retrying={query.isFetching}
        >
          年份索引暂时读不出来。
        </ErrorBanner>
      ) : groups.length > 0 ? (
        <YearTimeline groups={groups} showFilter={false} />
      ) : (
        <p className="text-body text-fg-muted">
          目前没有可按年份浏览的分组。这里根据相册目录名提供年份入口，不代表照片没有拍摄日期。
        </p>
      )}
    </section>
  );
}
