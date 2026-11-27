import {Page} from "../shell/Page";
import {buttonStyles} from "../ui/buttonStyles";
import { useConfirm } from "../features/common/ConfirmDialog";
import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useScanSSE } from "../hooks/useScanSSE";
import { useMarkAlbumRead, useMarkAlbumsRead } from "../hooks/useImageActivity";
import { scanApi } from "../api/scan";
import { useHistoryCards } from "../hooks/useHistory";
import { useImageActivities } from "../hooks/useImageActivity";
import { libraryApi } from "../api/library";
import AlbumGrid, { type CardData } from "../features/library/AlbumGrid";
import { EmptyState } from "../ui/EmptyState";
import {
  ContinueReadingHero,
  UnreadHero,
} from "../features/comic/ContinueReadingHero";
import { useUIStore } from "../store/uiStore";
import { useAppMode } from "../hooks/useAppMode";
import PhotoTimeline from "./PhotoTimeline";
import { settingsRoute,
  readerRoute,
  albumRoute,
  decodeFavPath,
  homeRoute,
  libraryRoute,
  recentsRoute,
} from "../utils/path";
import { timeAgo } from "../utils/date";
import { useLibraryDashboard, useLibraryManifest } from "../hooks/useLibrary";
import { nodeSummaryToCard } from "../utils/libraryCard";
import { LibraryIcon, RefreshIcon } from "../ui/icons";

/**
 * 工作台首页。
 *
 * 照片侧是**时间线**：第一屏就是照片本身，按拍摄证据排下来，往下滚就是
 * 往回走时间。想按目录翻的去相册，想按人物、地点、主题找的去发现。
 *
 * 漫画侧是**续读页**：正在读的那本与还没翻开的那些。它不需要目录索引，
 * 因为漫画的组织方式是作品与卷，不是文件夹。
 */
export default function Home() {
  const { mode } = useAppMode();
  return mode === "comic" ? <ComicHome /> : <PhotoTimeline />;
}

/**
 * 两个工作台共用的页头：标题、库的一行事实、两个动作。
 *
 * 页头刻意短：标题之下只留一句事实（多少相册、上次更新什么时候），
 * 描述与统计一律不进这一屏 —— 首页的第一屏是照片，不是关于照片的说明。
 */
