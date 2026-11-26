import {Page} from "../shell/Page";
import {buttonStyles} from "../ui/buttonStyles";
import { useConfirm } from "../features/common/ConfirmDialog";
import PersonFaceThumb from "../features/people/PersonFaceThumb";
import { TextField } from "../ui/Field";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { EmptyState } from "../ui/EmptyState";
import { Switch } from "../ui/Switch";
import { PageHero } from "../shell/PageHero";
import RenditionImage from "../features/common/RenditionImage";
import Segmented from "../ui/Segmented";
import PhotoViewer from "../features/viewer/PhotoViewer";
import PhotoWall from "../features/wall/PhotoWall";
import PeopleMergeDialog from "../features/people/PeopleMergeDialog";
import {
  aiJobsApi,
  type PeopleSort,
  type PersonGroupPhotoCandidate,
  type PersonMatchCandidate,
  type PersonMatchEvidence,
  type PersonMatchSuggestion,
  type PersonFace,
  type PersonGroup,
} from "../api/aiJobs";
import { usePickToggle } from "../hooks/usePickToggle";
import { useWallViewer } from "../hooks/useWallViewer";
import { usePhotoStore, wallTargetHeight } from "../store/photoStore";
import { useUIStore } from "../store/uiStore";
import {
  albumRoute,
  homeRoute,
  peopleAnnotateRoute,
  peopleRoute,
} from "../utils/path";
import { personFaceFrameStyle } from "../utils/personFaceFrame";

export default function People() {
  const { personId } = useParams();
  return personId ? <PersonAlbum personId={personId} /> : <PeopleList />;
}

