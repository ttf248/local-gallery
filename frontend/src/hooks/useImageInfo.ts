import { useQuery } from "@tanstack/react-query";
import { imageInfoApi } from "../api/imageInfo";

/**
 * 图片属性。
 *
 * 走查询缓存：属性面板与属性弹窗读的是同一个文件时，只取一次；
 * 切走再切回来也是热的。它也因此能被统一失效，而不是自己维护一份
 * 「加载中 / 失败 / 重试」的状态机。
 */
export function useImageInfo(fileId: string | null | undefined) {
  const query = useQuery({
    queryKey: ["image-info", fileId],
    queryFn: ({ signal }) => imageInfoApi.get(fileId as string, signal),
    enabled: !!fileId,
    // 不自动重试：面板上就有「重试加载」，让用户决定要不要再试一次。
    // 自动重试会把「读不到」这件事拖成好几秒的等待，属性面板要的是立刻
    // 说清楚读不到。
    retry: false,
  });
  return {
    info: query.data ?? null,
    // 保留原始异常对象：错误码要交给 apiErrorMessage 翻成中文，
    // 只留 message 会把后端的英文原文直接显示给用户。
    err: (query.error as unknown) ?? null,
    loading: query.isLoading,
    refetch: () => {
      void query.refetch();
    },
  };
}
