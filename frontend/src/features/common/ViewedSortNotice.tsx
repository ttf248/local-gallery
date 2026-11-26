import {Page} from "../../shell/Page";
import type { useHistory } from "../../hooks/useHistory";
import ErrorBanner from "./ErrorBanner";

export default function ViewedSortNotice({
  query,
}: {
  query: ReturnType<typeof useHistory>;
}) {
  if (query.isError) {
    return (
      <Page className="mb-4">
        <ErrorBanner onRetry={() => void query.refetch()} retrying={query.isFetching}>
          最近访问加载失败。
          {query.data ? "仍使用已加载的访问记录。" : "暂按名称排序。"}

        </ErrorBanner>
      </Page>
    );
  }
  if (query.isLoading) {
    return (
      <Page role="status" className="mb-4 text-body text-ink-2">
        正在加载最近访问…
      </Page>
    );
  }
  return null;
}
