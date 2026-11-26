import { similarityStatusKey } from "../api/queryKeys";
import { useCallback, useMemo } from "react";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { picksQueryKey } from "./usePicks";
import {
  similarityApi,
  type SimilarityBatchAction,
  type SimilarityGroup,
  type SimilarityGroupKind,
  type SimilarityGroupQuery,
  type SimilarityGroupStatus,
  type SimilarityRestoreEntry,
} from "../api/similarity";

/** 分组列表的查询键。筛选条件进键里：换筛选就是换一份数据。 */
export const similarityGroupsKey = ["similarity", "groups"] as const;


const SIMILARITY_PAGE_SIZE = 60;

/** 当前筛选切面共用一个无限分页缓存，页码由 pageParams 管理。 */
export function similarityGroupsQueryKey(query: SimilarityGroupQuery = {}) {
  return [
    ...similarityGroupsKey,
    query.kind ?? "",
    query.status ?? "",
    query.folder ?? "",
  ] as const;
}

/**
 * 相似照片分组列表。
 *
 * 服务端已经算好了分组，这里只负责按条件取一页；
 * 人工决定（换代表、标记已审查、忽略）会改服务端状态，
 * 因此写完之后要重新取列表，而不是本地改一改就当成了。
 */
export function useSimilarityGroups(query: SimilarityGroupQuery = {}) {
  const client = useQueryClient();
  const { kind, status, folder } = query;
  const stableKey = useMemo(
    () => similarityGroupsQueryKey({ kind, status, folder }),
    [kind, status, folder],
  );

  const list = useInfiniteQuery({
    queryKey: stableKey,
    queryFn: ({ pageParam }) =>
      similarityApi.groups({
        kind,
        status,
        folder,
        limit: SIMILARITY_PAGE_SIZE,
        offset: pageParam,
      }),
    initialPageParam: 0,
    getNextPageParam: (lastPage, pages) => {
      const loaded = pages.reduce(
        (count, page) => count + page.page.groups.length,
        0,
      );
      return lastPage.page.groups.length > 0 && loaded < lastPage.page.total
        ? loaded
        : undefined;
    },
  });

  const invalidate = useCallback(async () => {
    await client.invalidateQueries({ queryKey: similarityGroupsKey });
    await client.invalidateQueries({ queryKey: similarityStatusKey });
  }, [client]);

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      body: {
        representative?: string;
        reviewed?: boolean;
        ignored?: boolean;
        status?: SimilarityGroupStatus;
        expectedStatus?: SimilarityGroupStatus;
      };
    }) => similarityApi.update(input.id, input.body),
    // 重新取列表不阻塞这一次写入的返回：反馈（「已把这一组标记为已处理」
    // 与那条撤销）要立刻出现，不能等整页分组取回来。
    onSuccess: () => {
      void invalidate();
    },
  });

  const batch = useMutation({
    mutationFn: (input: {
      action: SimilarityBatchAction;
      groupIds: string[];
    }) => similarityApi.batch(input.action, input.groupIds),
    onSuccess: (_result, input) => {
      void invalidate();
      if (input.action === "pick") {
        void client.invalidateQueries({ queryKey: picksQueryKey });
      }
    },
  });

  /**
   * 按每组各自的原状态恢复。
   *
   * 撤销走它，而不是再翻一次布尔：「全部」视图里的组状态不一，
   * 统一翻会把用户的选择弄乱。
   */
  const restore = useMutation({
    mutationFn: (entries: SimilarityRestoreEntry[]) =>
      similarityApi.restore(entries),
    onSuccess: () => {
      void invalidate();
    },
  });

  const rebuild = useMutation({
    mutationFn: () => similarityApi.rebuild(),
    onSuccess: invalidate,
  });

  const pages = list.data?.pages;
  const page = pages?.[0]?.page;
  const groups = useMemo(
    () => pages?.flatMap((response) => response.page.groups) ?? [],
    [pages],
  );

  return {
    page,
    groups,
    isLoading: list.isLoading,
    isError: list.isError,
    isFetchNextPageError: list.isFetchNextPageError,
    error: list.error,
    refetch: list.refetch,
    fetchNextPage: list.fetchNextPage,
    hasNextPage: list.hasNextPage,
    isFetchingNextPage: list.isFetchingNextPage,
    update,
    batch,
    restore,
    rebuild,
  };
}

/** 整理模块的整体状态：分析覆盖、是否有语义向量、分组是否过期。 */
export function useSimilarityStatus() {
  const query = useQuery({
    queryKey: similarityStatusKey,
    queryFn: () => similarityApi.status(),
    // 分组状态会在后台重建时变化，轮询比等用户手动刷新更省心。
    refetchInterval: 15_000,
  });
  return {
    status: query.data?.status,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** 分组类别的中文名。 */
export function similarityKindLabel(
  kind: SimilarityGroupKind | string,
): string {
  switch (kind) {
    case "exact":
      return "完全重复";
    case "near":
      return "近似重复";
    case "burst":
      return "连拍同场景";
    default:
      return kind;
  }
}

/** 分组类别的说明：这一类到底在说什么。 */
export function similarityKindHint(kind: SimilarityGroupKind | string): string {
  switch (kind) {
    case "exact":
      return "文件内容完全一致，同一张照片存了多份";
    case "near":
      return "画面几乎一致：重新压缩、缩放或轻微裁剪";
    case "burst":
      return "短时间内拍的同一场景，每一张画面都不同";
    default:
      return "";
  }
}

/**
 * 整理状态的中文名。
 *
 * 三档是一列待办：还没处理、处理完了、不再看。
 * 「已审查」是行话 —— 用户在意的不是审没审，而是「这一组我处理了没有」。
 */
export function similarityStatusLabel(
  status: SimilarityGroupStatus | string,
): string {
  switch (status) {
    case "pending":
      return "待处理";
    case "reviewed":
      return "已处理";
    case "ignored":
      return "已忽略";
    default:
      return status;
  }
}

/** 分组里代表照片的成员对象。 */
export function similarityRepresentative(
  group: SimilarityGroup,
): SimilarityGroup["members"][number] | undefined {
  return group.members.find(
    (member) => member.resourceId === group.representative,
  );
}
