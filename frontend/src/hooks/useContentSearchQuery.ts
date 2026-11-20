import { useInfiniteQuery } from "@tanstack/react-query";
import {
  aiJobsApi,
  type SemanticSearchRequest,
} from "../api/aiJobs";

/** 一次内容检索：请求条件与提交时刻。 */
export interface ContentSearchSubmission {
  request: SemanticSearchRequest;
  image?: File;
  /** 每次提交换一个：查询键因此不会复用上一次的缓存。 */
  token: number;
}

/**
 * 内容检索的分页查询。
 *
 * 「智能搜索」页与搜索结果页都要知道这一轮搜得怎么样（还在搜？失败了？
 * 命中多少），因此查询本身放在这里，两处共用同一个查询键 ——
 * 同一份结果不会因为两处各查一次而取两遍。
 */
export function useContentSearchQuery(
  submitted: ContentSearchSubmission | null,
) {
  return useInfiniteQuery({
    queryKey: ["semantic-search", submitted?.token],
    enabled: submitted !== null,
    initialPageParam: 0,
    queryFn: ({ pageParam }) => {
      if (!submitted) throw new Error("search query is missing");
      return aiJobsApi.semanticSearch(
        { ...submitted.request, offset: pageParam, limit: 60 },
        submitted.image,
      );
    },
    getNextPageParam: (page) =>
      page.nextOffset < page.total ? page.nextOffset : undefined,
  });
}
