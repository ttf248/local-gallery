import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import PageHeading from "../components/common/PageHeading";
import SmartAlbumPreview, {
  HOME_SMART_ALBUM_PREVIEW,
} from "../components/home/SmartAlbumPreview";
import YearTimeline from "../components/home/YearTimeline";
import { aiJobsApi } from "../api/aiJobs";
import { useLibraryList, listYearGroups } from "../hooks/useLibraryList";
import { useLibraryManifest } from "../hooks/useLibrary";
import { useSmartAlbumDirectory } from "../hooks/useSmartAlbums";
import { peopleRoute, semanticSearchRoute, smartAlbumsRoute, travelsRoute } from "../utils/path";

/**
 * 探索：找东西的地方。
 *
 * 五个维度各自回答一个问题：按时间、按人、按地点、按主题、按画面内容。
 * 每一段给的是**真实内容的预览**（年份索引、常见人物、去过多少地方、
 * 已生成的主题），不是一排图标入口 —— 点进去之前就能看见里面有什么。
 *
 * 预览与完整页面是同一份数据的两种呈现：这里给六张，那边给全部。
 */
export default function Explore() {
  const manifest = useLibraryManifest().data?.manifest;
  const hasContent = (manifest?.statistics.albumCount ?? 0) > 0;

  return (
    <div className="min-h-full">
      <PageHeading
        title="探索"
        eyebrow="换个找法"
        description="照片不只按文件夹摆着。它们还按时间、人、地方和画面里的内容聚在一起。"
      />

      {!hasContent ? (
        <div className="page-shell page-section">
          <p className="text-body text-fg-muted">
            媒体库里还没有照片。配置一个媒体目录并完成扫描后，这里才会有内容。
          </p>
          <Link className="btn btn-outline mt-4" to="/settings/data">
            去设置媒体目录
          </Link>
        </div>
      ) : (
        <>
          <TimeSection />
          <PeopleSection />
          <PlaceSection />
          <ThemeSection />
          <ContentSearchSection />
        </>
      )}
    </div>
  );
}

/** 时间：年份索引。点一年直接看那一年的照片。 */
function TimeSection() {
  const list = useLibraryList(
    useMemo(() => ({ kind: "photo" as const, view: "all" as const }), []),
    true,
  );
  const groups = useMemo(
    () => listYearGroups(list.summary, list.query),
    [list.summary, list.query],
  );
  if (groups.length === 0) return null;
  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">时间</h2>
        <span className="section-meta">按年份翻</span>
      </div>
      <YearTimeline groups={groups} showFilter={false} />
    </section>
  );
}

/** 人物：常见人物候选。分组只是相似度结果，不是身份。 */
function PeopleSection() {
  const people = useQuery({
    queryKey: ["people", "list"],
    queryFn: () => aiJobsApi.people(),
    staleTime: 60_000,
  });
  const groups = (people.data?.people ?? []).slice(0, 8);
  if (people.isLoading) {
    return (
      <section className="page-shell page-section">
        <p className="text-body text-fg-muted">正在读取人物分组…</p>
      </section>
    );
  }
  if (groups.length === 0) {
    return (
      <section className="page-shell page-section">
        <div className="section-heading">
          <h2 className="section-title">人物</h2>
        </div>
        <p className="text-body text-fg-muted">
          还没有人物分组。人物分析默认关闭，先到任务中心启用并跑一次，才会有候选出现。
        </p>
      </section>
    );
  }
  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">人物</h2>
        <span className="section-meta">出现在照片里的人</span>
        <Link to={peopleRoute()} className="chip ml-auto">
          人物相册
        </Link>
      </div>
      <div className="flex flex-wrap gap-2">
        {groups.map((person) => (
          <Link
            key={person.id}
            to={peopleRoute(person.id)}
            className="chip"
            title={`${person.name} · ${person.photoCount} 张`}
          >
            <span>{person.name}</span>
            <span className="tabular-nums text-fg-subtle">{person.photoCount}</span>
          </Link>
        ))}
      </div>
    </section>
  );
}

/** 地点：照片坐标离线解析出来的地理分布。 */
function PlaceSection() {
  const locations = useQuery({
    queryKey: ["locations", "summary"],
    queryFn: () => aiJobsApi.chinaLocations(),
    staleTime: 5 * 60_000,
  });
  const summary = locations.data?.locations;
  const provinces = summary?.provinces?.length ?? 0;
  if (locations.isLoading) {
    return (
      <section className="page-shell page-section">
        <p className="text-body text-fg-muted">正在读取地点…</p>
      </section>
    );
  }
  // 「足迹」这一节永远给得出入口：地点页本身是一张地图与一段行程，
  // 即便还没解析出位置，它也说得清「这里还没有内容」。把入口藏起来
  // 只在有数据时才给，用户就找不到这一页了。
  const hasLocations = Boolean(summary && summary.chinaPhotoCount > 0);
  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">地点</h2>
        <span className="section-meta">去过的地方</span>
        <Link to={travelsRoute()} className="chip ml-auto">
          足迹
        </Link>
      </div>
      {hasLocations ? (
        <p className="text-body text-fg-muted">
          <span className="text-fg font-medium tabular-nums">
            {summary!.chinaPhotoCount.toLocaleString("zh-CN")}
          </span>{" "}
          张照片带位置，去过{" "}
          <span className="text-fg font-medium tabular-nums">{provinces}</span>{" "}
          个省级区域。全部在本机解析，不请求在线地图。
        </p>
      ) : (
        <p className="text-body text-fg-muted">
          还没有解析出照片里的位置。跑一次元数据分析（EXIF / GPS）后，这里会给出去过的地方。
        </p>
      )}
    </section>
  );
}

/** 主题：分析出来的跨相册分组。 */
function ThemeSection() {
  const directory = useSmartAlbumDirectory("featured", true, {
    limit: HOME_SMART_ALBUM_PREVIEW,
  });
  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">主题</h2>
        <span className="section-meta">自动聚在一起的照片</span>
        <Link to={smartAlbumsRoute()} className="chip ml-auto">
          全部主题
        </Link>
      </div>
      <SmartAlbumPreview
        items={directory.items}
        total={directory.total}
        isLoading={directory.isLoading}
        isError={directory.isError}
        onRetry={() => void directory.refetch()}
      />
    </section>
  );
}

/** 内容搜索：按画面与图片里的文字找照片，与名称搜索是两件事。 */
function ContentSearchSection() {
  return (
    <section className="page-shell page-section">
      <div className="section-heading">
        <h2 className="section-title">内容搜索</h2>
        <span className="section-meta">画面里有什么</span>
        <Link to={semanticSearchRoute()} className="chip ml-auto">
          打开搜索
        </Link>
      </div>
      <p className="text-body text-fg-muted">
        顶栏的搜索框按名字找相册、集合与标签；内容搜索按画面和图片里的文字找照片，
        比如「雪」「手写便签」。它需要在本机装好语义模型并跑过一次分析。
      </p>
    </section>
  );
}
