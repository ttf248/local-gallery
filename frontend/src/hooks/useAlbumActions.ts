import { useNavigate } from "react-router-dom";
import { fsApi } from "../api/fs";
import { ApiError } from "../api/client";
import { useFsCapabilities } from "./useFsCapabilities";
import type { CardData } from "../features/library/AlbumTile";
import { copyText } from "../utils/clipboard";
import { decodeFavPath } from "../utils/path";

interface Actions {
  canOpenInExplorer: boolean;
  open: () => void;
  openInExplorer: () => Promise<void>;
  copyLink: () => Promise<void>;
}

// 提供相册右键菜单的动作实现。
// 收藏切换由调用方通过 useFavorites().toggle 触发（避免再订阅 query）。
export function useAlbumActions(item: CardData) {
  const navigate = useNavigate();
  const allowOsOpen = useFsCapabilities();

  const resourceId = decodeFavPath(item.to);

  const actions: Actions = {
    canOpenInExplorer: allowOsOpen && item.variant !== "smart",
    // 「打开」跟着卡片点击走：相册页的集合卡在原地往下走一层，
    // 其余页面就是打开这份内容本身。
    open: () => navigate(item.linkTo ?? item.to),
    openInExplorer: async () => {
      if (!allowOsOpen)
        throw new ApiError(
          403,
          "OS file manager is disabled",
          undefined,
          "os_open_disabled",
        );
      if (item.variant === "smart")
        throw new ApiError(
          400,
          "not a file system resource",
          undefined,
          "invalid_resource_kind",
        );
      await fsApi.openInExplorer(resourceId);
    },
    copyLink: async () => {
      // 保留路由编码，复制当前站点可直接打开的地址。
      const link = new URL(item.to, window.location.origin).href;
      if (!(await copyText(link))) throw new Error("clipboard copy failed");
    },
  };

  return actions;
}
