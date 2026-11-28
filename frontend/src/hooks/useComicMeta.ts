import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { comicMetaApi, type ComicMetaEditPayload } from "../api/comicMeta";
import { libraryQueryKeys as keys } from "../api/queryKeys";

export function useComicEpisodeType(): "main" | "extra" | "all" {
  const [p] = useSearchParams();
  const ep = p.get("ep");
  return ep === "main" || ep === "extra" ? ep : "all";
}

export function useComicMeta(id: string) {
  return useQuery({
    queryKey: keys.comicMeta(id),
    queryFn: ({ signal }) => comicMetaApi.get(id, signal),
    enabled: Boolean(id),
  });
}
function useComicChange<T, R>(id: string, fn: (value: T) => Promise<R>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        [keys.mode("comic"), keys.comicMeta(id), keys.nodes([])].map(
          (queryKey) => client.invalidateQueries({ queryKey }),
        ),
      );
    },
  });
}
export function useUpdateComicMeta(id: string) {
  return useComicChange(id, (p: ComicMetaEditPayload) =>
    comicMetaApi.update(id, p),
  );
}
export function useResetComicMeta(id: string) {
  return useComicChange(id, () => comicMetaApi.reset(id));
}
export function useRefreshComicMeta(id: string) {
  return useComicChange(id, (online?: boolean) =>
    comicMetaApi.refresh(id, online),
  );
}
export function useSetCollectionCover(id: string) {
  return useComicChange(id, (file: string) => comicMetaApi.cover(id, file));
}
export function useClearCollectionCover(id: string) {
  return useComicChange(id, () => comicMetaApi.cover(id));
}