function HomeHeader({
  title,
  primaryAction,
}: {
  title: string;
  primaryAction: { to: string; label: string };
}) {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const { mode } = useAppMode();
  const sse = useScanSSE();
  const pushToast = useUIStore((s) => s.pushToast);
  const librarySize =
    mode === "comic"
      ? `${manifest?.statistics.comicAlbumCount ?? 0} 卷`
      : `${manifest?.statistics.photoAlbumCount ?? 0} 本相册`;
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId);
      pushToast({ kind: "info", message: "扫描已开始" });
    },
    onError: () => pushToast({ kind: "error", message: "启动扫描失败" }),
  });

  return (
    <Page as="section" className="page-heading pt-8 pb-5 max-sm:pt-5 max-sm:pb-4">
      <div className="home-heading grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 [align-items:end] [@media(min-width:2240px)]:grid-cols-[auto_minmax(0,1fr)_auto] [@media(min-width:2240px)]:gap-y-0 [@media(min-width:2240px)]:[align-items:last_baseline]">
        <div className="home-heading__title col-span-2 row-start-1 min-[2240px]:col-span-1 min-w-0">
          {/* 工作台首页的主标题是 32px（与照片侧同一档）：两侧都是入口页，
              标题要压得住首屏；数量与时间退到下面一行的辅助字里。 */}
          <h1 className="page-title [.page-heading_&]:mt-2 font-display text-display leading-[1.25] font-semibold tracking-[-0.02em] text-ink [@media(max-width:640px)]:text-title [.album-summary_&]:text-[clamp(26px,2.8vw,38px)] [.album-summary_&]:[overflow-wrap:anywhere]">{title}</h1>
        </div>
        <p className="home-heading__desc col-start-1 row-start-2 min-[2240px]:col-start-2 min-[2240px]:row-start-1 min-w-0 text-caption text-ink-2">
          {manifest ? (
            <>
              <span className="tabular-nums">{librarySize}</span>
              {manifest.scannedAt ? (
                <>
                  <span className="text-ink-3">，</span>
                  <span className="text-ink-3">
                    上次更新 {timeAgo(manifest.scannedAt)}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            "尚未加载图像库"
          )}
        </p>
        <div className="home-heading__actions col-start-2 row-start-2 justify-self-end min-[2240px]:col-start-3 min-[2240px]:row-start-1 flex items-center gap-2">
          {/* 通向完整相册的明确入口：首页给的是照片，目录在相册里。
              两段文字按断点各显示一段，屏幕阅读器却会把两段都读出来
              （「相册相册」），因此这里显式给一个可访问名。 */}
          <Link
            to={primaryAction.to}
            className={buttonStyles({variant:"secondary",size:"sm"})}
            aria-label={primaryAction.label}
          >
            <LibraryIcon size={13} />
            <span className="hidden sm:inline">{primaryAction.label}</span>
            <span className="sm:hidden">{primaryAction.label}</span>
          </Link>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className={buttonStyles({variant:"secondary",size:"sm"})}
            title="扫描 (Ctrl+S)"
            aria-label="重新扫描媒体目录"
          >
            <RefreshIcon size={13} />
            <span className="hidden sm:inline">
              {sse.isRunning
                ? "扫描中…"
                : startScan.isPending
                  ? "启动中…"
                  : "重新扫描"}
            </span>
          </button>
        </div>
      </div>
    </Page>
  );
}

/** 漫画首页：续读页。 */
function ComicHome() {
  const confirm = useConfirm();
  const navigate = useNavigate();
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;
  const dashboardQuery = useLibraryDashboard();
  const dashboard = dashboardQuery.data?.dashboard;
  const pushToast = useUIStore((s) => s.pushToast);

  const libraryHasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const sideHasContent = (manifest?.statistics.comicAlbumCount ?? 0) > 0;
  const otherSideHasContent = (manifest?.statistics.photoAlbumCount ?? 0) > 0;
  const hasContent = sideHasContent;
  const isLoadingInitial = manifestQuery.isLoading;

  const inProgressAll = useMemo(
    () =>
      (dashboard?.inProgress ?? []).map((item) => ({
        ...nodeSummaryToCard(item.album, "c:"),
        progress: { index: item.pageIndex, total: item.pageCount },
      })),
    [dashboard],
  );
  const unreadCards = useMemo<CardData[]>(
    () =>
      (dashboard?.unread ?? []).map((album) => ({
        ...nodeSummaryToCard(album, "u:"),
        progress: { index: 0, total: album.imageCount ?? 0 },
      })),
    [dashboard],
  );
  const unreadCount = dashboard?.unreadCount ?? 0;
  const hasNoReadingActivity =
    dashboardQuery.isSuccess && inProgressAll.length === 0 && unreadCount === 0;

  const randomAlbum = useMutation({
    mutationFn: (scope: "any" | "unread") =>
      libraryApi.randomAlbums("comic", scope),
    onSuccess: ({ albums }) => {
      const album = albums[0];
      if (album) navigate(albumRoute("comic", album.id));
    },
    onError: (_error, scope) =>
      pushToast({
        kind: "info",
        message: scope === "unread" ? "没有未读相册可跳" : "尚未加载图像库",
      }),
  });
  const onShuffleUnread = () => randomAlbum.mutate("unread");

  // 「继续阅读」管理：单本标记已读 / 一键全部标记已读。
  //
  // 关键决策：这里也走 mark-as-read（与「未读」一致），不走 DELETE。
  // 原因：DELETE 删完 record 会变成「无 record」状态，立刻被「未读」判定
  // 收编，给人「清空换皮出现」的错觉。mark-as-read 把 progress 推到 total，
  // 这本就直接从首页两个 hero 都消失。
  const markReadContinue = useMarkAlbumRead();
  const markReadAllContinue = useMarkAlbumsRead();
  const onRemoveContinue = (card: CardData) => {
    const albumId = decodeFavPath(card.to);
    const total = card.progress?.total ?? 0;
    if (total <= 0) {
      pushToast({ kind: "error", message: "该相册为空，无法标记" });
      return;
    }
    markReadContinue.mutate(
      { albumId, total },
      {
        onSuccess: () =>
          pushToast({
            kind: "info",
            message: `已将「${card.title}」标记为已读完`,
          }),
        onError: () =>
          pushToast({ kind: "error", message: "标记失败，请重试" }),
      },
    );
  };
  const onClearContinue = async () => {
    if (!inProgressAll.length) return;
    const ok = await confirm({
      title: "更新阅读进度",
      description: `将 ${inProgressAll.length} 本相册全部标记为已读完？原始文件会保留。`,
      confirmLabel: "全部标记已读",
      tone: "danger",
    });
    if (!ok) return;
    const items = inProgressAll.map((c) => ({
      albumId: decodeFavPath(c.to),
      total: c.progress?.total ?? 0,
    }));
    markReadAllContinue.mutate(items, {
      onSuccess: (r) => {
        if (r.failed === 0) {
          pushToast({ kind: "info", message: `已将 ${r.ok} 本标记为已读完` });
        } else {
          pushToast({
            kind: "error",
            message: `已标记 ${r.ok} 本，失败 ${r.failed} 本`,
          });
        }
      },
      onError: () => pushToast({ kind: "error", message: "标记失败，请重试" }),
    });
  };

  const markReadOne = useMarkAlbumRead();
  const onMarkReadUnread = (card: CardData) => {
    const albumId = decodeFavPath(card.to);
    const total = card.progress?.total ?? 0;
    if (total <= 0) {
      pushToast({ kind: "error", message: "该相册为空，无法标记" });
      return;
    }
    markReadOne.mutate(
      { albumId, total },
      {
        onSuccess: () =>
          pushToast({
            kind: "info",
            message: `已将「${card.title}」标记为已读完`,
          }),
        onError: () =>
          pushToast({ kind: "error", message: "标记失败，请重试" }),
      },
    );
  };

  // 最近阅读：读过的那些卷。
  //
  // 与「继续阅读」不是一回事：继续阅读是还没读完的（正在读），这里是
  // 已经翻过的 —— 读完的、或者只读了开头就想回头翻两页的。刚合上一本
  // 想找回来时，入口在这里。
  const recentHistory = useHistoryCards("comic", hasContent);
  const recentIds = useMemo(
    () => recentHistory.cards.map((card) => decodeFavPath(card.to)),
    [recentHistory.cards],
  );
  const { data: recentActivities } = useImageActivities(recentIds, hasContent);
  const recentCards = useMemo<CardData[]>(
    () =>
      recentHistory.cards
        .map((card) => {
          const activity = recentActivities?.[decodeFavPath(card.to)];
          if (!activity) return card;
          // 带上进度：读过的卷不该挂一枚「未读」点，读完了也不该
          // 看着像没翻开过。
          return {
            ...card,
            progress: {
              index: activity.pageIndex,
              total: card.imageCount ?? 0,
            },
          };
        })
        .slice(0, 8),
    [recentHistory.cards, recentActivities],
  );

  return (
    <div className="home-page comic-library-home min-h-full">
      <HomeHeader
        title="漫画库"
        primaryAction={{ to: libraryRoute("comic"), label: "书架" }}
      />

      {hasContent && (inProgressAll.length > 0 || unreadCards.length > 0) ? (
        <Page >
          <div className="grid min-w-0 gap-section">
            {inProgressAll.length > 0 ? (
              <ContinueReadingHero
                cards={inProgressAll}
                onContinue={(card) =>
                  navigate(
                    readerRoute(decodeFavPath(card.to), card.progress?.index),
                  )
                }
                onRemove={onRemoveContinue}
                onClearAll={onClearContinue}
              />
            ) : null}
            {unreadCards.length > 0 ? (
              <UnreadHero
                cards={unreadCards}
                count={unreadCount}
                onShuffle={onShuffleUnread}
                onMarkRead={onMarkReadUnread}
              />
            ) : null}
          </div>
        </Page>
      ) : null}

      {/* 最近阅读：读过的卷。放在继续阅读与未读之后 —— 有在读的书时，
          「接着读」才是第一件事；读过的书是回访，不是待办。 */}
      {recentCards.length > 0 ? (
        <Page as="section" className="page-section pt-section comic-library-home__recent pb-section">
          <div className="section-heading flex items-baseline flex-wrap gap-3 mb-4">
            <h2 className="section-title font-display text-heading leading-[1.4] font-semibold text-ink tracking-[-0.01em]">最近阅读</h2>
            <Link to={recentsRoute("comic")} className="ml-auto inline-flex min-h-8 items-center rounded-md bg-sunken px-3 text-label touch:min-h-10">
              全部
            </Link>
          </div>
          <AlbumGrid items={recentCards} variant="grid" />
        </Page>
      ) : null}

      {hasContent && hasNoReadingActivity ? (
        <Page as="section" >
          <EmptyState
            title="还没有开始阅读"
            description="从书架打开一卷漫画。开始阅读后，这里会记住进度并列出未读内容。"
            icon={<LibraryIcon size={20} />}
            action={
              <Link to={libraryRoute("comic")} className={buttonStyles({variant:"primary"})}>
                去书架看看
              </Link>
            }
          />
        </Page>
      ) : null}

      {!hasContent && !isLoadingInitial ? (
        <Page as="section" >
          {libraryHasContent ? (
            <EmptyState
              title="漫画这边还没有内容"
              description={
                otherSideHasContent
                  ? "媒体目录都被设成了另一种内容属性。可以在设置里改属性，或者先去照片那边看看。"
                  : "媒体目录的内容属性与这一侧对不上。可以在设置里改属性。"
              }
              icon={<LibraryIcon size={20} />}
              action={
                <div className="flex items-center gap-3">
                  <Link to={settingsRoute("server")} className={buttonStyles({variant:"secondary"})}>
                    去设置里改属性
                  </Link>
                  {otherSideHasContent && (
                    <Link to={homeRoute("photo")} className={buttonStyles({variant:"primary"})}>
                      去照片库看看
                    </Link>
                  )}
                </div>
              }
            />
          ) : (
            <EmptyState
              title="欢迎使用本地画廊"
              description="首次使用请先设置媒体目录，再开始扫描。目录离线时可在设置中修复。"
              icon={<LibraryIcon size={20} />}
              action={
                <div className="flex items-center gap-3">
                  <Link to={settingsRoute("server")} className={buttonStyles({variant:"secondary"})}>
                    设置媒体目录
                  </Link>
                  <Link to={settingsRoute("storage")} className={buttonStyles({variant:"primary"})}>
                    去设置
                  </Link>
                </div>
              }
            />
          )}
        </Page>
      ) : null}

      <div className="h-8" />
    </div>
  );
}
