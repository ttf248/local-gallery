import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { libraryApi, type AppMode } from "../api/library";
import { albumRoute } from "../utils/path";
import { useUIStore } from "../store/uiStore";
export function useShuffle(mode: AppMode) {
  const navigate = useNavigate();
  const pushToast = useUIStore((s) => s.pushToast);
  const randomAlbum = useMutation({
    mutationFn: () => libraryApi.randomAlbums(mode),
    onSuccess: ({ albums }) => {
      const album = albums[0];
      if (album) navigate(albumRoute(mode, album.id));
    },
    onError: () => pushToast({ kind: "info", message: "没有可随机打开的相册" }),
  });

  const goShuffle = () => {
    if (!randomAlbum.isPending) randomAlbum.mutate();
  };

  return { shuffle: goShuffle, pending: randomAlbum.isPending };
}
