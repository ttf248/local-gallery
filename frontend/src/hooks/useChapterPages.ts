import { useEffect, useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { libraryApi } from "../api/library";
export function useChapterPages(
  parentId?: string,
  currentId?: string,
  searchAll = false,
) {
  const query = useInfiniteQuery({
    queryKey: ["library", "chapter-pages", parentId],
    enabled: Boolean(parentId),
    staleTime: 60000,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      libraryApi.childrenPage(parentId!, "comic", pageParam, 200, signal),
    getNextPageParam: (last) => last.page.nextCursor || undefined,
  });
  const nodes = useMemo(
    () =>
      query.data?.pages
        .flatMap((p) => p.page.items)
        .filter((n) => n.kind === "album") ?? [],
    [query.data],
  );
  const { hasNextPage, isFetching, isError, fetchNextPage } = query;
  useEffect(() => {
    const i = nodes.findIndex((n) => n.id === currentId);
    if (
      hasNextPage &&
      !isFetching &&
      !isError &&
      (searchAll || (currentId && (i < 0 || i === nodes.length - 1)))
    )
      void fetchNextPage();
  }, [
    nodes,
    currentId,
    searchAll,
    hasNextPage,
    isFetching,
    isError,
    fetchNextPage,
  ]);
  return { nodes, query };
}
