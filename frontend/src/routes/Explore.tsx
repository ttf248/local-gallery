import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import PageHeading from "../components/common/PageHeading";
import SmartAlbumPreview, {
  HOME_SMART_ALBUM_PREVIEW,
} from "../components/home/SmartAlbumPreview";
import YearTimeline from "../components/home/YearTimeline";
import EmptyState from "../components/common/EmptyState";
import ErrorBanner from "../components/common/ErrorBanner";
import RenditionImage from "../components/common/RenditionImage";
import { aiJobsApi, type AIJob } from "../api/aiJobs";
import { albumsApi } from "../api/albums";
import { useLibraryList, listYearGroups } from "../hooks/useLibraryList";
import { useLibraryManifest } from "../hooks/useLibrary";
import {
  smartAlbumQueryKeys,
  useSmartAlbumDirectory,
} from "../hooks/useSmartAlbums";
import {
  peopleRoute,
  semanticSearchRoute,
  smartAlbumsRoute,
  travelsRoute,
} from "../utils/path";

/** 探索页：以照片库统计为准，避免漫画内容被算进照片探索。 */
export default function Explore() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const photoAlbumCount = manifest?.statistics.photoAlbumCount ?? 0;
  const comicAlbumCount = manifest?.statistics.comicAlbumCount ?? 0;

  return (
    <div className="min-h-full">
      <PageHeading
        title="探索"
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
                ? "当前媒体库只有漫画相册。照片探索只统计照片目录；可以切换到漫画工作台继续阅读。"
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
          <TimeSection />
          <PeopleSection />
          <PlaceSection />
          <ThemeSection />
          <ContentSearchSection />
        </>
      ) : null}
    </div>
  );
}

