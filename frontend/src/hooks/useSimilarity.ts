import { useCallback, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  similarityApi,
  type SimilarityBatchAction,
  type SimilarityGroup,
  type SimilarityGroupKind,
  type SimilarityGroupQuery,
  type SimilarityGroupStatus,
} from "../api/similarity";

/** 分组列表的查询键。筛选条件进键里：换筛选就是换一份数据。 */
export const similarityGroupsKey = ["similarity", "groups"] as const;

/** 整理模块状态的查询键。 */
export const similarityStatusKey = ["similarity", "status"] as const;

/**
 * 相似照片分组列表。
 *
 * 服务端已经算好了分组，这里只负责按条件取一页；
 * 人工决定（换代表、标记已审查、忽略）会改服务端状态，
 * 因此写完之后要重新取列表，而不是本地改一改就当成了。
 */
export function useSimilarityGroups(query: SimilarityGroupQuery = {}) {
  const client = useQueryClient();
  const stableKey = useMemo(
    () =>
      [
        ...similarityGroupsKey,
        query.kind ?? "",
        query.status ?? "",
        query.folder ?? "",
        query.offset ?? 0,
      ] as const,
    [query.kind, query.status, query.folder, query.offset],
  );

  const list = useQuery({
    queryKey: stableKey,
    queryFn: () => similarityApi.groups(query),
  });

  const invalidate = useCallback(async () => {
    await client.invalidateQueries({ queryKey: similarityGroupsKey });
    await client.invalidateQueries({ queryKey: similarityStatusKey });
  }, [client]);

  const update = useMutation({
    mutationFn: (input: {
      id: string;
      body: { representative?: string; reviewed?: boolean; ignored?: boolean };
    }) => similarityApi.update(input.id, input.body),
    onSuccess: invalidate,
  });

  const batch = useMutation({
    mutationFn: (input: { action: SimilarityBatchAction; groupIds: string[] }) =>
      similarityApi.batch(input.action, input.groupIds),
    onSuccess: invalidate,
  });

  const rebuild = useMutation({
    mutationFn: () => similarityApi.rebuild(),
    onSuccess: invalidate,
  });

  return {
    page: list.data?.page,
    groups: list.data?.page.groups ?? [],
    isLoading: list.isLoading,
    isError: list.isError,
    error: list.error,
    refetch: list.refetch,
    update,
    batch,
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
export function similarityKindLabel(kind: SimilarityGroupKind | string): string {
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

/** 整理状态的中文名。 */
export function similarityStatusLabel(status: SimilarityGroupStatus | string): string {
  switch (status) {
    case "pending":
      return "待整理";
    case "reviewed":
      return "已审查";
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
  return group.members.find((member) => member.resourceId === group.representative);
}
