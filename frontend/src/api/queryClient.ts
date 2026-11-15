import { QueryClient } from '@tanstack/react-query'
import { ApiError, isRetryableStatus } from './client'

/**
 * 全应用共用的 TanStack Query 客户端。
 *
 * 单独成模块是为了让 store 也能拿到它：模式切换要在写服务端偏好后
 * 同步更新 ["prefs"] 缓存，而 store 不是 React 组件，用不了 useQueryClient。
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false,
      // 重试策略只有这一处。请求层（api/client.ts）不再自己重试：
      // 两处都重试时，一个 GET 最多会发出 8 次请求。
      //
      // 值得重试的只有 5xx、408 与 429（见 isRetryableStatus）。404 是
      // 「资源不存在」：标签没了、相册被移走了，重试多少次结果都一样，
      // 却要让页面多等好几秒才说出「找不到」。
      //
      // 400（分页游标失效之类）、401、403 是请求本身不成立，重试没有
      // 意义 —— 页面要立刻拿到失败，才能把「后续媒体加载失败」这条提示
      // 演出来（见 tests/e2e/browse.spec.ts 的分页失败用例）。
      retry: (failureCount, error) => {
        if (error instanceof ApiError && !isRetryableStatus(error.status)) {
          return false
        }
        return failureCount < 3
      },
    },
  },
})
