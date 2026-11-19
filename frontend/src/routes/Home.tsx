import { useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import { useScanSSE } from "../hooks/useScanSSE";
import { useMarkAlbumRead, useMarkAlbumsRead } from "../hooks/useImageActivity";
import { scanApi } from "../api/scan";
import { useHistoryCards } from "../hooks/useHistory";
import { libraryApi } from "../api/library";
import AlbumGrid, { type CardData } from "../components/album/AlbumGrid";
import SmartAlbumPreview, {
  HOME_SMART_ALBUM_PREVIEW,
} from "../components/home/SmartAlbumPreview";
import EmptyState from "../components/common/EmptyState";
import { ContinueHero, UnreadHero } from "../components/home/HomeHeroes";
import ResumeHero from "../components/home/ResumeHero";
import PhotoFeedHero from "../components/home/PhotoFeedHero";
import OnThisDaySection from "../components/home/OnThisDaySection";
import { useUIStore } from "../store/uiStore";
import { useAppMode } from "../hooks/useAppMode";
import {
  albumRoute,
  decodeFavPath,
  exploreRoute,
  homeRoute,
  libraryRoute,
} from "../utils/path";
import { timeAgo } from "../utils/date";
import {
  useLibraryDashboard,
  useLibraryManifest,
  useLibraryRecentAlbums,
  useOnThisDayAlbums,
} from "../hooks/useLibrary";
import { nodeSummaryToCard } from "../utils/libraryCard";
import { LibraryIcon, RefreshIcon } from "../components/common/Icon";
import { useSmartAlbumDirectory } from "../hooks/useSmartAlbums";

/**
 * 工作台首页。
 *
 * 照片侧是**发现页**：第一屏是照片，随后是回忆（那年今日）、接着看
 * （最近浏览）与新进门的相册。它不解释技术，也不把所有功能摆成入口 ——
 * 想按目录翻的去图库，想按时间、人、地点找的去探索。
 *
 * 漫画侧是**续读页**：正在读的那本与还没翻开的那些。它不需要目录索引，
 * 因为漫画的组织方式是作品与卷，不是文件夹。
 */
export default function Home() {
  const { mode } = useAppMode();
  return mode === "comic" ? <ComicHome /> : <PhotoHome />;
}

/**
 * 两个工作台共用的页头：标题、库的一行事实、两个动作。
 *
 * 页头刻意短：标题之下只留一句事实（多少相册、上次更新什么时候），
 * 描述与统计一律不进这一屏 —— 首页的第一屏是照片，不是关于照片的说明。
 */
function HomeHeader({
  title,
  eyebrow,
  primaryAction,
}: {
  title: string;
  eyebrow: string;
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
    <section className="page-shell page-heading">
      <div className="home-heading">
        <div className="home-heading__title">
          <p className="page-eyebrow">{eyebrow}</p>
          <h1 className="page-title page-title--sm">{title}</h1>
        </div>
        <p className="home-heading__desc text-body text-fg-muted">
          {manifest ? (
            <>
              <span className="tabular-nums">{librarySize}</span>
              {manifest.scannedAt ? (
                <>
                  <span className="text-fg-subtle">，</span>
                  <span className="text-fg-subtle">
                    上次更新 {timeAgo(manifest.scannedAt)}
                  </span>
                </>
              ) : null}
            </>
          ) : (
            "尚未加载图像库"
          )}
        </p>
        <div className="home-heading__actions flex items-center gap-2">
          {/* 通向完整图库的明确入口：首页给的是发现，目录在图库里。 */}
          <Link to={primaryAction.to} className="btn btn-sm btn-outline">
            <LibraryIcon size={13} />
            <span className="hidden sm:inline">{primaryAction.label}</span>
            <span className="sm:hidden">图库</span>
          </Link>
          <button
            onClick={() => startScan.mutate()}
            disabled={startScan.isPending || sse.isRunning}
            className="btn btn-sm btn-outline"
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
    </section>
  );
}

/** 照片首页：发现页。 */
function PhotoHome() {
  const manifestQuery = useLibraryManifest();
  const manifest = manifestQuery.data?.manifest;

  // 这一侧有没有内容：整个库都空，与「库有内容但这一侧没有」是两回事，
  // 空态的引导不一样。
  const libraryHasContent = (manifest?.statistics.albumCount ?? 0) > 0;
  const sideHasContent = (manifest?.statistics.photoAlbumCount ?? 0) > 0;
  const otherSideHasContent = (manifest?.statistics.comicAlbumCount ?? 0) > 0;
  const hasContent = sideHasContent;
  const isLoadingInitial = manifestQuery.isLoading;

  // 「接着看」的数据是访问历史：照片相册一直在记，只是原先只有
  // 「最近浏览」页在用。
  const resumeCards = useHistoryCards("photo", hasContent).cards;

  // 「那年今日」只在照片侧成立：漫画没有拍摄时间。
  const today = new Date();
  const onThisDay = useOnThisDayAlbums(
    "photo",
    today.getMonth() + 1,
    today.getDate(),
    6,
    hasContent,
  );
  const onThisDayItems = onThisDay.data?.page.items ?? [];

  // 最近加入：新进门的相册。与「接着看」（我刚才翻过哪本）是两件事。
  const recent = useLibraryRecentAlbums("photo", 12, hasContent);
  const recentCards = useMemo(
    () =>
      (recent.data?.page.items ?? []).map((node) =>
        nodeSummaryToCard(node, "r:"),
      ),
    [recent.data],
  );

  // 少量主题推荐：给一点线索，真正去找去探索页。
  const smart = useSmartAlbumDirectory("featured", hasContent, {
    limit: HOME_SMART_ALBUM_PREVIEW,
  });

  return (
    <div className="home-page min-h-full">
      <HomeHeader
        title="照片库"
        eyebrow="你的照片"
        primaryAction={{ to: libraryRoute("photo"), label: "图库" }}
      />

      {hasContent ? (
        <>
          {/* 第一屏：照片本身。 */}
          <PhotoFeedHero />

          {resumeCards.length > 0 ? (
            <section className="page-shell page-section">
              <div className="home-overview">
                <ResumeHero cards={resumeCards} />
              </div>
            </section>
          ) : null}

          {onThisDayItems.length > 0 ? (
            <OnThisDaySection
              items={onThisDayItems}
              month={today.getMonth() + 1}
              day={today.getDate()}
            />
          ) : null}

          {recentCards.length > 0 ? (
            <section className="page-shell page-section">
              <div className="section-heading">
                <h2 className="section-title">最近加入</h2>
                <span className="section-meta">按拍摄时间，最近的相册</span>
                <Link to={libraryRoute("photo")} className="chip ml-auto">
                  全部图库
                </Link>
              </div>
              <AlbumGrid items={recentCards} variant="grid" />
            </section>
          ) : null}

          <section className="page-shell page-section">
            <div className="section-heading">
              <h2 className="section-title">主题</h2>
              <span className="section-meta">自动聚在一起的照片</span>
              <Link to={exploreRoute()} className="chip ml-auto">
                去探索
              </Link>
            </div>
            <SmartAlbumPreview
              items={smart.items}
              total={smart.total}
              isLoading={smart.isLoading}
              isError={smart.isError}
              onRetry={() => void smart.refetch()}
            />
          </section>
        </>
      ) : null}

      {!hasContent && !isLoadingInitial ? (
        <section className="page-shell">
          {libraryHasContent ? (
            <EmptyState
              title="照片这边还没有内容"
              description={
                otherSideHasContent
                  ? "媒体目录都被设成了另一种内容属性。可以在设置里改属性，或者先去漫画那边看看。"
                  : "媒体目录的内容属性与这一侧对不上。可以在设置里改属性。"
              }
              icon={<LibraryIcon size={20} />}
              action={
                <div className="flex items-center gap-3">
                  <Link to="/settings/server" className="btn btn-outline">
                    去设置里改属性
                  </Link>
                  {otherSideHasContent && (
                    <Link to={homeRoute("comic")} className="btn btn-primary">
                      去漫画库看看
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
                  <Link to="/settings/server" className="btn btn-outline">
                    设置媒体目录
                  </Link>
                  <Link to="/settings/data" className="btn btn-primary">
                    去设置
                  </Link>
                </div>
              }
            />
          )}
        </section>
      ) : null}

      <div className="h-8" />
    </div>
  );
}

/** 漫画首页：续读页。 */
function ComicHome() {
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
  const onClearContinue = () => {
    if (!inProgressAll.length) return;
    const ok = window.confirm(
      `将 ${inProgressAll.length} 本相册全部标记为已读完？\n\n操作不会删除文件，只是把阅读进度推到末尾。`,
    );
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

  return (
    <div className="home-page min-h-full">
      <HomeHeader
        title="漫画库"
        eyebrow="你的漫画"
        primaryAction={{ to: libraryRoute("comic"), label: "书架" }}
      />

      {hasContent && (inProgressAll.length > 0 || unreadCards.length > 0) ? (
        <div className="page-shell">
          <div className="home-overview">
            {inProgressAll.length > 0 ? (
              <ContinueHero
                cards={inProgressAll}
                onContinue={(card) =>
                  navigate(albumRoute("comic", decodeFavPath(card.to)))
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
        </div>
      ) : null}

      {!hasContent && !isLoadingInitial ? (
        <section className="page-shell">
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
                  <Link to="/settings/server" className="btn btn-outline">
                    去设置里改属性
                  </Link>
                  {otherSideHasContent && (
                    <Link to={homeRoute("photo")} className="btn btn-primary">
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
                  <Link to="/settings/server" className="btn btn-outline">
                    设置媒体目录
                  </Link>
                  <Link to="/settings/data" className="btn btn-primary">
                    去设置
                  </Link>
                </div>
              }
            />
          )}
        </section>
      ) : null}

      <div className="h-8" />
    </div>
  );
}