function PeopleList() {
  const confirm = useConfirm();
  const client = useQueryClient();
  const pushToast = useUIStore((state) => state.pushToast);
  const [includeHidden, setIncludeHidden] = useState(false);
  const [sort, setSort] = useState<PeopleSort>("photos");
  const [activeTab, setActiveTab] = useState<
    "common" | "matches" | "groupPhotos"
  >("common");
  const jobs = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: aiJobsApi.list,
    refetchInterval: (q) =>
      q.state.data?.snapshot.jobs.some(
        (j) => j.type === "portrait" && j.status === "running",
      )
        ? 10000
        : false,
  });
  const refining = jobs.data?.snapshot.jobs.some(
    (j) => j.type === "portrait" && j.status === "running",
  );
  const query = useInfiniteQuery({
    refetchInterval: refining ? 15000 : false,
    queryKey: ["people", "pages", includeHidden, sort],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      aiJobsApi.people(includeHidden, sort, pageParam),
    getNextPageParam: (page, pages) => {
      const loaded = pages.reduce((sum, item) => sum + item.people.length, 0);
      return page.people.length && loaded < page.totalGroups
        ? loaded
        : undefined;
    },
  });
  const matches = useInfiniteQuery({
    queryKey: ["people-matches", includeHidden],
    queryFn: ({ pageParam }) =>
      aiJobsApi.peopleMatches(includeHidden, 20, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    enabled: activeTab === "matches",
  });
  const groupPhotoCandidates = useInfiniteQuery({
    queryKey: ["people-group-photo-candidates", includeHidden],
    queryFn: ({ pageParam }) =>
      aiJobsApi.groupPhotoCandidates(includeHidden, 20, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    enabled: activeTab === "groupPhotos",
  });

  const peopleEnabled = jobs.data?.snapshot.settings.peopleEnabled ?? false;
  const refreshPeople = async () =>
    Promise.all([
      client.invalidateQueries({ queryKey: ["people"] }),
      client.invalidateQueries({ queryKey: ["people-matches"] }),
      client.invalidateQueries({ queryKey: ["people-group-photo-candidates"] }),
    ]);
  const clear = useMutation({
    mutationFn: aiJobsApi.clearPeople,
    onSuccess: async () => {
      await Promise.all([
        refreshPeople(),
        client.invalidateQueries({ queryKey: ["ai-jobs"] }),
      ]);
    },
  });
  const mergeMatch = useMutation({
    mutationFn: ({
      sourceId,
      targetId,
    }: {
      sourceId: string;
      targetId: string;
    }) => aiJobsApi.mergePeople(sourceId, targetId),
    onSuccess: async () => {
      await refreshPeople();
      pushToast({ kind: "success", message: "已按你的确认合并人物组" });
    },
    onError: () => pushToast({ kind: "error", message: "合并人物组失败" }),
  });
  const excludeMatch = useMutation({
    mutationFn: ({
      sourceId,
      targetId,
    }: {
      sourceId: string;
      targetId: string;
    }) => aiJobsApi.excludePersonMatch(sourceId, targetId),
    onSuccess: async () => {
      await refreshPeople();
      pushToast({ kind: "success", message: "已排除此匹配建议" });
    },
    onError: () => pushToast({ kind: "error", message: "排除匹配建议失败" }),
  });
  const retainGroup = useMutation({
    mutationFn: aiJobsApi.retainPersonGroup,
    onSuccess: async () => {
      await refreshPeople();
      pushToast({ kind: "success", message: "已保留为独立人物" });
    },
    onError: () => pushToast({ kind: "error", message: "保留人物组失败" }),
  });
  const groups = query.data?.pages.flatMap((page) => page.people) ?? [];
  const totalGroups = query.data?.pages[0]?.totalGroups ?? groups.length;
  const filteredGroups = query.data?.pages[0]?.filteredGroups ?? 0;
  const matchItems = matches.data?.pages.flatMap((page) => page.items) ?? [];
  const totalSources = matches.data?.pages[0]?.totalSources ?? 0;
  const photoItems =
    groupPhotoCandidates.data?.pages.flatMap((page) => page.items) ?? [];
  const totalPhotoCandidates = groupPhotoCandidates.data?.pages[0]?.total ?? 0;
  const mutationPending =
    mergeMatch.isPending || excludeMatch.isPending || retainGroup.isPending;

  return (
    <div className="h-full overflow-y-auto pb-12">
      <Page >
        <header className="flex items-center justify-between gap-3 pt-5">
          <h1 className="text-display font-semibold">人物相册</h1>
          <details className="relative">
            <summary className={buttonStyles({variant:"secondary",size:"sm",className:"cursor-pointer"})}>
              管理
            </summary>
            <div className="absolute right-0 z-20 mt-2 grid w-52 gap-2 rounded-lg border border-line bg-raised p-3 shadow-1">
              <details className="text-caption text-ink-2">
                <summary className="cursor-pointer py-1">人物分组说明</summary>
                <p className="mt-1">
                  照片按本机识别的人脸相似度分组。姓名和合并关系由你确认。
                </p>
              </details>
              <Link
                className={buttonStyles({variant:"secondary",size:"sm"})}
                to={peopleAnnotateRoute()}
              >
                标注工具
              </Link>
              <Link className={buttonStyles({variant:"secondary",size:"sm"})} to="/tasks/plan">
                人物分析设置
              </Link>
              <label className="flex items-center gap-2 text-caption text-ink-2">
                <input
                  type="checkbox"
                  checked={includeHidden}
                  onChange={(event) => setIncludeHidden(event.target.checked)}
                />
                显示隐藏分组
              </label>
              <button
                type="button"
                className={buttonStyles({variant:"secondary"})}
                disabled={clear.isPending}
                onClick={async () => {
                  if (
                    (await confirm({title:"清除人物数据",description:<>{"清除所有人脸分析结果、人物分组和手动修正？此操作不能撤销。"} 原始文件会保留。</>,confirmLabel:"清除人物数据",tone:"danger"}))
                  ) {
                    clear.mutate();
                  }
                }}
              >
                {clear.isPending ? "清除中…" : "清除人物数据"}
              </button>
            </div>
          </details>
        </header>
      </Page>
      {query.isError ? (
        <EmptyState
          title="人物列表加载失败"
          description="请稍后重试。"
          action={
            <button
              type="button"
              className={buttonStyles({variant:"secondary"})}
              onClick={() => void query.refetch()}
            >
              重新加载
            </button>
          }
        />
      ) : null}
      {!peopleEnabled &&
      !jobs.isLoading &&
      totalGroups === 0 &&
      filteredGroups === 0 ? (
        <EmptyState
          title="人物分析默认关闭"
          description="前往任务中心启用人物分析并运行人脸识别。分析只在本机处理。"
          action={
            <Link className={buttonStyles({variant:"secondary"})} to="/tasks/plan">
              打开任务中心
            </Link>
          }
        />
      ) : (
        <Page as="section" className="mt-4">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div
              role="tablist"
              aria-label="人物分组分类"
              className="flex max-w-full gap-1 overflow-x-auto whitespace-nowrap"
            >
              <PeopleTab
                active={activeTab === "common"}
                onClick={() => setActiveTab("common")}
              >
                常见人物{" "}
                <span className="ml-1 text-ink-3">
                  {totalGroups.toLocaleString()}
                </span>
              </PeopleTab>
              <PeopleTab
                active={activeTab === "matches"}
                onClick={() => setActiveTab("matches")}
              >
                待确认匹配{" "}
                <span className="ml-1 text-ink-3">
                  {matches.data ? totalSources.toLocaleString() : ""}
                </span>
              </PeopleTab>
              <PeopleTab
                active={activeTab === "groupPhotos"}
                onClick={() => setActiveTab("groupPhotos")}
              >
                合照候选{" "}
                <span className="ml-1 text-ink-3">
                  {groupPhotoCandidates.data
                    ? totalPhotoCandidates.toLocaleString()
                    : ""}
                </span>
              </PeopleTab>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              {activeTab === "common" ? (
                <Segmented
                  label="人物排序"
                  value={sort}
                  onChange={setSort}
                  options={[
                    { value: "photos", label: "照片最多" },
                    { value: "review", label: "审查优先" },
                  ]}
                />
              ) : null}
            </div>
          </div>
          {clear.isError ? (
            <p role="alert" className="mb-4 text-caption text-danger">
              清除失败。请确认没有人脸识别任务正在运行后重试。
            </p>
          ) : null}
          {activeTab === "common" ? (
            <>
              {sort === "review" && (
                <p className="mb-3 text-caption text-ink-2">
                  按组内相似度和检测质量排序，这些数值不代表身份概率。
                </p>
              )}
              {groups.length === 0 && !query.isLoading ? (
                <EmptyState
                  title="还没有常见人物组"
                  description="可在“待确认匹配”与“合照候选”中检查稀疏分组。"
                />
              ) : (
                <div className="space-y-6">
                  {[true, false].map((confirmed) => {
                    const section = groups.filter(
                      (person) => Boolean(person.confirmed) === confirmed,
                    );
                    return (
                      section.length > 0 && (
                        <section key={String(confirmed)}>
                          <h2 className="mb-3 text-heading">
                            {confirmed ? "已确认" : "待确认"}
                          </h2>
                          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(140px,100%),1fr))] gap-x-3 gap-y-6">
                            {section.map((person) => (
                              <PersonCard key={person.id} person={person} />
                            ))}
                          </div>
                        </section>
                      )
                    );
                  })}
                  {query.hasNextPage && (
                    <button
                      className={buttonStyles({variant:"secondary"})}
                      disabled={query.isFetchingNextPage}
                      onClick={() => void query.fetchNextPage()}
                    >
                      加载更多人物
                    </button>
                  )}
                </div>
              )}
            </>
          ) : null}
          {activeTab === "matches" ? (
            <>
              <p className="mb-4 text-caption text-ink-2">
                每条建议都需要你打开照片确认后再合并。相似度、差值和照片数只描述当前模型的线索，不是身份概率。
              </p>
              {matches.isError ? (
                <ReviewLoadError onRetry={() => void matches.refetch()} />
              ) : null}
              {matchItems.length === 0 && !matches.isLoading ? (
                <EmptyState
                  title="没有待确认的人物组"
                  description="新的稀疏分组会出现在这里。"
                />
              ) : (
                <div className="space-y-4">
                  {matchItems.map((item) => (
                    <MatchSuggestionCard
                      key={item.source.id}
                      item={item}
                      pending={mutationPending}
                      onMerge={(targetId) =>
                        mergeMatch.mutate({
                          sourceId: item.source.id,
                          targetId,
                        })
                      }
                      onExclude={(targetId) =>
                        excludeMatch.mutate({
                          sourceId: item.source.id,
                          targetId,
                        })
                      }
                      onRetain={() => retainGroup.mutate(item.source.id)}
                    />
                  ))}
                </div>
              )}
              {matches.hasNextPage ? (
                <LoadMoreButton
                  loading={matches.isFetchingNextPage}
                  onClick={() => void matches.fetchNextPage()}
                />
              ) : null}
            </>
          ) : null}
          {activeTab === "groupPhotos" ? (
            <>
              <p className="mb-4 text-caption text-ink-2">
                只在合照中出现的组单独列出。判定参考检测脸数与脸部相对画面尺寸；确认保留后会固定为独立人物，不会自动合并。
              </p>
              {groupPhotoCandidates.isError ? (
                <ReviewLoadError
                  onRetry={() => void groupPhotoCandidates.refetch()}
                />
              ) : null}
              {photoItems.length === 0 && !groupPhotoCandidates.isLoading ? (
                <EmptyState
                  title="没有合照候选"
                  description="普通照片中的人物组会显示在常见人物里。"
                />
              ) : (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-4">
                  {photoItems.map((candidate) => (
                    <GroupPhotoCandidateCard
                      key={candidate.person.id}
                      candidate={candidate}
                      pending={mutationPending}
                      onRetain={() => retainGroup.mutate(candidate.person.id)}
                    />
                  ))}
                </div>
              )}
              {groupPhotoCandidates.hasNextPage ? (
                <LoadMoreButton
                  loading={groupPhotoCandidates.isFetchingNextPage}
                  onClick={() => void groupPhotoCandidates.fetchNextPage()}
                />
              ) : null}
            </>
          ) : null}
        </Page>
      )}
    </div>
  );
}

function PeopleTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`rounded-full border px-4 py-2 text-caption transition-colors ${
        active
          ? "border-line-strong bg-raised text-ink"
          : "border-line text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function ReviewLoadError({ onRetry }: { onRetry: () => void }) {
  return (
    <EmptyState
      title="复核列表加载失败"
      description="请稍后重试。"
      action={
        <button type="button" className={buttonStyles({variant:"secondary"})} onClick={onRetry}>
          重新加载
        </button>
      }
    />
  );
}

function LoadMoreButton({
  loading,
  onClick,
}: {
  loading: boolean;
  onClick: () => void;
}) {
  return (
    <div className="mt-6 flex justify-center">
      <button
        type="button"
        className={buttonStyles({variant:"secondary"})}
        disabled={loading}
        onClick={onClick}
      >
        {loading ? "加载中…" : "继续检查"}
      </button>
    </div>
  );
}

function MatchSuggestionCard({
  item,
  pending,
  onMerge,
  onExclude,
  onRetain,
}: {
  item: PersonMatchSuggestion;
  pending: boolean;
  onMerge: (targetId: string) => void;
  onExclude: (targetId: string) => void;
  onRetain: () => void;
}) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-raised">
      <div className="grid gap-4 p-4 md:grid-cols-[minmax(180px,0.7fr)_minmax(0,1.6fr)]">
        <div>
          <p className="mb-2 text-caption text-ink-2">待确认的人物组</p>
          <PersonReviewImage person={item.source} />
          <Link
            className="mt-3 inline-block font-medium text-ink hover:underline"
            to={peopleRoute(item.source.id)}
          >
            {item.source.name}
          </Link>
          <p className="mt-1 text-caption text-ink-2">
            {item.source.photoCount.toLocaleString()} 张照片 ·{" "}
            {item.source.faceCount.toLocaleString()} 张脸
          </p>
          <button
            type="button"
            className={buttonStyles({variant:"secondary",size:"sm",className:"mt-3"})}
            disabled={pending}
            onClick={onRetain}
          >
            保留为独立人物
          </button>
        </div>
        <div className="min-w-0">
          <h2 className="font-display text-body text-ink">可能的匹配对象</h2>
          {item.candidates.length === 0 ? (
            <p className="mt-3 rounded-lg bg-sunken p-4 text-caption text-ink-2">
              当前没有达到提示门槛的候选。你可以先保留为独立人物，之后再从人物详情检查。
            </p>
          ) : (
            <div className="mt-3 space-y-3">
              {item.candidates.map((candidate) => (
                <div
                  key={candidate.person.id}
                  className="rounded-lg border border-line p-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <PersonReviewImage person={candidate.person} compact />
                    <div className="min-w-0 flex-1">
                      <Link
                        className="font-medium text-ink hover:underline"
                        to={peopleRoute(candidate.person.id)}
                      >
                        {candidate.person.name}
                      </Link>
                      <p className="mt-1 text-caption text-ink-2">
                        {candidate.person.photoCount.toLocaleString()} 张照片 ·
                        特征相似度 {candidate.similarity.toFixed(3)} · 差值{" "}
                        {candidate.margin.toFixed(3)}
                      </p>
                      <p className="mt-1 text-caption text-ink-3">
                        跨照互证 {candidate.independentPhotoPairs} 对 ·
                        源/目标照片证据 {candidate.sourceEvidencePhotos}/
                        {candidate.targetEvidencePhotos}
                      </p>
                      <MatchRiskNote candidate={candidate} />
                    </div>
                  </div>
                  <MatchEvidenceStrip
                    label="来源组的互证照片"
                    evidence={candidate.evidenceFaces ?? []}
                  />
                  <MatchEvidenceStrip
                    label="目标组的互证照片"
                    evidence={candidate.targetEvidenceFaces ?? []}
                  />
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={buttonStyles({variant:"primary",size:"sm"})}
                      disabled={pending}
                      onClick={() => onMerge(candidate.person.id)}
                    >
                      是 TA
                    </button>
                    <button
                      type="button"
                      className={buttonStyles({variant:"secondary",size:"sm"})}
                      disabled={pending}
                      onClick={() => onExclude(candidate.person.id)}
                    >
                      不是
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * 风险说明。
 *
 * 相似度只是线索，真正决定要不要合并的是照片本身。这块把服务端算出的
 * 风险原因摆出来，用户不用点进人物详情才知道这条建议有多可靠。
 */
function MatchRiskNote({ candidate }: { candidate: PersonMatchCandidate }) {
  const tone =
    candidate.risk === "high"
      ? "text-danger"
      : candidate.risk === "medium"
        ? "text-warning"
        : "text-ink-3";
  const headline =
    candidate.risk === "high"
      ? "证据薄弱，建议逐张核对后再决定。"
      : candidate.risk === "medium"
        ? "证据尚可，但仍有需要核对的地方。"
        : "跨照片证据较多；仍需你打开照片确认。";
  return (
    <div className={`mt-1 text-caption ${tone}`}>
      <p>{headline}</p>
      {candidate.riskReasons?.length ? (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {candidate.riskReasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/**
 * 互证照片条。
 *
 * 待确认列表里最费事的就是「想去看看是哪几张照片」。这里把提供互证的
 * 真实照片直接摆出来，并把那张脸框出来，不必来回进出人物详情。
 */
function MatchEvidenceStrip({
  label,
  evidence,
}: {
  label: string;
  evidence: PersonMatchEvidence[];
}) {
  const [expanded, setExpanded] = useState(false);
  if (evidence.length === 0) return null;
  const visible = expanded ? evidence : evidence.slice(0, 4);
  return (
    <div className="mt-3">
      <p className="text-caption text-ink-2">{label}</p>
      <div className="mt-1 flex flex-wrap gap-2">
        {visible.map((item) => (
          <EvidenceThumbnail
            key={`${item.resourceId}#${item.faceIndex}`}
            evidence={item}
          />
        ))}
      </div>
      {evidence.length > 4 ? (
        <button
          type="button"
          className={buttonStyles({variant:"secondary",size:"sm",className:"mt-2"})}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "收起照片" : `再显示 ${evidence.length - 4} 张`}
        </button>
      ) : null}
    </div>
  );
}

