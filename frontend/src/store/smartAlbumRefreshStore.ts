import { create } from "zustand";
import type { SmartAlbumRefreshProgress } from "../api/albums";

// 智能相册刷新状态共享 store：
//   - 单一来源：面板与其它页面看到的都是同一份进度
//   - 不落盘：任务号只在内存里。刷新页面后由服务端的「当前任务」接口
//     重新认领 —— 落盘的任务号会指向服务重启前的旧任务，订阅它只会
//     一直连不上。
interface SmartAlbumRefreshState {
  jobId: string | null;
  progress: SmartAlbumRefreshProgress | null;
  setActive: (id: string) => void;
  setProgress: (progress: SmartAlbumRefreshProgress) => void;
  clear: () => void;
}

export const useSmartAlbumRefreshStore = create<SmartAlbumRefreshState>()(
  (set) => ({
    jobId: null,
    progress: null,
    setActive: (id) => set({ jobId: id, progress: null }),
    setProgress: (progress) => set({ progress }),
    clear: () => set({ jobId: null, progress: null }),
  }),
);
