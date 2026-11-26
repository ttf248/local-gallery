import type { AIJob } from "../api/aiJobs";

/**
 * 本次任务的完成百分比。
 *
 * 分母是「本次实际要处理的张数」而不是整库规模：增量任务里整库大部分
 * 文件已经是最新的，拿整库当分母会让进度一上来就接近满格。
 * 清单还没整理出来时 planned 为 0，进度是 0 而不是满格。
 */
export function jobProgressPercent(job: AIJob): number {
  const planned = job.planned ?? 0;
  if (planned <= 0) {
    return job.status === "completed" ? 100 : 0;
  }
  const completed = job.completed ?? 0;
  return Math.min(100, Math.max(0, Math.round((completed / planned) * 100)));
}

export function taskModuleLabel(type: AIJob["type"]): string {
  switch (type) {
    case "metadata":
      return "元数据分析";
    case "embedding":
      return "向量索引";
    case "ocr":
      return "文字识别";
    case "portrait":
      return "精选人物头像";
    case "face":
      return "人脸识别";
    case "similarity":
      return "相似照片特征";
    default:
      return type;
  }
}