function EvidenceThumbnail({ evidence }: { evidence: PersonMatchEvidence }) {
  const style = personFaceFrameStyle(
    evidence.box,
    evidence.width,
    evidence.height,
    96,
    96,
  );
  return (
    <figure className="relative h-24 w-24 overflow-hidden rounded-md bg-sunken">
      <RenditionImage
        fileId={evidence.resourceId}
        alt=""
        displayWidth={192}
        className="h-full w-full object-cover"
      />
      {style ? (
        <span
          aria-hidden="true"
          data-testid="people-match-evidence-box"
          className="absolute rounded border-2 border-white shadow-[0_0_0_2px_var(--theater-bg)]"
          style={style}
        />
      ) : null}
      {evidence.year ? (
        <figcaption className="absolute bottom-0 left-0 right-0 bg-black/65 px-1 py-0.5 text-center text-caption text-white">
          {evidence.year}
        </figcaption>
      ) : null}
    </figure>
  );
}

function GroupPhotoCandidateCard({
  candidate,
  pending,
  onRetain,
}: {
  candidate: PersonGroupPhotoCandidate;
  pending: boolean;
  onRetain: () => void;
}) {
  const { person, stats } = candidate;
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-raised">
      <Link className="group block" to={peopleRoute(person.id)}>
        <PersonReviewImage person={person} wide />
        <div className="p-4">
          <h2 className="truncate font-display text-body text-ink">
            {person.name}
          </h2>
          <p className="mt-1 text-caption text-ink-2">
            {person.photoCount.toLocaleString()} 张合照 ·{" "}
            {person.faceCount.toLocaleString()} 张脸
          </p>
          <p className="mt-2 text-caption text-ink-3">
            相对脸部尺寸 P10{" "}
            {stats.relativeFaceSizeP10 > 0
              ? `${(stats.relativeFaceSizeP10 * 100).toFixed(1)}%`
              : "未知"}{" "}
            · 检测分数 P10 {stats.detectionP10.toFixed(2)}
          </p>
        </div>
      </Link>
      <div className="border-t border-line p-4">
        <button
          type="button"
          className={buttonStyles({variant:"secondary",size:"sm"})}
          disabled={pending}
          onClick={onRetain}
        >
          保留为独立人物
        </button>
      </div>
    </article>
  );
}

