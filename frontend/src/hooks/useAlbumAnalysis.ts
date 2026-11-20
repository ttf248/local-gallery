import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { albumsApi, type SmartAlbumDimension, type SmartAlbumOverride } from "../api/albums";
import { aiJobsApi, type AnalysisType } from "../api/aiJobs";
import { smartAlbumQueryKeys } from "./useSmartAlbums";
import { useUIStore } from "../store/uiStore";

interface Options {
  /** 相册 id：分析与重建都作用在它上面。 */
  albumId: string;
  /** 当前分组维度；分组面板关着时不必取分析记录。 */
  dimension: SmartAlbumDimension | null;
}

export interface AlbumAnalysis {
  /** 分析模块的安装状态：推荐维度要知道缺哪个模块。 */
  modules: import("../api/aiJobs").AIJobModule[];
  /** 分析任务记录：知道分析过没有、跑成功没有。 */
  jobs: import("../api/aiJobs").AIJob[];
  /** 人物分析有没有启用。 */
  peopleEnabled: boolean;
  /** 有分析任务正在跑。 */
  analyzing: boolean;
  /** 正在重建分组。 */
  rebuilding: boolean;
  /** 把整本相册加入分析队列。 */
  analyzeAlbum: () => Promise<void>;
  /** 只补某个模块的分析。 */
  analyzeDimension: (type: AnalysisType) => Promise<void>;
  /** 按当前分析结果重建分组。 */
  rebuild: () => Promise<void>;
  /** 用户对分组的修正：改名或隐藏。 */
  saveOverride: (
    groupId: string,
    override: { name?: string; hidden?: boolean },
  ) => Promise<boolean>;
}

/**
 * 相册页的分析动作。
 *
 * 分析与重建是次级操作：它们决定分组里有没有东西，但不决定用户看得到
 * 什么。因此这一层只管「点了会发生什么」，界面上的入口在相册的更多
 * 菜单与分组面板里 —— 页面主视觉上是照片，不是分析进度。
 */
export function useAlbumAnalysis({
  albumId,
  dimension,
}: Options): AlbumAnalysis {
  const queryClient = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const [analyzingJobIds, setAnalyzingJobIds] = useState<string[]>([]);
  const [rebuilding, setRebuilding] = useState(false);

  const jobsQuery = useQuery({
    queryKey: ["ai-jobs"],
    queryFn: aiJobsApi.list,
    // 分组面板开着才需要分析记录；分析跑着的时候要盯着它。
    enabled: dimension !== null || analyzingJobIds.length > 0,
    refetchInterval: analyzingJobIds.length > 0 ? 2_000 : false,
  });

  const analyzeAlbum = useCallback(async () => {
    try {
      const result = await aiJobsApi.startAll("incremental", albumId);
      const ids = result.jobs.map((job) => job.id);
      if (ids.length === 0) {
        pushToast({ kind: "info", message: "当前相册没有可启动的分析模块" });
        return;
      }
      setAnalyzingJobIds(ids);
      pushToast({ kind: "success", message: "已加入当前相册的分析队列" });
    } catch {
      pushToast({ kind: "error", message: "分析任务未能启动，请检查任务中心" });
    }
  }, [albumId, pushToast]);

  const analyzeDimension = useCallback(
    async (type: AnalysisType) => {
      try {
        const result = await aiJobsApi.start(type, "incremental", albumId);
        // 追加而不是覆盖：推荐空态可能一次给两个补分析入口，
        // 覆盖会把先启动的那个任务挤出监视范围，结束时不会提示也不会刷新。
        setAnalyzingJobIds((ids) => [...ids, result.job.id]);
        const label =
          type === "face"
            ? "人脸"
            : type === "embedding"
              ? "场景语义"
              : "元数据";
        pushToast({
          kind: "success",
          message: `已加入当前相册的${label}分析队列`,
        });
      } catch {
        pushToast({
          kind: "error",
          message: "分析任务未能启动，请检查任务中心",
        });
      }
    },
    [albumId, pushToast],
  );

  const rebuild = useCallback(async () => {
    if (!dimension) return;
    setRebuilding(true);
    try {
      const response = await albumsApi.rebuildSmartGroups(albumId, dimension);
      queryClient.setQueryData(
        smartAlbumQueryKeys.summary(albumId, dimension),
        response,
      );
      void queryClient.invalidateQueries({
        queryKey: smartAlbumQueryKeys.directoryRoot,
      });
      pushToast({ kind: "success", message: "已按当前分析结果重建分组" });
    } catch {
      pushToast({ kind: "error", message: "分组重建失败，请稍后重试" });
    } finally {
      setRebuilding(false);
    }
  }, [albumId, dimension, pushToast, queryClient]);

  const saveOverride = useCallback(
    async (
      groupId: string,
      override: { name?: string; hidden?: boolean },
    ): Promise<boolean> => {
      if (!dimension) return false;
      try {
        const response = await albumsApi.updateSmartGroup(
          albumId,
          dimension,
          groupId,
          override as SmartAlbumOverride,
        );
        queryClient.setQueryData(
          smartAlbumQueryKeys.summary(albumId, dimension),
          response,
        );
        void queryClient.invalidateQueries({
          queryKey: smartAlbumQueryKeys.directoryRoot,
        });
        pushToast({
          kind: "success",
          message:
            override.name !== undefined
              ? "分组名称已保存"
              : override.hidden
                ? "分组已隐藏"
                : "已取消隐藏",
        });
        return true;
      } catch {
        pushToast({ kind: "error", message: "智能分组修改失败" });
        return false;
      }
    },
    [albumId, dimension, pushToast, queryClient],
  );

  // 分析跑完：刷新分组，并把结果说出来。
  useEffect(() => {
    const jobs = jobsQuery.data?.snapshot.jobs;
    if (!jobs || analyzingJobIds.length === 0) return;
    const jobsByID = new Map(jobs.map((job) => [job.id, job]));
    const selectedJobs = analyzingJobIds.map((id) => jobsByID.get(id));
    if (
      selectedJobs.some(
        (job) =>
          !job ||
          job.status === "pending" ||
          job.status === "running" ||
          job.status === "paused",
      )
    ) {
      return;
    }
    const failed = selectedJobs.some((job) => job?.status === "failed");
    setAnalyzingJobIds([]);
    void queryClient.invalidateQueries({
      queryKey: ["smart-albums", albumId],
    });
    void queryClient.invalidateQueries({
      queryKey: smartAlbumQueryKeys.directoryRoot,
    });
    pushToast({
      kind: failed ? "info" : "success",
      message: failed
        ? "相册分析已结束，部分任务未完成"
        : "相册分析完成，分组已更新",
    });
  }, [
    albumId,
    analyzingJobIds,
    jobsQuery.data,
    pushToast,
    queryClient,
  ]);

  return {
    modules: jobsQuery.data?.snapshot.modules ?? [],
    jobs: jobsQuery.data?.snapshot.jobs ?? [],
    peopleEnabled:
      jobsQuery.data?.snapshot.settings.peopleEnabled ?? false,
    analyzing: analyzingJobIds.length > 0,
    rebuilding,
    analyzeAlbum,
    analyzeDimension,
    rebuild,
    saveOverride,
  };
}
