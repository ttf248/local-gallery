import { useEffect, useMemo } from "react";
import { Link } from "react-router-dom";
import { ApiError } from "../../api/client";
import { type AIWorkerStatus, type SemanticSearchHit } from "../../api/aiJobs";
import type { LibraryFeedItem } from "../../api/library";
import EmptyState from "../../features/common/EmptyState";
import ErrorBanner from "../../features/common/ErrorBanner";
import PhotoWall from "../../features/wall/PhotoWall";
import PhotoViewer from "../../features/viewer/PhotoViewer";
import { SearchIcon } from "../../ui/icons";
import { usePickToggle } from "../../hooks/usePickToggle";
import { usePhotoStore, wallTargetHeight } from "../../store/photoStore";
import { useWallViewer } from "../../hooks/useWallViewer";
import {
  useContentSearchQuery,
  type ContentSearchSubmission,
} from "../../hooks/useContentSearchQuery";
import { albumRoute } from "../../utils/path";
import { contentEmptyState } from "../../utils/contentSearchState";

type ScoredFeedItem = LibraryFeedItem & {
  similarity?: number;
  matchReasons?: SemanticSearchHit["matchReasons"];
};

interface Props {
  submitted: ContentSearchSubmission | null;
  /** 本机运行环境状态；读不出来时为 undefined。 */
  status?: AIWorkerStatus;
  /** 运行环境状态读取失败。 */
  statusError?: boolean;
  /**
   * 用户是不是想按画面找。
   *
   * 与「这次实际查了什么」不是一回事：画面模型没就绪时，系统会退成
   * 只查图片里的文字。用户要的仍然是画面 —— 零结果时要说清是环境
   * 没准备好，而不是说「库里没有」。
   */
  wantsSemantic?: boolean;
  /** 还没提交时那一块的标题与说明。 */
  idleTitle?: string;
  idleDescription?: string;
  /** 重新搜索：重新提交当前条件。 */
  onRetry?: () => void;
  /** 以图搜图：拿当前这张当查询图。 */
  onFindSimilar?: (item: LibraryFeedItem) => void;
}

/**
 * 内容搜索的结果。
 *
 * 「智能搜索」页与搜索结果页用的是同一套检索与呈现 —— 两处各写一遍的
 * 结果是同一个词在两个页面给出两种说法。
 *
 * 三种「没有结果」必须分得开：
 *   - **失败**：请求本身没成功，重试有用；
 *   - **没索引**：画面索引或文字识别还没跑，库里可能有，搜不出来；
 *   - **真的没有**：都查过了，确实没有匹配。
 * 把它们混成一句「没有找到」，用户会以为库里没有那张照片。
 */
