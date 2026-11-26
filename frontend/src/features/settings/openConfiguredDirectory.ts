import { fsApi } from "../../api/fs";
import { useUIStore } from "../../store/uiStore";
import { fileManagerErrorMessage } from "../../utils/fileManager";

/**
 * 在系统文件管理器里打开一个「已配置的目录」。
 *
 * 设置中的目录统一使用已配置路径白名单入口，与媒体资源 ID 接口区分。
 */
export async function openConfiguredDirectory(path: string): Promise<void> {
  const ui = useUIStore.getState();
  try {
    await fsApi.openConfiguredPath(path);
    ui.pushToast({ kind: "success", message: "已请求打开目录", ttl: 1200 });
  } catch (e: unknown) {
    ui.pushToast({ kind: "error", message: fileManagerErrorMessage(e) });
  }
}
