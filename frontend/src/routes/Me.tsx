import {buttonStyles} from "../ui/buttonStyles";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Tabs } from "../ui/Tabs";
import { Page } from "../shell/Page";
import { PageHero } from "../shell/PageHero";
import AlbumGrid from "../features/library/AlbumGrid";
import { EmptyState } from "../ui/EmptyState";
import { useAppMode } from "../hooks/useAppMode";
import { useLibraryDashboard } from "../hooks/useLibrary";
import { nodeSummaryToCard } from "../utils/libraryCard";
import { meRoute } from "../utils/path";
import { meTabsFor, resolveMeTab } from "../utils/meTabs";
import Favorites from "./Favorites";
import Picks from "./Picks";
import Recents from "./Recents";

/**
 * 「我的」：我留下的与看过的。
 *
 * 三块数据的性质不同：精选是「这一张值得留着」，收藏是「这个资源值得
 * 留着」，最近浏览是「我刚才在翻什么」。它们在一页里分属三个页签，
 * 名字、图形与说明各自分开 —— 用户不该把「我收藏了一本相册」误读成
 * 「这本里的照片都被我留住了」。
 *
 * 页签 id 进 URL（`/photo/me/picks`）：切页签是一次普通导航，深链能
 * 直接落到某一页签，前进后退也跨页签。
 */
export default function Me() {
  const { mode } = useAppMode();
  const { tab: tabParam } = useParams();
  const tabs = meTabsFor(mode);
  const active = resolveMeTab(mode, tabParam);

  const [summary, setSummary] = useState({ id: "", label: "" });
  const reportSummary = useCallback(
    (label: string) => {
      setSummary((value) =>
        value.id === active.id && value.label === label
          ? value
          : { id: active.id, label },
      );
    },
    [active.id],
  );

  // 访问过的页签。切走的页签不卸载：面板里的筛选是组件内状态，
  // 一眼看别的页签就卸载等于把用户刚挑的排序扔了。没访问过的页签
  // 不挂载 —— 进「我的」不必同时读三份数据。
  const [visitedTabs, setVisitedTabs] = useState<string[]>([active.id]);
  useEffect(() => {
    setVisitedTabs((prev) =>
      prev.includes(active.id) ? prev : [...prev, active.id],
    );
  }, [active.id]);
  const visited = useMemo(
    () => new Set([...visitedTabs, active.id]),
    [visitedTabs, active.id],
  );

  // 认不出的页签 id 落到缺省页签：地址是用户能直接改的地方，
  // 改错了不该给一个空白页。
  if (tabParam && !tabs.some((tab) => tab.id === tabParam)) {
    return <Navigate to={meRoute(mode, tabs[0].id)} replace />;
  }

  return (
    /* 整页撑满内容区的高度：面板里的照片墙与相册网格都是虚拟列表，
       它们要一个确定的高度才排得出行。 */
    <div className="me-page flex h-full min-h-0 flex-col">
      {/* 标题与页签共用一个容器：页签的起点与标题、下面照片的起点
          在同一条网格线上，翻页签时内容不会左右跳。 */}
      <Page className="shrink-0">
        <PageHero
          title={mode === "comic" ? "我的漫画" : "珍藏"}
          meta={summary.id === active.id ? summary.label : active.hint}
          toolbar={
            <Tabs
              items={tabs.map((tab) => ({
                ...tab,
                href: meRoute(mode, tab.id),
              }))}
              value={active.id}
              label={mode === "comic" ? "我的分区" : "珍藏分区"}
            />
          }
        />
      </Page>

      {tabs.map((tab) =>
        visited.has(tab.id) ? (
          <section
            key={tab.id}
            id={"me-panel-" + tab.id}
            aria-label={tab.label}
            hidden={tab.id !== active.id}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {tab.id === "picks" ? (
              <Picks
                embedded
                onSummary={active.id === tab.id ? reportSummary : undefined}
              />
            ) : null}
            {tab.id === "favorites" ? (
              <Favorites
                embedded
                onSummary={active.id === tab.id ? reportSummary : undefined}
              />
            ) : null}
            {tab.id === "recents" ? (
              <Recents
                embedded
                onSummary={active.id === tab.id ? reportSummary : undefined}
              />
            ) : null}
            {tab.id === "reading" ? <ReadingPanel /> : null}
          </section>
        ) : null,
      )}
    </div>
  );
}

/**
 * 在读：读到一半、还没读完的卷。
 *
 * 它来自服务端按真实阅读活动派生的在读清单，与「最近阅读」不是同一份
 * 数据：最近阅读是访问历史（打开过就算），在读是进度（真的翻过页）。
 */
function ReadingPanel() {
  const dashboard = useLibraryDashboard();
  const items = dashboard.data?.dashboard.inProgress;
  const cards = useMemo(
    () =>
      (items ?? []).map((item) => ({
        ...nodeSummaryToCard(item.album),
        progress: { index: item.pageIndex, total: item.pageCount },
      })),
    [items],
  );

  if (dashboard.isLoading) {
    return (
      <Page className="page-section pt-section">
        <p className="text-body text-ink-2">正在读取阅读进度…</p>
      </Page>
    );
  }

  if (dashboard.isError) {
    return (
      <Page className="page-section pt-section">
        <EmptyState
          title="阅读进度读取失败"
          description="服务端暂时没有返回在读清单，稍后重试即可。"
          action={
            <button
              className={buttonStyles({variant:"secondary"})}
              onClick={() => void dashboard.refetch()}
            >
              重试
            </button>
          }
        />
      </Page>
    );
  }

  if (cards.length === 0) {
    return (
      <Page className="page-section pt-section">
        <EmptyState
          title="没有读到一半的卷"
          description="打开任何一卷，读过几页，它就会出现在这里。"
        />
      </Page>
    );
  }

  return (
    <Page className="page-section pt-section">
      <AlbumGrid items={cards} variant="grid" />
    </Page>
  );
}
