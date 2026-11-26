import { ExploreSection, PreviewSkeleton } from "./ExploreSection";
import { ScrollRow } from "../../ui/ScrollRow";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { aiJobsApi, type AIJob, type PersonGroup } from "../../api/aiJobs";
import { PersonFaceThumb } from "../people";
import { InlineAlert } from "../../ui/InlineAlert";
import { peopleRoute } from "../../utils/path";

/** 每一档最多摆几个人：预览是入口，不是名单。 */
const NAMED_LIMIT = 6;
const CANDIDATE_LIMIT = 6;

/**
 * 发现页的人物预览。
 *
 * 摆的是**脸**，不是照片：合影里那张脸只占画面一小块，整张当缩略图时
 * 用户认不出是哪个人（服务端给出代表脸的框，这里据此把脸放到中间）。
 *
 * 已命名与待确认分成两栏，不用一枚灰标签糊弄：分组是相似度聚出来的
 * 候选，**不是身份确认** —— 界面上不能让人以为认出来了。
 */
export default function PeopleRow() {
  const people = useQuery({
    queryKey: ["people", false, "photos"],
    queryFn: () => aiJobsApi.people(false, "photos"),
    staleTime: 60_000,
  });
  const jobs = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: aiJobsApi.list,
    staleTime: 30_000,
  });

  const groups = people.data?.people ?? [];
  const named = groups.filter((group) => group.confirmed).slice(0, NAMED_LIMIT);
  const candidates = groups
    .filter((group) => !group.confirmed)
    .slice(0, CANDIDATE_LIMIT);

  return (
    <ExploreSection
      id="explore-people"
      title="人物"
      to={peopleRoute()}
      linkLabel="全部人物"
      info="分组只是复核线索，不代表身份确认。改名或合并后，这里会跟着变。"
    >
      {people.isError && people.data ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        >
          人物分组更新失败，下面仍显示上次读取到的内容。
        </InlineAlert>
      ) : null}
      {people.isError && !people.data ? (
        <InlineAlert
          tone="danger"
          onRetry={() => void people.refetch()}
          retrying={people.isFetching}
        >
          人物分组暂时读不出来。
        </InlineAlert>
      ) : null}

      {people.isLoading && !people.data ? (
        <PreviewSkeleton label="正在读取人物候选…" shape="person" />
      ) : null}

      {!people.isLoading && !people.isError && groups.length === 0 ? (
        <PeopleEmptyState
          jobs={jobs.data?.snapshot.jobs ?? []}
          enabled={jobs.data?.snapshot.settings.peopleEnabled ?? false}
        />
      ) : null}

      {groups.length > 0 ? (
        <div className="space-y-8">
          {named.length > 0 ? (
            <PeopleGroup
              title="已命名"
              hint="你确认过是谁"
              people={named}
              testId="explore-people-named"
            />
          ) : null}
          {candidates.length > 0 ? (
            <PeopleGroup
              title="候选分组"
              hint="相似度聚出来的，还没确认是谁"
              people={candidates}
              testId="explore-people-candidate"
            />
          ) : null}
        </div>
      ) : null}
    </ExploreSection>
  );
}

function PeopleGroup({
  title,
  hint,
  people,
  testId,
}: {
  title: string;
  hint: string;
  people: PersonGroup[];
  testId: string;
}) {
  return (
    <div>
      <p className="mb-3 flex items-baseline gap-2 text-caption text-ink-2">
        <span className="font-medium text-ink">{title}</span>
        <span>{hint}</span>
      </p>
      <ScrollRow label={title} data-testid={testId}>
        {people.map((person) => (
          <Link
            key={person.id}
            to={peopleRoute(person.id)}
            className="w-[88px] shrink-0 text-center min-[1600px]:w-[120px]"
          >
            <span className="relative block aspect-square">
              <span className={`block size-full overflow-hidden rounded-full ring-2 ring-inset ${person.confirmed ? "ring-line" : "ring-warning"}`}>
                <PersonFaceThumb
                  person={person}
                  size={120}
                  fill
                  className="size-full"
                  testId="explore-person-thumbnail"
                />
              </span>
              {!person.confirmed && (
                <span
                  aria-label="待确认"
                  className="absolute bottom-1 right-2 grid size-[18px] place-items-center rounded-full bg-raised text-caption shadow-1"
                >
                  ?
                </span>
              )}
            </span>
            <span className="mt-2 block truncate text-label font-semibold">
              {person.name}
            </span>
            <span className="text-caption tabular-nums text-ink-2">
              {person.photoCount.toLocaleString("zh-CN")} 张
            </span>
          </Link>
        ))}
      </ScrollRow>
    </div>
  );
}

/**
 * 没有候选分组时的实话。
 *
 * 分清「还没开人物分析」「分析正在跑」「分析跑过了但没聚出组」——
 * 三种情况的下一步不一样，不能都写成一句「暂无数据」。
 */
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
      <p className="text-body text-ink-2">
        人物分析尚未启用。前往任务中心开启分析后，这里才会出现候选分组。
        <Link
          className="ml-1 text-primary underline-offset-2 hover:underline"
          to="/tasks/plan"
        >
          打开任务中心
        </Link>
      </p>
    );
  }
  if (running || paused) {
    return (
      <p className="text-body text-ink-2" aria-live="polite">
        {paused ? "人物分析已暂停。" : "人物分析正在运行，候选分组稍后更新。"}
      </p>
    );
  }
  if (latestFaceJob?.status === "failed") {
    return (
      <p className="text-body text-ink-2">
        上次人物分析失败，暂时无法确认是否有候选分组。
        <Link
          className="ml-1 text-primary underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务记录
        </Link>
      </p>
    );
  }
  if (latestFaceJob?.status === "cancelled") {
    return (
      <p className="text-body text-ink-2">
        上次人物分析已取消，尚未完成；可以到任务中心重新运行。
        <Link
          className="ml-1 text-primary underline-offset-2 hover:underline"
          to="/tasks"
        >
          查看任务中心
        </Link>
      </p>
    );
  }
  if (latestFaceJob?.status !== "completed") {
    return (
      <p className="text-body text-ink-2">
        人物分析尚未运行。前往任务中心启动人脸分析后，这里才会出现候选分组。
        <Link
          className="ml-1 text-primary underline-offset-2 hover:underline"
          to="/tasks/plan"
        >
          打开任务中心
        </Link>
      </p>
    );
  }
  return (
    <p className="text-body text-ink-2">
      人脸分析已完成，目前没有形成可用的候选分组；这不表示照片里没有人物。
    </p>
  );
}

function latestAnalysisJob(
  jobs: AIJob[],
  type: AIJob["type"],
): AIJob | undefined {
  return jobs
    .filter((job) => job.type === type)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}
