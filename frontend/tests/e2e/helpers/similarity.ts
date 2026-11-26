import { expect, type APIRequestContext } from "@playwright/test";
import type { AIJob } from "../../../src/api/aiJobs";
import { startAnalysisJob } from "./library";

/** 临时库有上千张媒体。分别检测队列、分析进度与最终状态，保留真实全量任务。 */
export async function runSimilarityAnalysis(request: APIRequestContext) {
  const jobId = await startAnalysisJob(request, {
    type: "similarity",
    mode: "full",
  });

  let lastProgress = "";
  let progressedAt = Date.now();
  let status: string = "";
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/api/ai/jobs/${encodeURIComponent(jobId)}`,
        );
        expect(response.ok()).toBeTruthy();
        const job = (await response.json()) as AIJob;
        const progress = `${job.stage}:${job.processed}:${job.skipped}`;
        if (progress !== lastProgress) {
          lastProgress = progress;
          progressedAt = Date.now();
        }
        status = job.status;
        if (Date.now() - progressedAt >= 180_000) {
          status = `任务停在 ${job.stage}，已处理 ${job.processed}/${job.total}`;
          return true;
        }
        return ["completed", "failed", "cancelled"].includes(status);
      },
      { timeout: 480_000 },
    )
    .toBe(true);
  if (status === "failed") {
    // 临时库刻意写入不可解码的 JPG 和 HEIC，部分失败也会进入终态。
    const response = await request.get(
      `/api/ai/jobs/${encodeURIComponent(jobId)}`,
    );
    const job = (await response.json()) as AIJob;
    expect(job.done).toBe(job.total);
    expect(job.processed).toBeGreaterThan(0);
    expect(job.failed).toBeGreaterThan(0);
    expect(job.errors).toHaveLength(job.failed);
    for (const error of job.errors ?? []) {
      expect(error.path).toMatch(
        /(?:^|\/)sample-(?:broken\/broken\.jpg|format\/photo\.heic)$/,
      );
      if (error.path?.endsWith("/photo.heic")) {
        // 启用格式转换时会由转换器报告失败，关闭时由解码器报告不支持。
        expect(["unsupported", "image_conversion_failed"]).toContain(
          error.code,
        );
      } else {
        expect(error.code).toBe("unsupported");
      }
    }
  } else {
    expect(status).toBe("completed");
  }
}
