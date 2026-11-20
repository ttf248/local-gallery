import { Link } from "react-router-dom";
import PageHeading from "../components/common/PageHeading";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import ExploreSearchHero from "../components/explore/ExploreSearchHero";
import ExploreTimePreview from "../components/explore/ExploreTimePreview";
import ExplorePeoplePreview from "../components/explore/ExplorePeoplePreview";
import ExplorePlacePreview from "../components/explore/ExplorePlacePreview";
import ExploreThemePreview from "../components/explore/ExploreThemePreview";
import { useLibraryManifest } from "../hooks/useLibrary";

/** 顶部的四个找法：滚到对应的预览。 */
const FINDINGS = [
  { id: "explore-time", label: "时间" },
  { id: "explore-people", label: "人物" },
  { id: "explore-place", label: "地点" },
  { id: "explore-theme", label: "主题" },
];

/**
 * 发现页：我要找什么。
 *
 * 第一屏先给**找法**：一个搜索入口（名字 / 画面与文字两档）加四个维度。
 * 下面才是各维度的紧凑预览 —— 预览是给人看的线索，不是这一页的主角。
 *
 * 以前这一页是五个板块顺排，头一个板块就占了整屏；现在人物预览是一排
 * 小头像，主题预览是一行行的事，地点预览是一格格地名：找法在一屏之内
 * 看得完，剩下的可以再往下翻。
 */
export default function Explore() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const photoAlbumCount = manifest?.statistics.photoAlbumCount ?? 0;
  const comicAlbumCount = manifest?.statistics.comicAlbumCount ?? 0;

  return (
    <div className="min-h-full">
      <PageHeading
        title="发现"
        eyebrow="换个找法"
        description="照片不只按文件夹摆着。它们还按时间、人、地方和画面里的内容聚在一起。"
      />

      {manifestQuery.isLoading && !manifest ? (
        <section className="page-shell page-section" aria-live="polite">
          <p className="text-body text-fg-muted">正在读取照片库信息…</p>
        </section>
      ) : null}

      {manifestQuery.isError && !manifest ? (
        <section className="page-shell page-section">
          <ErrorBanner
            onRetry={() => void manifestQuery.refetch()}
            retrying={manifestQuery.isFetching}
          >
            照片库信息暂时读不出来。
          </ErrorBanner>
        </section>
      ) : null}

      {manifest && manifestQuery.isError ? (
        <section className="page-shell pt-4">
          <ErrorBanner
            onRetry={() => void manifestQuery.refetch()}
            retrying={manifestQuery.isFetching}
          >
            照片库信息更新失败，下面仍显示上次读取到的内容。
          </ErrorBanner>
        </section>
      ) : null}

      {manifest && photoAlbumCount === 0 ? (
        <section className="page-shell page-section">
          <EmptyState
            title="照片库还没有相册"
            description={
              comicAlbumCount > 0
                ? "当前媒体库只有漫画相册。照片的发现结果只统计照片目录；可以切换到漫画工作台继续阅读。"
                : "先添加照片目录并完成扫描，这里才会出现时间、人物、地点和主题。"
            }
            icon={<span aria-hidden="true">▧</span>}
            action={
              <div className="flex flex-wrap items-center justify-center gap-3">
                {comicAlbumCount > 0 ? (
                  <Link className="btn btn-outline" to="/comic">
                    去漫画库看看
                  </Link>
                ) : null}
                <Link className="btn btn-primary" to="/settings/data">
                  设置照片目录
                </Link>
              </div>
            }
          />
        </section>
      ) : null}

      {manifest && photoAlbumCount > 0 ? (
        <>
          <div className="page-shell">
            <ExploreSearchHero />
          </div>
          {/* 四个找法在一屏之内：想直接跳到某一维，不必往下翻。 */}
          <nav
            aria-label="发现维度"
            className="page-shell page-section pt-4"
          >
            <ul className="flex flex-wrap gap-2">
              {FINDINGS.map((finding) => (
                <li key={finding.id}>
                  <a className="chip" href={`#${finding.id}`}>
                    {finding.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <ExploreTimePreview />
          <ExplorePeoplePreview />
          <ExplorePlacePreview />
          <ExploreThemePreview />
        </>
      ) : null}
    </div>
  );
}
