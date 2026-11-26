import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { aiJobsApi, type AIWorkerStatus } from "../api/aiJobs";
import type { ContentSearchSubmission } from "./useContentSearchQuery";

export interface ContentScope {
  /** 本机运行环境状态；读不出来时为 undefined。 */
  status?: AIWorkerStatus;
  /** 运行环境状态读取失败。 */
  statusError: boolean;
  /** 已经提交的那一轮检索；还没提交时为 null。 */
  submitted: ContentSearchSubmission | null;
  /** 重新提交同一条件（换一个提交时刻，查询键因此不复用旧缓存）。 */
  resubmit: () => void;
}

/**
 * 搜索结果页的「画面与文字」这一档。
 *
 * 关键词住在地址里，因此这一档自己把关键词变成一次检索：先等本机模型
 * 状态 —— 可用时同时查画面语义与图片文字，不可用时至少还能查文字。
 *
 * 用户要的一直是「画面」；系统退成只查文字这件事，在结果为零时必须
 * 说出来（见 utils/contentSearchState.ts）。
 */
export function useContentScope(query: string, enabled: boolean): ContentScope {
  const statusQuery = useQuery({
    enabled,
    queryKey: ["ai-embedding-status"],
    queryFn: aiJobsApi.embeddingStatus,
    staleTime: 30_000,
    retry: false,
  });
  const status = statusQuery.data?.status;
  const embeddingReady = Boolean(status?.runtimeReady && status.modelValid);
  const [submitted, setSubmitted] = useState<ContentSearchSubmission | null>(
    null,
  );
  const submittedKey = useRef("");

  useEffect(() => {
    if (!enabled || !query) {
      submittedKey.current = "";
      setSubmitted(null);
      return;
    }
    // 先等模型状态：可用时同时查画面与文字，不可用时至少还能查文字。
    if (!statusQuery.isSuccess && !statusQuery.isError) return;
    const key = `${query}|${embeddingReady}`;
    if (submittedKey.current === key) return;
    submittedKey.current = key;
    setSubmitted({
      request: {
        kind: "photo",
        ...(embeddingReady
          ? { text: query, ocrText: query, matchMode: "any" as const }
          : { ocrText: query }),
      },
      token: Date.now(),
    });
  }, [enabled, query, embeddingReady, statusQuery.isError, statusQuery.isSuccess]);

  const resubmit = useCallback(() => {
    setSubmitted((current) =>
      current ? { ...current, token: Date.now() } : current,
    );
  }, []);

  return { status, statusError: statusQuery.isError, submitted, resubmit };
}
