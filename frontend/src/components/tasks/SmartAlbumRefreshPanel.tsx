import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError } from "../../api/client";
import { albumsApi, type SmartAlbumDimension } from "../../api/albums";
import { useSmartAlbumRefresh } from "../../hooks/useSmartAlbumRefresh";
import { smartAlbumQueryKeys } from "../../hooks/useSmartAlbums";
import { stampLabel } from "../../utils/date";
import { useUIStore } from "../../store/uiStore";

const DIMENSION_LABELS: Record<SmartAlbumDimension, string> = {
  recommended: "精选推荐",
  time: "时间",
  place: "地点",
  people: "人物",
  scene: "场景",
};

function errorMessage(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === "library_not_ready")
      return "媒体库尚未就绪，请先完成扫描。";
    if (error.code === "smart_album_refresh_failed")
      return "生成任务没能启动，请稍后重试。";
  }
  return "操作失败，请重试。";
}

function failureText(code?: string) {
  switch (code) {
    case "library_not_ready":
      return "媒体库尚未就绪，请先完成扫描。";
    case "library_changed":
      return "媒体库在生成过程中发生了变化，请再生成一次。";
    default:
      return "生成失败，请稍后重试。";
  }
}

/**
 * 智能相册分组的生成面板。
 *
 * 分组本身是派生数据：依据已有的分析结果把每本照片相册按时间、地点、
 * 人物、场景分组。每日计划会在分析之后自动生成一次，这里给的是手动
 * 入口 —— 刚跑完一次增量分析，想立刻看到新的分组时不用等到点。
 */
export default function SmartAlbumRefreshPanel() {
  const client = useQueryClient();
  const pushToast = useUIStore((s) => s.pushToast);
  const refresh = useSmartAlbumRefresh();
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");

  // 分组变了，首页汇总与相册页的分组摘要都要重读。
  useEffect(() => {
    if (refresh.progress?.status !== "complete") return;
    void client.invalidateQueries({ queryKey: ["smart-albums"] });
    void client.invalidateQueries({
      queryKey: smartAlbumQueryKeys.directoryRoot,
    });
  }, [client, refresh.progress?.status]);

  async function start(force: boolean) {
    setStarting(true);
    setError("");
    try {
      const started = await albumsApi.startSmartAlbumRefresh(force);
      refresh.start(started.jobId);
      pushToast({
        kind: "info",
        message: started.reused
          ? "生成已在进行中，接入现有任务"
          : "已开始生成智能相册",
      });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setStarting(false);
    }
  }

  async function cancel() {
    if (!refresh.jobId) return;
    try {
      await albumsApi.cancelSmartAlbumRefresh(refresh.jobId);
      pushToast({ kind: "info", message: "已请求取消生成" });
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  const progress = refresh.progress;
  const running = refresh.isRunning;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : 0;

  return (
    <section
      aria-labelledby="smart-album-refresh-heading"
      className="overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border-faint px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2
            id="smart-album-refresh-heading"
            className="text-title font-semibold text-fg"
          >
            智能相册分组
          </h2>
          <p className="mt-1 max-w-2xl text-meta text-fg-muted">
            按时间、地点、人物、场景分类并精选主题。只依据已完成的分析结果生成，原始照片保持不变。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void start(false)}
            disabled={running || starting}
          >
            {running ? "生成中…" : "增量更新"}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => void start(true)}
            disabled={running || starting}
            title="无视缓存，把所有相册的四类分类与精选推荐全部重算一遍"
          >
            强制重建
          </button>
          {running ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void cancel()}
            >
              取消
            </button>
          ) : null}
        </div>
      </div>

      <div className="px-5 py-4 sm:px-6">
        {running && progress ? (
          <div className="space-y-2" data-testid="smart-album-refresh-progress">
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-bg-subtle"
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="智能相册生成进度"
            >
              <div
                className="h-full rounded-full bg-accent transition-[width] duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-meta tabular-nums text-fg-muted">
              {`正在生成 ${progress.done} / ${progress.total}`}
              {progress.currentAlbumName
                ? ` · ${progress.currentAlbumName} · ${
                    DIMENSION_LABELS[
                      progress.currentDimension as SmartAlbumDimension
                    ] ?? progress.currentDimension
                  }`
                : ""}
              {` · ${Math.round(progress.elapsedMs / 1000)} 秒`}
            </p>
          </div>
        ) : null}

        {refresh.isComplete && progress ? (
          <p
            role="status"
            className="text-meta text-success"
            data-testid="smart-album-refresh-done"
          >
            {`上次生成完成 · ${stampLabel(progress.finishedAt)} · ${progress.albums} 个相册 · 重算 ${progress.rebuilt} · 复用 ${progress.reused} · ${progress.groups} 个分组 · 用时 ${Math.round(progress.elapsedMs / 1000)} 秒`}
          </p>
        ) : null}

        {refresh.isCancelled ? (
          <p role="status" className="text-meta text-fg-muted">
            生成已取消
          </p>
        ) : null}

        {refresh.isError ? (
          <p role="alert" className="text-meta text-danger">
            {failureText(progress?.error)}
          </p>
        ) : null}

        {!running && !progress ? (
          <p className="text-meta text-fg-subtle">
            还没有生成分组。分析完成后生成一次，首页与相册页就能按线索浏览。
          </p>
        ) : null}

        {error ? (
          <p role="alert" className="mt-2 text-meta text-danger">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