function PersonReviewImage({
  person,
  compact = false,
  wide = false,
}: {
  person: PersonGroup;
  compact?: boolean;
  wide?: boolean;
}) {
  const imageClass = compact
    ? "h-14 w-14 rounded-md"
    : wide
      ? "aspect-[1.7/1] w-full"
      : "aspect-[1.7/1] w-full rounded-lg";
  return (
    <div className={`overflow-hidden bg-sunken ${imageClass}`}>
      {person.coverResourceId ? (
        <RenditionImage
          fileId={person.coverResourceId}
          alt=""
          displayWidth={wide ? 560 : compact ? 128 : 320}
          className="h-full w-full object-cover"
        />
      ) : null}
    </div>
  );
}

function PersonCard({ person }: { person: PersonGroup }) {
  return (
    <Link
      to={peopleRoute(person.id)}
      className="group block min-w-0 rounded-lg text-center"
    >
      <span className="mx-auto block size-[120px] overflow-hidden rounded-full ring-1 ring-line">
        <PersonFaceThumb
          person={person}
          size={120}
          fill
          className="size-full"
        />
      </span>
      <h3 className="mt-2 truncate text-label font-semibold">
        {person.name}
      </h3>
      <p className="text-caption text-ink-2">
        <span>{person.photoCount.toLocaleString()} 张照片</span>
        {person.hidden ? " · 已隐藏" : ""}
      </p>
    </Link>
  );
}