export default function ContentSearchResults({
  submitted,
  status,
  statusError = false,
  wantsSemantic,
  idleTitle = "输入条件开始搜索",
  idleDescription = "语义结果按相似度排列；文字或结构化筛选不需要 CLIP。",
  onRetry,
  onFindSimilar,
}: Props) {
  const density = usePhotoStore((state) => state.density);
  const picks = usePickToggle();

  const submittedQuery = useContentSearchQuery(submitted);

  const hits = useMemo<SemanticSearchHit[]>(
    () => submittedQuery.data?.pages.flatMap((page) => page.results) ?? [],
    [submittedQuery.data],
  );
  const items = useMemo<ScoredFeedItem[]>(
    () =>
      hits.map(({ item, similarity, matchReasons }) => ({
        ...item,
        similarity,
        matchReasons,
      })),
    [hits],
  );
  const total = submittedQuery.data?.pages[0]?.total ?? 0;
  const loadMore = () => {
    if (submittedQuery.isFetchNextPageError) return;
    void submittedQuery.fetchNextPage({ cancelRefetch: false });
  };

  // 大图预览：下标、翻页与「关掉后回到刚才那张」只有一份实现。
  const wall = useWallViewer({
    items,
    total,
    albumName: (item) => item.albumName,
    albumHref: (item) => albumRoute("photo", item.albumId),
    hasNextPage: submittedQuery.hasNextPage ?? false,
    isLoadingMore: submittedQuery.isFetchingNextPage,
    loadMoreError: submittedQuery.isFetchNextPageError,
    onLoadMore: loadMore,
    isPicked: picks.isPicked,
    onTogglePick: (item) => picks.toggle(item.id),
  });
  const viewer = wall.viewer;
  const resetWall = wall.reset;

  // 换一轮检索就把大图预览收起来：上一轮的照片不该留在新一轮的结果上。
  useEffect(() => {
    resetWall();
  }, [submitted?.token, resetWall]);

  const modelReady = status ? status.runtimeReady && status.modelValid : null;
  const indexed = status?.coverage.indexed ?? 0;
  const totalPhotos = status?.coverage.total ?? 0;
  const notIndexed = status !== undefined && totalPhotos > 0 && indexed === 0;

  const searchedSemantic = Boolean(
    submitted?.request.text ||
    submitted?.request.resourceId ||
    submitted?.image,
  );
  const searchedOCR = Boolean(submitted?.request.ocrText);
  const searchedBoth = searchedSemantic && searchedOCR;

  const empty = contentEmptyState({
    total,
    statusError,
    modelReady,
    notIndexed,
    wantsSemantic: wantsSemantic ?? searchedSemantic,
    searchedOCR,
    searchedBoth,
  });

  if (submittedQuery.isError && items.length === 0) {
    return (
      <>
        <EmptyState
          title="搜索失败"
          description={semanticErrorMessage(submittedQuery.error)}
          action={
            /* 页面自己已经给了「重新搜索」（传了 onRetry）就不再补一枚：
               同一屏上两个同名的按钮会让人以为它们是两件事。 */
            onRetry ? undefined : (
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => void submittedQuery.refetch()}
              >
                重新搜索
              </button>
            )
          }
        />
        {viewer ? (
          <PhotoViewer
            {...viewer}
            onFindSimilar={
              onFindSimilar
                ? () => {
                    const item = items[viewer.index];
                    if (item) onFindSimilar(item);
                  }
                : undefined
            }
          />
        ) : null}
      </>
    );
  }

  if (items.length > 0) {
    return (
      <>
        {submittedQuery.isError ? (
          <div className="mb-3">
            <ErrorBanner
              kind="warning"
              onRetry={() =>
                submittedQuery.isFetchNextPageError
                  ? void submittedQuery.fetchNextPage({ cancelRefetch: false })
                  : void submittedQuery.refetch()
              }
              retrying={submittedQuery.isFetching}
            >
              {submittedQuery.isFetchNextPageError
                ? "后续搜索结果加载失败，已加载的照片仍可浏览。"
                : "搜索结果更新失败，仍保留已加载的照片。"}
            </ErrorBanner>
          </div>
        ) : null}
        <PhotoWall
          items={items}
          total={Math.max(total, items.length)}
          targetHeight={wallTargetHeight(density)}
          hasNextPage={submittedQuery.hasNextPage ?? false}
          isLoadingMore={submittedQuery.isFetchingNextPage}
          loadMoreError={submittedQuery.isFetchNextPageError}
          onLoadMore={loadMore}
          onOpen={(_item, index) => wall.open(index)}
          albumLabel={(item) => item.albumName}
          itemBadge={(item) => matchBadge(item)}
          isPicked={picks.isPicked}
          onTogglePick={(item) => picks.toggle(item.id)}
          /* 关掉预览后墙回到刚才看的那张：翻了几百张再关掉，
             不该把人丢回墙的顶上。 */
          scrollToIndex={wall.focusIndex}
        />
        {viewer ? (
          <PhotoViewer
            {...viewer}
            onFindSimilar={
              onFindSimilar
                ? () => {
                    const item = items[viewer.index];
                    if (item) onFindSimilar(item);
                  }
                : undefined
            }
          />
        ) : null}
      </>
    );
  }

  if (submitted && !submittedQuery.isLoading) {
    return (
      <>
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={
            empty.action === "tasks" ? (
              <Link to="/tasks/run" className="btn btn-outline">
                打开任务中心
              </Link>
            ) : empty.action === "retry" && onRetry ? (
              <button
                type="button"
                className="btn btn-outline"
                onClick={onRetry}
              >
                重新搜索
              </button>
            ) : undefined
          }
        />
        {viewer ? <PhotoViewer {...viewer} /> : null}
      </>
    );
  }

  return (
    <EmptyState
      title={submitted ? "正在搜索…" : idleTitle}
      description={submitted ? "正在按当前条件检索照片。" : idleDescription}
      icon={<SearchIcon size={24} />}
      dense
    />
  );
}

/**
 * 一张照片为什么被选中。
 *
 * 「语义 0.82」说的是画面像不像，「文字匹配」说的是图里的字对不对 ——
 * 两件事，界面上分开写，用户才知道自己搜到了什么。
 */
function matchBadge(item: ScoredFeedItem): string | undefined {
  const reasons = item.matchReasons ?? [];
  const labels = reasons.flatMap((reason) => {
    if (reason === "semantic") {
      return item.similarity === undefined
        ? ["画面相似"]
        : [`画面 ${item.similarity.toFixed(2)}`];
    }
    if (reason === "similar_image") {
      return item.similarity === undefined
        ? ["以图相似"]
        : [`以图 ${item.similarity.toFixed(2)}`];
    }
    if (reason === "ocr_exact") return ["文字匹配"];
    return ["文字近似"];
  });
  if (labels.length > 0) return labels.join(" · ");
  return item.similarity === undefined
    ? undefined
    : `相似度 ${item.similarity.toFixed(2)}`;
}

function semanticErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "ai_model_missing")
      return "本机模型缺失或校验失败，请检查任务中心的模型状态。";
    if (error.code === "ai_runtime_unavailable")
      return "本机 AI 运行环境不可用，请检查 Python 3.11 与 CUDA 安装。";
  }
  return "语义搜索暂不可用，请稍后重试。";
}
