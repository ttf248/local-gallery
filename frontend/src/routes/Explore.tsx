import { Link } from "react-router-dom";
import { PageHeader } from "../shell/PageHeader";
import EmptyState from "../features/common/EmptyState";
import ErrorBanner from "../features/common/ErrorBanner";
import ExploreSearch from "../features/explore/ExploreSearch";
import YearRibbon from "../features/explore/YearRibbon";
import PeopleRow from "../features/explore/PeopleRow";
import PlaceCards from "../features/explore/PlaceCards";
import ThemeCards from "../features/explore/ThemeCards";
import { useLibraryManifest } from "../hooks/useLibrary";
import { Page } from "../shell/Page";
import { useMediaFeed } from "../hooks/useMediaFeed";

export default function Explore() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const photoAlbumCount = manifest?.statistics.photoAlbumCount ?? 0;
  const comicAlbumCount = manifest?.statistics.comicAlbumCount ?? 0;

  const timeline = useMediaFeed(
    { kind: "photo", scope: "timeline" },
    photoAlbumCount > 0,
  );
  return (
    <Page
      variant="standard"
      className="page-shell explore-page min-h-full pb-12"
    >
      <PageHeader
        title="发现"
        meta={
          photoAlbumCount > 0
            ? timeline.total
              ? "在 " +
                timeline.total.toLocaleString("zh-CN") +
                " 项照片与视频里，按人、地点、时间或画面找。"
              : "按人、地点、时间或画面找照片。"
            : undefined
        }
      />
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
          <ExploreSearch />
          <PeopleRow />
          <PlaceCards />
          <YearRibbon />
          <ThemeCards />
        </>
      ) : null}
    </Page>
  );
}