function PersonAlbum({ personId }: { personId: string }) {
  const facePageSize = 200;
  const navigate = useNavigate();
  const client = useQueryClient();
  const density = usePhotoStore((state) => state.density);
  const showPersonFaceBoxes = useUIStore((state) => state.showPersonFaceBoxes);
  const picks = usePickToggle();
  const pushToast = useUIStore((state) => state.pushToast);
  const [name, setName] = useState("");
  const [choosing, setChoosing] = useState(false);
  const [showReview, setShowReview] = useState(false);
  const review = useQuery({
    queryKey: ["person-review", personId],
    queryFn: () => aiJobsApi.searchPeople(personId, "review", true),
    enabled: showReview,
  });
  const quality = review.data?.people.find(
    (group) => group.id === personId,
  )?.quality;
  const choices = useInfiniteQuery({
    queryKey: ["person-portraits", personId],
    queryFn: ({ pageParam }) => aiJobsApi.portraitChoices(personId, pageParam),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    enabled: choosing,
  });
  const choose = useMutation({
    mutationFn: (key: string) => aiJobsApi.setPortrait(personId, key),
    onSuccess: async () => {
      setChoosing(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["people"] }),
        client.invalidateQueries({ queryKey: ["person-media", personId] }),
        client.invalidateQueries({ queryKey: ["person-portraits", personId] }),
      ]);
    },
    onError: () => pushToast({ kind: "error", message: "头像保存失败" }),
  });
  const [editingName, setEditingName] = useState(false);
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
    setEditingName(false);
  }, [person?.id, person?.name]);

  if (query.isError || (!person && !query.isLoading)) {
    return (
      <Page className="py-12 text-body text-ink-2">
        人物分组已失效或照片加载失败。
        <Link className="ml-1 underline" to={homeRoute("photo")}>
          回照片库
        </Link>
      </Page>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <Page className="shrink-0">
        <PageHero
          title={person?.name ?? "人物相册"}
          leading={
            person && (
              <div className="size-[88px] shrink-0 overflow-hidden rounded-full">
                <PersonFaceThumb
                  person={person}
                  size={96}
                  fill
                  className="size-full"
                />
              </div>
            )
          }
          titleContent={
            person && (
              <button
                type="button"
                aria-label={"重命名「" + person.name + "」"}
                onClick={() => setEditingName(true)}
              >
                {person.name}
              </button>
            )
          }
          meta={
            <>
              {person?.photoCount.toLocaleString() ?? 0} 张照片 ·{" "}
              {person?.faceCount.toLocaleString() ?? 0}{" "}
              张脸。分组只表示相似度候选，不代表身份确认。
            </>
          }
          titleEditor={
            editingName && (
              <form
                className="flex items-end gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const value = name.trim();
                  if (value)
                    savePerson.mutate(
                      { name: value },
                      { onSuccess: () => setEditingName(false) },
                    );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setName(person?.name ?? "");
                    setEditingName(false);
                  }
                }}
              >
                <TextField
                  label="人物名称"
                  autoFocus
                  value={name}
                  maxLength={60}
                  onChange={(event) => setName(event.target.value)}
                />
                <button
                  className={buttonStyles({variant:"secondary"})}
                  disabled={!name.trim() || savePerson.isPending}
                >
                  保存
                </button>
              </form>
            )
          }
          actions={
            <>
              <button
                className={buttonStyles({variant:"secondary"})}
                disabled={merge.isPending}
                onClick={() => setMergeDialogOpen(true)}
              >
                合并人物
              </button>
              <Switch
                label="显示当前人物的人脸框"
                checked={showPersonFaceBoxes}
                onChange={useUIStore.getState().setShowPersonFaceBoxes}
              />
              <Link className={buttonStyles({variant:"secondary"})} to={peopleRoute()}>
                全部人物
              </Link>
            </>
          }
        />
      </Page>
      <Page className="shrink-0">
        <button
          className={buttonStyles({variant:"secondary",size:"sm"})}
          aria-expanded={choosing}
          onClick={() => setChoosing(!choosing)}
        >
          更换头像
        </button>
        <button
          className={buttonStyles({variant:"secondary",size:"sm",className:"ml-2"})}
          aria-expanded={showReview}
          onClick={() => setShowReview(!showReview)}
        >
          复核信息
        </button>
        {showReview && (
          <p className="my-2 text-caption text-ink-2">
            {quality
              ? `锚点 P10 ${quality.anchorP10.toFixed(3)} · 中心 P10 ${quality.centroidP10.toFixed(3)} · 检测 P10 ${quality.detectionP10.toFixed(3)}`
              : review.isLoading
                ? "正在加载…"
                : "暂无复核指标"}
          </p>
        )}
        {choosing && (
          <section className="my-3 max-h-56 overflow-auto rounded-lg border border-line p-3">
            <div className="mb-3 flex gap-2">
              <button className={buttonStyles({variant:"secondary",size:"sm"})} onClick={() => choose.mutate("")}>
                恢复自动精选
              </button>
              {choices.hasNextPage && (
                <button
                  className={buttonStyles({variant:"secondary",size:"sm"})}
                  disabled={choices.isFetchingNextPage}
                  onClick={() => void choices.fetchNextPage()}
                >
                  从更多照片选择
                </button>
              )}
            </div>
            {choices.isLoading && "正在加载头像…"}
            {choices.isError && "头像加载失败"}
            <div className="flex flex-wrap gap-3">
              {choices.data?.pages
                .flatMap((page) => page.choices)
                .map((c, i) => (
                  <button
                    key={c.key}
                    disabled={choose.isPending}
                    aria-label={`使用头像 ${i + 1}`}
                    onClick={() => choose.mutate(c.key)}
                  >
                    <img
                      className="size-20 rounded-full"
                      src={c.url}
                      alt=""
                      loading="lazy"
                    />
                  </button>
                ))}
            </div>
          </section>
        )}
      </Page>
      <Page className="shrink-0 space-y-3 border-b border-line pb-3">
        {showPersonFaceBoxes ? (
          <p className="flex items-center gap-2 text-caption text-ink-2">
            <span
              aria-hidden="true"
              className="h-4 w-4 shrink-0 rounded border-2 border-white bg-sunken shadow-[0_0_0_2px_var(--theater-bg)]"
            />
            照片框线标出属于「{person?.name ?? "当前人物"}
            」分组的人脸；合照里未框住的人脸不在本组。
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={buttonStyles({variant:"secondary",size:"sm"})}
            disabled={savePerson.isPending}
            onClick={() => savePerson.mutate({ hidden: !person?.hidden })}
          >
            {person?.hidden ? "取消隐藏" : "隐藏分组"}
          </button>
        </div>
        {faces.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-caption text-ink-2">
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
                    className="flex items-center gap-2 truncate text-caption text-ink"
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
                className={buttonStyles({variant:"secondary",size:"sm",className:"mt-2"})}
                onClick={() =>
                  setVisibleFaceCount((count) => count + facePageSize)
                }
              >
                {`继续显示 ${Math.min(facePageSize, faces.length - visibleFaceCount)} 张脸（${visibleFaceCount}/${faces.length}）`}
              </button>
            ) : null}
            <button
              type="button"
              className={buttonStyles({variant:"secondary",size:"sm",className:"mt-2"})}
              disabled={selectedFaces.length === 0 || split.isPending}
              onClick={() => split.mutate()}
            >
              {split.isPending
                ? "拆分中…"
                : `拆分 ${selectedFaces.length} 张脸`}
            </button>
          </details>
        ) : null}
      </Page>
      {items.length === 0 && !query.isLoading ? (
        <EmptyState
          title="这个人物分组暂时没有照片"
          description="媒体库或分析结果变化后，该分组会按当前有效照片显示。" size="compact"
        />
      ) : (
        <Page className="min-h-0 flex-1 pb-2 pt-3">
          <PhotoWall
            items={items}
            total={total}
            targetHeight={wallTargetHeight(density)}
            hasNextPage={query.hasNextPage ?? false}
            isLoadingMore={query.isFetchingNextPage}
            onLoadMore={loadMore}
            onOpen={(_item, index) => wall.open(index)}
            itemOverlay={(item, tile) => {
              if (!showPersonFaceBoxes) return null;
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
                        className="absolute rounded border-2 border-white shadow-[0_0_0_2px_var(--theater-bg)]"
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
        </Page>
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
