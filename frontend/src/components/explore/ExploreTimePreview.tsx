import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useMediaFeed } from "../../hooks/useMediaFeed";
import ErrorBanner from "../../features/common/ErrorBanner";

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
export default function ExploreTimePreview() {
  const navigate = useNavigate();
  const query = useMediaFeed(
    useMemo(() => ({ kind: "photo" as const, scope: "timeline" as const }), []),
  );

  return (
    <section className="page-section" aria-labelledby="explore-time">
      <div className="section-heading">
        <h2 id="explore-time" className="section-title">
          时间
        </h2>
        <span className="section-meta">按日期证据</span>
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
        <div className="explore-strip" data-testid="year-timeline">
          {query.years.map((year) => (
            <button
              key={year.year}
              type="button"
              className="explore-card"
              onClick={() => navigate(`/photo?year=${year.year}`)}
            >
              <span className="explore-card__media explore-card__media--plate">
                <span className="explore-year__numeral">{year.year}</span>
              </span>
              <span className="explore-card__meta">
                {year.count.toLocaleString("zh-CN")} 张
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="text-body text-fg-muted">
          目前没有带日期证据的年份。只有文件修改时间的媒体不会归入某一年，可在照片页的「日期未知」中查看。
        </p>
      )}
    </section>
  );
}
