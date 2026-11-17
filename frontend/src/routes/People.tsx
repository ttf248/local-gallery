import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import EmptyState from "../components/common/EmptyState";
import PageHeading from "../components/common/PageHeading";
import RenditionImage from "../components/common/RenditionImage";
import Segmented from "../components/common/Segmented";
import PhotoViewer from "../components/wall/PhotoViewer";
import PhotoWall from "../components/wall/PhotoWall";
import PeopleMergeDialog from "../components/people/PeopleMergeDialog";
import {
  aiJobsApi,
  type PeopleSort,
  type PersonFace,
  type PersonGroup,
} from "../api/aiJobs";
import { usePickToggle } from "../hooks/usePickToggle";
import { useWallViewer } from "../hooks/useWallViewer";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import { useUIStore } from "../store/uiStore";
import { albumRoute, homeRoute, peopleRoute } from "../utils/path";
import { personFaceFrameStyle } from "../utils/personFaceFrame";

export default function People() {
  const { personId } = useParams();
  return personId ? <PersonAlbum personId={personId} /> : <PeopleList />;
}

function PeopleList() {
  const client = useQueryClient();
  const [includeHidden, setIncludeHidden] = useState(false);
  const [sort, setSort] = useState<PeopleSort>("photos");
  const query = useQuery({
    queryKey: ["people", includeHidden, sort],
    queryFn: () => aiJobsApi.people(includeHidden, sort),
  });
  const jobs = useQuery({ queryKey: ["ai-jobs"], queryFn: aiJobsApi.list });
  const peopleEnabled = jobs.data?.snapshot.settings.peopleEnabled ?? false;
  const clear = useMutation({
    mutationFn: aiJobsApi.clearPeople,
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["people"] }),
        client.invalidateQueries({ queryKey: ["ai-jobs"] }),
      ]);
    },
  });
  const groups = query.data?.people ?? [];
  const totalGroups = query.data?.totalGroups ?? groups.length;
  const filteredGroups = query.data?.filteredGroups ?? 0;
  const minimumFolderCount = query.data?.minimumFolderCount ?? 2;
  const minimumFolderPhotos = query.data?.minimumFolderPhotos ?? 3;
  const minimumFolderPhotoSharePercent =
    query.data?.minimumFolderPhotoSharePercent ?? 10;
  const onlyFilteredGroups =
    peopleEnabled && totalGroups === 0 && filteredGroups > 0;

  return (
    <div className="h-full overflow-y-auto pb-12">
      <PageHeading
        eyebrow="离线智能相册"
        title="人物相册"
        description="按本机人脸特征生成可编辑的候选分组。应用不会识别真实姓名；你可以改名、合并、拆分或隐藏分组。"
        action={
          <Link className="btn btn-sm btn-outline" to="/tasks/plan">
            人物分析设置
          </Link>
        }
      />
      {query.isError ? (
        <EmptyState
          title="人物列表加载失败"
          description="请稍后重试。"
          action={
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => void query.refetch()}
            >
              重新加载
            </button>
          }
        />
      ) : null}
      {groups.length === 0 && !query.isLoading ? (
        <EmptyState
          title={
            peopleEnabled
              ? onlyFilteredGroups
                ? "暂不展示目录分布不足的人物组"
                : "还没有人物候选组"
              : "人物分析默认关闭"
          }
          description={
            peopleEnabled
              ? onlyFilteredGroups
                ? `有 ${filteredGroups.toLocaleString()} 组人物未达到跨目录展示条件，已暂时隐藏；至少覆盖 ${minimumFolderCount} 个一级来源目录，且每个目录至少有 ${minimumFolderPhotos} 张照片并占该组照片的 ${minimumFolderPhotoSharePercent}%。`
                : "请在任务中心运行人脸识别任务；分析只在本机处理。"
              : "前往任务中心显式启用人物分析，再启动人脸识别任务。"
          }
          action={
            onlyFilteredGroups ? undefined : (
              <Link className="btn btn-outline" to="/tasks/plan">
                打开任务中心
              </Link>
            )
          }
        />
      ) : (
        <section className="page-shell mt-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-meta text-fg-muted">
              {sort === "photos"
                ? totalGroups > groups.length
                  ? `照片数最多的跨文件夹人物 ${groups.length.toLocaleString()} / 共 ${totalGroups.toLocaleString()} 组`
                  : `跨文件夹人物 ${totalGroups.toLocaleString()} 组`
                : totalGroups > groups.length
                  ? `优先审查的跨文件夹人物 ${groups.length.toLocaleString()} / 共 ${totalGroups.toLocaleString()} 组`
                  : `跨文件夹人物 ${totalGroups.toLocaleString()} 组`}
              {filteredGroups > 0
                ? ` · 已隐藏目录分布不足 ${filteredGroups.toLocaleString()} 组`
                : ""}
              {sort === "photos" ? " · 按照片数排序" : " · 按复核线索排序"}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Segmented
                label="人物排序"
                value={sort}
                onChange={setSort}
                options={[
                  { value: "photos", label: "照片最多" },
                  { value: "review", label: "审查优先" },
                ]}
              />
              <label className="flex items-center gap-2 text-meta text-fg-muted">
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(event) => setIncludeHidden(event.target.checked)}
                />
                显示隐藏分组
              </label>
              <button
                type="button"
                className="btn btn-outline"
                disabled={clear.isPending || groups.length === 0}
                onClick={() => {
                  if (
                    window.confirm(
                      "清除所有人脸分析结果、人物分组和手动修正？此操作不能撤销。",
                    )
                  ) {
                    clear.mutate();
                  }
                }}
              >
                {clear.isPending ? "清除中…" : "清除人物数据"}
              </button>
            </div>
          </div>
          {clear.isError ? (
            <p role="alert" className="mb-4 text-meta text-danger">
              清除失败。请确认没有人脸识别任务正在运行后重试。
            </p>
          ) : null}
          {sort === "review" ? (
            <p className="mb-4 text-meta text-fg-muted">
              优先展示组内较低一成的锚点相似度、中心相似度与检测分数较弱的分组。这些数值只用于安排人工复核，不代表身份置信度。
            </p>
          ) : null}
          <p className="mb-4 text-meta text-fg-muted">
            只展示在至少 {minimumFolderCount}{" "}
            个一级来源目录中都有稳定分布的人物组（每个目录至少{" "}
            {minimumFolderPhotos} 张，且占组内照片至少{" "}
            {minimumFolderPhotoSharePercent}%）；卡片标出达标目录数。
          </p>
          {/* 密度跟着相册网格走（列宽下限 260px）：固定三列时一张脸
              占掉四百像素，一屏只看得到六个人；这一页有五十个候选组，
              它要的是一面能扫完的墙。 */}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {groups.map((person) => (
              <PersonCard
                key={person.id}
                person={person}
                showQuality={sort === "review"}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function PersonCard({
  person,
  showQuality,
}: {
  person: PersonGroup;
  showQuality: boolean;
}) {
  return (
    <Link
      to={peopleRoute(person.id)}
      className="group overflow-hidden rounded-lg border border-border-faint bg-bg-elevated transition-colors hover:border-border-strong"
    >
      <div className="relative aspect-[1.7/1] overflow-hidden bg-bg-subtle">
        {person.coverResourceId ? (
          <RenditionImage
            fileId={person.coverResourceId}
            alt=""
            displayWidth={560}
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03] group-active:scale-[1.03]"
          />
        ) : null}
        <span className="absolute bottom-3 left-3 rounded-full bg-black/65 px-2.5 py-1 text-meta text-white backdrop-blur-sm">
          {/* 说的是「这个人在多少张照片里出现过」；下面那行是「认出了
              多少张脸」。两个数常常一样，摆在一起时得说清哪个是哪个，
              否则读起来像同一个数字写了两遍。 */}
          {person.photoCount.toLocaleString()} 张照片
        </span>
      </div>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <h2 className="truncate font-display text-label font-medium text-fg">
            {person.name}
          </h2>
          <p className="mt-0.5 text-meta text-fg-muted">
            {person.folderCount != null
              ? `${person.folderCount.toLocaleString()} 个一级目录 · `
              : ""}
            {person.faceCount.toLocaleString()} 张脸
            {person.hidden ? " · 已隐藏" : ""}
          </p>
        </div>
        {/* 整张卡就是入口，不必每张都写一遍「打开相册 →」：
            一屏十几张卡各写一句，那句话成了噪音。方向键与列表卡
            同一套语言 —— 悬停才出现，触屏设备常驻。 */}
        <span className="shrink-0 text-body text-fg-subtle hover-reveal group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
          ›
        </span>
      </div>
      {showQuality && person.quality ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 border-t border-border-faint px-4 py-2 text-meta text-fg-muted">
          <span>锚点 P10 {person.quality.anchorP10.toFixed(3)}</span>
          <span>中心 P10 {person.quality.centroidP10.toFixed(3)}</span>
          <span>检测 P10 {person.quality.detectionP10.toFixed(3)}</span>
        </div>
      ) : null}
    </Link>
  );
}

function PersonAlbum({ personId }: { personId: string }) {
  const facePageSize = 200;
  const navigate = useNavigate();
  const client = useQueryClient();
  const density = usePhotoStore((state) => state.density);
  const picks = usePickToggle();
  const pushToast = useUIStore((state) => state.pushToast);
  const [name, setName] = useState("");
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [selectedFaces, setSelectedFaces] = useState<string[]>([]);
  const [visibleFaceCount, setVisibleFaceCount] = useState(facePageSize);
  const query = useInfiniteQuery({
    queryKey: ["person-media", personId],
    queryFn: ({ pageParam }) =>
      aiJobsApi.personMedia(personId, pageParam).then((result) => result.page),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (page) => page.nextCursor,
  });
  const person = query.data?.pages[0]?.person;
  const items = useMemo(
    () => query.data?.pages.flatMap((page) => page.items) ?? [],
    [query.data],
  );
  const faces = useMemo(
    () => query.data?.pages.flatMap((page) => page.faces) ?? [],
    [query.data],
  );
  const facesByResource = useMemo(() => {
    const grouped = new Map<string, PersonFace[]>();
    for (const face of faces) {
      const resourceFaces = grouped.get(face.resourceId) ?? [];
      resourceFaces.push(face);
      grouped.set(face.resourceId, resourceFaces);
    }
    return grouped;
  }, [faces]);
  const total = query.data?.pages[0]?.total ?? 0;
  const savePerson = useMutation({
    mutationFn: (body: { name?: string; hidden?: boolean }) =>
      aiJobsApi.updatePerson(personId, body),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["people"] }),
        client.invalidateQueries({ queryKey: ["person-media", personId] }),
      ]);
      pushToast({ kind: "success", message: "人物分组已更新" });
    },
    onError: () => pushToast({ kind: "error", message: "保存人物分组失败" }),
  });
  const merge = useMutation({
    mutationFn: (targetId: string) => aiJobsApi.mergePeople(personId, targetId),
    onSuccess: async (_result, targetId) => {
      await client.invalidateQueries({ queryKey: ["people"] });
      setMergeDialogOpen(false);
      navigate(peopleRoute(targetId));
    },
    onError: () => pushToast({ kind: "error", message: "合并分组失败" }),
  });
  const split = useMutation({
    mutationFn: () => aiJobsApi.splitPerson(personId, selectedFaces),
    onSuccess: async ({ personId: createdID }) => {
      setSelectedFaces([]);
      await client.invalidateQueries({ queryKey: ["people"] });
      await client.invalidateQueries({ queryKey: ["person-media", personId] });
      navigate(peopleRoute(createdID));
    },
    onError: () => pushToast({ kind: "error", message: "拆分选中人脸失败" }),
  });
  const loadMore = () => void query.fetchNextPage({ cancelRefetch: false });

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items,
    total,
    albumName: (item) => item.albumName,
    albumHref: (item) => albumRoute("photo", item.albumId),
    hasNextPage: query.hasNextPage ?? false,
    isLoadingMore: query.isFetchingNextPage,
    loadMoreError: query.isFetchNextPageError,
    onLoadMore: loadMore,
    isPicked: picks.isPicked,
    onTogglePick: (item) => picks.toggle(item.id),
  });
  const viewer = wall.viewer;

  const toggleFace = (key: string) =>
    setSelectedFaces((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );

  useEffect(() => {
    setName(person?.name ?? "");
  }, [person?.id, person?.name]);

  if (query.isError || (!person && !query.isLoading)) {
    return (
      <div className="page-shell py-12 text-body text-fg-muted">
        人物分组已失效或照片加载失败。
        <Link className="ml-1 underline" to={homeRoute("photo")}>
          回照片库
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border-faint bg-bg">
        <div className="page-shell">
          <div className="album-bar">
            <div className="min-w-0 flex-1">
              <p className="page-eyebrow">人物相册 · 可编辑候选分组</p>
              <h1 className="album-bar__title truncate">
                {person?.name ?? "人物相册"}
              </h1>
            </div>
            <Link className="btn btn-sm btn-outline" to={peopleRoute()}>
              全部人物
            </Link>
          </div>
        </div>
      </header>
      <div className="page-shell shrink-0 space-y-3 border-b border-border-faint py-3">
        <p className="text-meta text-fg-muted">
          {person?.photoCount.toLocaleString() ?? 0} 张照片 ·{" "}
          {person?.faceCount.toLocaleString() ?? 0}{" "}
          张脸。分组只表示相似度候选，不代表身份确认。
        </p>
        <p className="flex items-center gap-2 text-meta text-fg-muted">
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 rounded border-2 border-white bg-bg-subtle shadow-[0_0_0_2px_var(--overlay-bg)]"
          />
          照片框线标出属于「{person?.name ?? "当前人物"}
          」分组的人脸；合照里未框住的人脸不在本组。
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              savePerson.mutate({ name });
            }}
          >
            <input
              className="w-48 rounded-md border border-border bg-bg-elevated px-3 py-2 text-body text-fg"
              value={name}
              maxLength={60}
              onChange={(event) => setName(event.target.value)}
              placeholder={person?.name ?? "人物名称"}
              aria-label="人物名称"
            />
            <button
              className="btn btn-sm btn-outline"
              disabled={savePerson.isPending}
            >
              改名
            </button>
          </form>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={savePerson.isPending}
            onClick={() => savePerson.mutate({ hidden: !person?.hidden })}
          >
            {person?.hidden ? "取消隐藏" : "隐藏分组"}
          </button>
          <button
            type="button"
            className="btn btn-sm btn-outline"
            disabled={merge.isPending}
            onClick={() => setMergeDialogOpen(true)}
          >
            合并人物
          </button>
        </div>
        {faces.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-meta text-fg-muted">
              拆分选中的人脸（当前已加载照片）
            </summary>
            <div className="mt-2 grid max-h-40 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {faces.slice(0, visibleFaceCount).map((face) => {
                const item = items.find(
                  (candidate) => candidate.id === face.resourceId,
                );
                return (
                  <label
                    key={face.key}
                    className="flex items-center gap-2 truncate text-meta text-fg"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFaces.includes(face.key)}
                      disabled={
                        selectedFaces.length >= 200 &&
                        !selectedFaces.includes(face.key)
                      }
                      onChange={() => toggleFace(face.key)}
                    />
                    <span className="truncate">
                      {item?.name ?? face.resourceId} · 人脸{" "}
                      {face.faceIndex + 1}
                    </span>
                  </label>
                );
              })}
            </div>
            {faces.length > visibleFaceCount ? (
              <button
                type="button"
                className="btn btn-sm btn-outline mt-2"
                onClick={() =>
                  setVisibleFaceCount((count) => count + facePageSize)
                }
              >
                {`继续显示 ${Math.min(facePageSize, faces.length - visibleFaceCount)} 张脸（${visibleFaceCount}/${faces.length}）`}
              </button>
            ) : null}
            <button
              type="button"
              className="btn btn-sm btn-outline mt-2"
              disabled={selectedFaces.length === 0 || split.isPending}
              onClick={() => split.mutate()}
            >
              {split.isPending
                ? "拆分中…"
                : `拆分 ${selectedFaces.length} 张脸`}
            </button>
          </details>
        ) : null}
      </div>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState
          title="这个人物分组暂时没有照片"
          description="媒体库或分析结果变化后，该分组会按当前有效照片显示。"
          dense
        />
      ) : (
        <div className="page-shell min-h-0 flex-1 pb-2 pt-3">
          <PhotoWall
            items={items}
            total={total}
            targetHeight={wallTargetHeight(density)}
            hasNextPage={query.hasNextPage ?? false}
            isLoadingMore={query.isFetchingNextPage}
            onLoadMore={loadMore}
            onOpen={(_item, index) => wall.open(index)}
            itemOverlay={(item, tile) => {
              const itemFaces = facesByResource.get(item.id);
              if (!itemFaces?.length) return null;
              return (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-[5]"
                >
                  {itemFaces.map((face) => {
                    const style = personFaceFrameStyle(
                      face.box,
                      item.width ?? 0,
                      item.height ?? 0,
                      tile.width,
                      tile.height,
                    );
                    return style ? (
                      <span
                        key={face.key}
                        data-testid="person-face-highlight"
                        className="absolute rounded border-2 border-white shadow-[0_0_0_2px_var(--overlay-bg)]"
                        style={style}
                      />
                    ) : null;
                  })}
                </div>
              );
            }}
            albumLabel={(item) => item.albumName}
            isPicked={picks.isPicked}
            onTogglePick={(item) => picks.toggle(item.id)}
            /* 关掉预览后墙回到刚才看的那张：翻了几百张再关掉，
               不该把人丢回墙的顶上。 */
            scrollToIndex={wall.focusIndex}
          />
        </div>
      )}
      {viewer ? <PhotoViewer {...viewer} /> : null}
      {mergeDialogOpen ? (
        <PeopleMergeDialog
          personId={personId}
          isMerging={merge.isPending}
          onClose={() => setMergeDialogOpen(false)}
          onMerge={(targetId) => merge.mutate(targetId)}
        />
      ) : null}
    </div>
  );
}
