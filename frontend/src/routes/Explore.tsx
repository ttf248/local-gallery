import { Link } from "react-router-dom";
import {PageHeader} from "../shell/PageHeader";
import EmptyState from "../features/common/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import ExploreSearchHero from "../components/explore/ExploreSearchHero";
import ExploreTimePreview from "../components/explore/ExploreTimePreview";
import ExplorePeoplePreview from "../components/explore/ExplorePeoplePreview";
import ExplorePlacePreview from "../components/explore/ExplorePlacePreview";
import ExploreThemePreview from "../components/explore/ExploreThemePreview";
import { useLibraryManifest } from "../hooks/useLibrary";
import "../styles/explore.css";

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
 * 第一屏先给**找法**：一个 52px 的搜索入口（名字 / 画面与文字两档）
 * 加四个维度。下面是各维度的预览 —— 四段共用一套发现卡（一样的方块
 * 画面、一样的标题与说明位置），而不是四种排法各摆一段。
 *
 * 页面用 Standard 容器：它是内容页，不是照片墙，也不是工作台首页。
 */
export default function Explore() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const photoAlbumCount = manifest?.statistics.photoAlbumCount ?? 0;
  const comicAlbumCount = manifest?.statistics.comicAlbumCount ?? 0;

  return (
    <div className="explore-page min-h-full">
      <div className="page-shell container--standard">
        <div className="explore-heading">
          <PageHeader
  title="发现"
/>
        </div>

        {manifestQuery.isLoading && !manifest ? (
          <section className="page-section" aria-live="polite">
            <p className="text-body text-fg-muted">正在读取照片库信息…</p>
          </section>
        ) : null}

        {manifestQuery.isError && !manifest ? (
          <section className="page-section">
            <ErrorBanner
              onRetry={() => void manifestQuery.refetch()}
              retrying={manifestQuery.isFetching}
            >
              照片库信息暂时读不出来。
            </ErrorBanner>
          </section>
        ) : null}

        {manifest && manifestQuery.isError ? (
          <section className="pt-4">
            <ErrorBanner
              onRetry={() => void manifestQuery.refetch()}
              retrying={manifestQuery.isFetching}
            >
              照片库信息更新失败，下面仍显示上次读取到的内容。
            </ErrorBanner>
          </section>
        ) : null}

        {manifest && photoAlbumCount === 0 ? (
          <section className="page-section">
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
            <ExploreSearchHero />
            {/* 四个找法在一屏之内：想直接跳到某一维，不必往下翻。 */}
            <nav aria-label="发现维度" className="explore-dimensions">
              <ul className="flex flex-wrap justify-center gap-2">
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
    </div>
  );
}