/** 时间索引按相册目录名的年份归组，不依赖单独的 AI 分析任务。 */
function TimeSection() {
  const query = useLibraryList(
    useMemo(() => ({ kind: "photo" as const, view: "all" as const }), []),
    true,
  );
  const groups = useMemo(
    () => listYearGroups(query.summary, query.query),
    [query.summary, query.query],
  );

  if (query.isLoading && !query.summary) {
    return (
      <section className="page-shell page-section" aria-live="polite">
        <p className="text-body text-fg-muted">正在读取年份索引…</p>
      </section>
    );
  }

  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">时间</h2>
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

/** 人物：候选组展示真实照片，但分组不代表身份确认。 */
function PeopleSection() {
  const people = useQuery({
    queryKey: ["people", false, "photos"],
    queryFn: () => aiJobsApi.people(false, "photos"),
    staleTime: 60_000,
  });
  const jobs = useExploreJobs();
  const groups = (people.data?.people ?? []).slice(0, 8);

  if (people.isLoading && !people.data) {
    return (
      <section className="page-shell page-section" aria-live="polite">
        <p className="text-body text-fg-muted">正在读取人物候选…</p>
      </section>
    );
  }

  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">人物候选</h2>
        <span className="section-meta">相似度分组 · 不是身份识别</span>
        <Link to={peopleRoute()} className="chip ml-auto">
          人物相册
        </Link>
      </div>

      {people.isError && people.data ? (
        <ErrorBanner
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        >
          人物分组更新失败，下面仍显示上次读取到的内容。
        </ErrorBanner>
      ) : null}
      {jobs.isError && jobs.data && groups.length === 0 ? (
        <ErrorBanner
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        >
          人物分析状态更新失败，下面仍按上次状态说明。
        </ErrorBanner>
      ) : null}

      {people.isError && !people.data ? (
        <ErrorBanner
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        >
          人物分组暂时读不出来。
        </ErrorBanner>
      ) : groups.length > 0 ? (
        <>
          <p className="mb-3 text-meta text-fg-subtle">
            相似度分组只是复核线索，不代表身份确认。
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {groups.map((person) => (
              <Link
                key={person.id}
                to={peopleRoute(person.id)}
                className="group overflow-hidden rounded-lg border border-border-faint bg-bg-elevated transition-colors hover:border-border-strong"
              >
                <div className="relative aspect-[1.7/1] overflow-hidden bg-bg-subtle">
                  {person.coverResourceId ? (
                    <RenditionImage
                      fileId={person.coverResourceId}
                      alt=""
                      displayWidth={420}
                      testId="explore-person-thumbnail"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  ) : null}
                  <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2 py-1 text-meta text-white">
                    {person.confirmed ? "已确认" : "候选分组"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 px-3 py-2.5">
                  <span className="truncate text-label font-medium text-fg">
                    {person.name}
                  </span>
                  <span className="shrink-0 text-meta tabular-nums text-fg-muted">
                    {person.photoCount.toLocaleString("zh-CN")} 张
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </>
      ) : jobs.isLoading && !jobs.data ? (
        <p className="text-body text-fg-muted">正在检查人物分析状态…</p>
      ) : jobs.isError && !jobs.data ? (
        <ErrorBanner
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        >
          人物分析状态暂时读不出来。
        </ErrorBanner>
      ) : (
        <PeopleEmptyState
          jobs={jobs.data?.snapshot.jobs ?? []}
          enabled={jobs.data?.snapshot.settings.peopleEnabled ?? false}
        />
      )}
    </section>
  );
}

function PeopleEmptyState({
  jobs,
  enabled,
}: {
  jobs: AIJob[];
  enabled: boolean;
}) {
  const latestFaceJob = latestAnalysisJob(jobs, "face");
  const running =
    latestFaceJob?.status === "pending" || latestFaceJob?.status === "running";
  const paused = latestFaceJob?.status === "paused";

  if (!enabled) {
    return (
      <p className="text-body text-fg-muted">
        人物分析尚未启用。前往任务中心开启分析后，这里才会出现候选分组。
        <Link
          className="ml-1 text-brand underline-offset-2 hover:underline"
          to="/tasks/plan"
        >
          打开任务中心
        </Link>
      </p>
    );
  }
  if (running || paused) {
    return (
      <p className="text-body text-fg-muted" aria-live="polite">
        {paused ? "人物分析已暂停。" : "人物分析正在运行，候选分组稍后更新。"}
      </p>
    );
  }
  if (latestFaceJob?.status === "failed") {
    return (
      <p className="text-body text-fg-muted">
        上次人物分析失败，暂时无法确认是否有候选分组。
        <Link
          className="ml-1 text-brand underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务记录
        </Link>
      </p>
    );
  }
  if (latestFaceJob?.status === "cancelled") {
    return (
      <p className="text-body text-fg-muted">
        上次人物分析已取消，尚未完成；可以到任务中心重新运行。
        <Link
          className="ml-1 text-brand underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务中心
        </Link>
      </p>
    );
  }
  if (latestFaceJob?.status !== "completed") {
    return (
      <p className="text-body text-fg-muted">
        人物分析尚未运行。前往任务中心启动人脸分析后，这里才会出现候选分组。
        <Link
          className="ml-1 text-brand underline-offset-2 hover:underline"
          to="/tasks/plan"
        >
          打开任务中心
        </Link>
      </p>
    );
  }
  return (
    <p className="text-body text-fg-muted">
      人脸分析已完成，目前没有形成可用的候选分组；这不表示照片里没有人物。
    </p>
  );
}

/** 地点：只把已解析的位置当结果，区分未分析、无 GPS 与非中国坐标。 */
function PlaceSection() {
  const locations = useQuery({
    queryKey: ["locations", "summary"],
    queryFn: () => aiJobsApi.chinaLocations(),
    staleTime: 5 * 60_000,
  });
  const jobs = useExploreJobs();
  const summary = locations.data?.locations;

  if (locations.isLoading && !locations.data) {
    return (
      <section className="page-shell page-section" aria-live="polite">
        <p className="text-body text-fg-muted">正在读取地点…</p>
      </section>
    );
  }

  const hasLocations = Boolean(summary && summary.chinaPhotoCount > 0);
  const activeMetadataJob = jobs.data?.snapshot.active;
  const metadataRunning =
    activeMetadataJob?.type === "metadata" &&
    (activeMetadataJob.status === "pending" ||
      activeMetadataJob.status === "running" ||
      activeMetadataJob.status === "paused");
  const latestMetadataJob = latestAnalysisJob(
    jobs.data?.snapshot.jobs ?? [],
    "metadata",
  );

  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">地点</h2>
        <span className="section-meta">去过的地方</span>
        <Link to={travelsRoute()} className="chip ml-auto">
          足迹
        </Link>
      </div>
      {locations.isError && locations.data ? (
        <ErrorBanner
          onRetry={() => void locations.refetch()}
          retrying={locations.isFetching}
        >
          地点数据更新失败，下面仍显示上次读取到的结果。
        </ErrorBanner>
      ) : null}
      {jobs.isError && jobs.data ? (
        <ErrorBanner
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        >
          GPS 分析状态更新失败，下面仍按上次状态说明。
        </ErrorBanner>
      ) : null}
      {locations.isError && !locations.data ? (
        <ErrorBanner
          onRetry={() => void locations.refetch()}
          retrying={locations.isFetching}
        >
          地点数据暂时读不出来。
        </ErrorBanner>
      ) : hasLocations ? (
        <>
          <p className="text-body text-fg-muted">
            <span className="text-fg font-medium tabular-nums">
              {summary!.chinaPhotoCount.toLocaleString("zh-CN")}
            </span>{" "}
            张照片带位置，去过{" "}
            <span className="text-fg font-medium tabular-nums">
              {summary!.provinces.length}
            </span>{" "}
            个省级区域。全部在本机解析，不请求在线地图。
          </p>
        </>
      ) : jobs.isLoading && !jobs.data ? (
        <p className="text-body text-fg-muted">正在检查 GPS 分析状态…</p>
      ) : jobs.isError && !jobs.data ? (
        <ErrorBanner
          onRetry={() => void jobs.refetch()}
          retrying={jobs.isFetching}
        >
          GPS 分析状态暂时读不出来。
        </ErrorBanner>
      ) : metadataRunning ? (
        <p className="text-body text-fg-muted" aria-live="polite">
          元数据分析正在进行，地点结果会在完成后更新。
        </p>
      ) : summary && summary.totalPhotoCount === 0 ? (
        <p className="text-body text-fg-muted">
          照片库里目前没有照片可提供地点线索。
        </p>
      ) : summary && summary.gpsPhotoCount > 0 ? (
        <p className="text-body text-fg-muted">
          有 {summary.gpsPhotoCount.toLocaleString("zh-CN")} 张照片带 GPS 坐标，
          但没有命中离线中国行政区边界的数据。
        </p>
      ) : latestMetadataJob?.status === "failed" ? (
        <p className="text-body text-fg-muted">
          上次元数据分析失败，暂时无法确认地点结果。
          <Link
            className="ml-1 text-brand underline-offset-2 hover:underline"
            to="/tasks"
          >
            查看任务记录
          </Link>
        </p>
      ) : latestMetadataJob?.status === "completed" ? (
        <p className="text-body text-fg-muted">
          元数据分析已完成，目前没有解析出可用于足迹的位置。
        </p>
      ) : (
        <p className="text-body text-fg-muted">
          尚未完成元数据 / GPS
          分析。运行一次元数据分析后，这里会显示已解析出位置的照片。
          <Link
            className="ml-1 text-brand underline-offset-2 hover:underline"
            to="/tasks/plan"
          >
            打开任务中心
          </Link>
        </p>
      )}
    </section>
  );
}

function useExploreJobs() {
  return useQuery({
    queryKey: ["ai-jobs"],
    queryFn: () => aiJobsApi.list(),
    staleTime: 30_000,
    refetchInterval: (query) => {
      const active = query.state.data?.snapshot.active;
      return active?.type === "face" || active?.type === "metadata"
        ? 2_000
        : false;
    },
  });
}

function latestAnalysisJob(
  jobs: AIJob[],
  type: AIJob["type"],
): AIJob | undefined {
  return jobs
    .filter((job) => job.type === type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

/** 主题只展示服务端已生成的分组，不触发重算。 */
function ThemeSection() {
  const queryClient = useQueryClient();
  const directory = useSmartAlbumDirectory("featured", true, {
    limit: HOME_SMART_ALBUM_PREVIEW,
  });
  const emptyFeatured =
    !directory.isLoading && !directory.isError && directory.items.length === 0;
  const allDirectory = useSmartAlbumDirectory("all", emptyFeatured, {
    limit: 1,
  });
  const refresh = useQuery({
    queryKey: ["smart-albums", "refresh", "active"],
    queryFn: ({ signal }) => albumsApi.smartAlbumRefreshActive(signal),
    enabled: emptyFeatured,
    staleTime: 1_000,
    refetchInterval: (query) => {
      const status = query.state.data?.task?.status;
      return status === "pending" || status === "running" ? 2_000 : false;
    },
  });
  const task = refresh.data?.task;

  useEffect(() => {
    if (emptyFeatured && task?.status === "complete") {
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
    }
  }, [emptyFeatured, queryClient, task?.jobId, task?.status]);

  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">主题</h2>
        <span className="section-meta">自动聚在一起的照片</span>
        <Link to={smartAlbumsRoute()} className="chip ml-auto">
          全部主题
        </Link>
      </div>
      {!emptyFeatured ? (
        <SmartAlbumPreview
          items={directory.items}
          total={directory.total}
          isLoading={directory.isLoading}
          isError={directory.isError}
          onRetry={() => void directory.refetch()}
        />
      ) : allDirectory.isLoading || refresh.isLoading ? (
        <p className="text-body text-fg-muted" aria-live="polite">
          正在检查主题分组状态…
        </p>
      ) : allDirectory.isError ? (
        <ErrorBanner
          onRetry={() => void allDirectory.refetch()}
          retrying={allDirectory.isFetching}
        >
          已生成主题索引，但汇总状态暂时读不出来。
        </ErrorBanner>
      ) : refresh.isError ? (
        <ErrorBanner
          onRetry={() => void refresh.refetch()}
          retrying={refresh.isFetching}
        >
          主题生成状态暂时读不出来。
        </ErrorBanner>
      ) : task?.status === "pending" || task?.status === "running" ? (
        <p className="text-body text-fg-muted" aria-live="polite">
          {task.status === "pending" ? "主题生成正在排队" : "正在生成主题"}
          {task.total > 0 ? ` · ${task.done}/${task.total}` : "…"}
        </p>
      ) : task?.status === "error" ? (
        <ErrorBanner onRetry={() => void refresh.refetch()}>
          上次主题生成失败，请到任务中心重新运行。
        </ErrorBanner>
      ) : allDirectory.analysis?.complete ? (
        <EmptyState
          title={
            allDirectory.total && allDirectory.total > 0
              ? "没有符合精选条件的主题"
              : "目前没有可用的主题分组"
          }
          description={
            allDirectory.total && allDirectory.total > 0
              ? "分类分析已完成，但当前分组没有达到精选推荐条件。"
              : "主题分析已完成，目前没有形成可用的分类分组。"
          }
          icon={<span aria-hidden="true">✦</span>}
          dense
        />
      ) : allDirectory.analysis ? (
        <p className="text-body text-fg-muted">
          {allDirectory.analysis.analyzedAlbums > 0
            ? `主题分析尚未完成（${allDirectory.analysis.analyzedAlbums}/${allDirectory.analysis.totalAlbums} 本相册已生成）。`
            : "主题尚未生成。"}{" "}
          <Link
            className="text-brand underline-offset-2 hover:underline"
            to="/tasks"
          >
            前往任务中心运行智能相册生成
          </Link>
        </p>
      ) : (
        <ErrorBanner onRetry={() => void allDirectory.refetch()}>
          暂时无法判断主题是否已分析，请重试。
        </ErrorBanner>
      )}
    </section>
  );
}

/** 内容搜索：按画面与图片里的文字找照片，与名称搜索是两件事。 */
function ContentSearchSection() {
  const navigate = useNavigate();
  const [keyword, setKeyword] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const query = keyword.trim();
    if (!query) return;
    const params = new URLSearchParams({ q: query });
    navigate(`${semanticSearchRoute()}?${params.toString()}`);
  };

  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">内容搜索</h2>
        <span className="section-meta">画面里有什么</span>
        <Link to={semanticSearchRoute()} className="chip ml-auto">
          打开高级搜索
        </Link>
      </div>
      <p className="mb-3 text-body text-fg-muted">
        按画面内容或照片里的文字查找，例如「雪」或「手写便签」。
      </p>
      <form className="flex flex-wrap gap-2" onSubmit={submit}>
        <label className="sr-only" htmlFor="explore-content-query">
          搜索照片内容
        </label>
        <input
          id="explore-content-query"
          aria-label="搜索照片内容"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
          maxLength={200}
          placeholder="描述画面，或输入照片里的文字"
          className="h-10 min-w-0 flex-1 basis-64 rounded-md border border-border bg-bg-elevated px-3 text-body text-fg placeholder:text-fg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!keyword.trim()}
        >
          搜索照片
        </button>
      </form>
    </section>
  );
}
