import PageHeading from "../components/common/PageHeading";
import ErrorBanner from "../components/common/ErrorBanner";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  prefsApi,
  favoritesApi,
  historyApi,
  type HistoryEntry,
  type Prefs,
} from "../api/prefs";
import {
  favoritesQueryKey,
  historyQueryKey,
  libraryQueryKeys,
} from "../api/queryKeys";
import { prefsQueryOptions } from "../hooks/usePrefs";
import { scanApi } from "../api/scan";
import { useScanSSE } from "../hooks/useScanSSE";
import ThemeSwitcher from "../components/common/ThemeSwitcher";
import Segmented from "../components/common/Segmented";
import DensityControl from "../components/wall/DensityControl";
import { useUIStore } from "../store/uiStore";
import { useLibraryManifest } from "../hooks/useLibrary";
import StateBackupPanel from "../components/settings/StateBackupPanel";
import ServerConfigPanel from "../components/settings/ServerConfigPanel";
import AutoSyncPanel from "../components/settings/AutoSyncPanel";
import { Row, Section } from "../components/settings/SettingsSection";
import PageTabs, { PagePanel } from "../components/common/PageTabs";
import { SETTINGS_TABS, TAB_PAGES, resolveTab, tabRoute } from "../utils/pageTabs";
import ScanWarnings from "../components/common/ScanWarnings";
import Toggle from "../components/common/Toggle";
import { syncHistoryCache } from "../utils/historyCache";
import { useAppMode } from "../hooks/useAppMode";
import { usePhotoStore } from "../store/photoStore";
import { useGalleryStore } from "../store/galleryStore";
import {
  RefreshIcon,
  TrashIcon,
  LibraryIcon,
  SunIcon,
  KeyboardIcon,
  ServerIcon,
  ScrollPageIcon,
  MenuIcon,
} from "../components/common/Icon";
import {
  COMIC_NAV,
  DEFAULT_HIDDEN_NAV_ITEMS,
  PHOTO_NAV,
  type NavEntry,
} from "../utils/navEntries";
import "../styles/settings.css";

/**
 * 设置页。
 *
 * 分区改成页面内的页签：竖轴归侧栏（应用级），横轴归这一页（页面级）。
 * 之前这条横轴是侧栏里的二级菜单 —— 点一项是把页面滚过去，高亮跟着
 * 滚动走，窄屏侧栏收进抽屉后干脆看不见。现在一次只显示一件事：切页签
 * 即换内容，页签的 id 在 URL 路径段里，前进后退与深链都跟着走。
 *
 * 页签按业务分组：界面（外观 + 导航）、阅读、数据（索引 + 备份）、
 * 服务端；关于是页脚一行，不占页签。
 */
export default function Settings() {
  const { tab: tabParam } = useParams();
  const navigate = useNavigate();
  const page = TAB_PAGES.settings;
  const tab = resolveTab(page, tabParam);
  // 不认识的页签落回缺省页签（书签里的旧链接也不会白屏）。
  if (tabParam !== undefined && tabParam !== tab) {
    return <Navigate to={tabRoute(page, tab)} replace />;
  }
  return (
    <SettingsView
      tab={tab}
      onSelectTab={(id) => navigate(tabRoute(page, id))}
    />
  );
}

/**
 * 页签条右侧的一句补充：这一屏在做什么。
 *
 * 页签名只有两个字（「界面」「数据」），光看名字说不清里面装了什么；
 * 这一句补在右边，宽屏上读一眼就知道该往哪看。
 */
const SETTINGS_TAB_META: Record<string, string> = {
  interface: "外观与左侧导航栏",
  reading: "照片与漫画的阅读方式",
  data: "本机数据与备份恢复",
  server: "服务配置与运行环境",
};

/**
 * 设置页的内容。
 *
 * 与路由分开，是为了单测能直接渲染它 —— 页签切换由外层接住，内容自己不
 * 依赖路由。
 */
export function SettingsView({
  tab,
  onSelectTab,
}: {
  tab: string;
  onSelectTab: (id: string) => void;
}) {
  const prefsQuery = useQuery(prefsQueryOptions);
  const { data } = prefsQuery;
  // 访问过的页签。切走的页签不卸载：面板里的草稿与筛选是组件内状态
  // （备份的预览、服务端配置的路径草稿），看一眼别的页签就卸载等于把
  // 用户刚填的东西扔了。没访问过的页签不挂载 —— 首次进页面不渲染
  // 服务端那七组面板。
  const [visitedTabs, setVisitedTabs] = useState<string[]>([tab]);
  useEffect(() => {
    setVisitedTabs((prev) => (prev.includes(tab) ? prev : [...prev, tab]));
  }, [tab]);
  const visited = useMemo(
    () => new Set([...visitedTabs, tab]),
    [visitedTabs, tab],
  );

  // 切页签后内容区回到顶部。页面不重挂载（见 pageBoundaryKey），滚动
  // 位置会留着 —— 从很长的「服务端」切到短的「界面」会停在半空。
  useEffect(() => {
    document
      .querySelector(".app-main")
      ?.scrollTo({ top: 0, behavior: "instant" });
  }, [tab]);

  // 被收起的导航项。偏好还没读回来时用前端默认清单兜底 —— 它与服务端
  // 的默认值一致，所以开关不会出现「先全开再收掉」的闪动。
  const hiddenNavItems = useMemo(
    () => new Set(data?.hiddenNavItems ?? DEFAULT_HIDDEN_NAV_ITEMS),
    [data?.hiddenNavItems],
  );
  const qc = useQueryClient();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed);
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const pushToast = useUIStore((s) => s.pushToast);
  const manifest = useLibraryManifest().data?.manifest;
  const sse = useScanSSE();
  // 工作台模式走服务端偏好；照片与漫画的偏好各自走本地 store，
  // 三者落点不同，在设置页里分开写。
  const { mode: workbenchMode, setMode: setWorkbenchMode } = useAppMode();
  const density = usePhotoStore((s) => s.density);
  const setDensity = usePhotoStore((s) => s.setDensity);
  const showInfo = usePhotoStore((s) => s.showInfo);
  const setShowInfo = usePhotoStore((s) => s.setShowInfo);
  const readerMode = useGalleryStore((s) => s.mode);
  const setReaderMode = useGalleryStore((s) => s.setMode);
  const fit = useGalleryStore((s) => s.fit);
  const setFit = useGalleryStore((s) => s.setFit);
  const direction = useGalleryStore((s) => s.direction);
  const setDirection = useGalleryStore((s) => s.setDirection);

  const patchPrefs = useMutation({
    mutationFn: (p: Partial<Parameters<typeof prefsApi.patch>[0]>) =>
      prefsApi.patch(p),
    onSuccess: (saved, patch) => {
      qc.setQueryData(prefsQueryOptions.queryKey, saved);
      if (patch.maxRecent !== undefined) {
        // 保留条数变了，最近访问要按新上限裁剪。服务端按同一口径裁（保留
        // 最新的若干条），客户端先照着裁一份写回缓存 —— 之后的读取失败
        // 也不该把已经裁掉的记录放回来。
        const limit = saved.maxRecent;
        qc.setQueryData<{ history: HistoryEntry[] }>(
          historyQueryKey,
          (previous) =>
            previous ? { history: previous.history.slice(0, limit) } : previous,
        );
        void qc.invalidateQueries({ queryKey: historyQueryKey });
      }
      void qc.invalidateQueries({ queryKey: prefsQueryOptions.queryKey });
    },
    onError: () => pushToast({ kind: "error", message: "保存阅读设置失败" }),
  });

  // 导航项开关：服务端存的是「生效的隐藏清单」，所以每次改动都把整份
  // 清单写回去，而不是只写差量 —— 差量在并发改动时会互相覆盖。
  const patchNavItem = useMutation({
    mutationFn: (payload: { key: string; visible: boolean }) => {
      const hidden = new Set(data?.hiddenNavItems ?? []);
      if (payload.visible) hidden.delete(payload.key);
      else hidden.add(payload.key);
      return prefsApi.patch({ hiddenNavItems: [...hidden] });
    },
    onMutate: (payload) => {
      // 乐观更新：开关立刻到位，侧栏随之变化；请求失败再回滚。
      const previous = qc.getQueryData<Prefs>(prefsQueryOptions.queryKey);
      const hidden = new Set(previous?.hiddenNavItems ?? []);
      if (payload.visible) hidden.delete(payload.key);
      else hidden.add(payload.key);
      qc.setQueryData<Prefs>(prefsQueryOptions.queryKey, (current) =>
        current ? { ...current, hiddenNavItems: [...hidden] } : current,
      );
      return { previous };
    },
    onSuccess: (saved) => {
      // 侧栏读的是同一份偏好缓存：写回去即生效，不必等重新拉取。
      qc.setQueryData(prefsQueryOptions.queryKey, saved);
    },
    onError: (_error, _payload, context) => {
      if (context?.previous)
        qc.setQueryData(prefsQueryOptions.queryKey, context.previous);
      pushToast({ kind: "error", message: "保存导航设置失败" });
    },
  });

  const pruneFav = useMutation({
    mutationFn: () => favoritesApi.prune(),
    onSuccess: (r) => {
      const removed = new Set(r.removed);
      const keep = (id: string) => !removed.has(id);
      qc.setQueryData<Awaited<ReturnType<typeof favoritesApi.list>>>(
        favoritesQueryKey,
        (previous) =>
          previous ? { favorites: previous.favorites.filter(keep) } : undefined,
      );
      void qc.invalidateQueries({ queryKey: favoritesQueryKey });
      pushToast({
        kind: "success",
        message: `已清理 ${r.removed.length} 项失效收藏`,
      });
    },
    onError: () => pushToast({ kind: "error", message: "清理失效收藏失败" }),
  });

  // 清空媒体库索引。不同于「重新扫描」(会立即起一次新扫描覆盖旧结果),
  // 这里只把索引丢掉,等用户手动点「重新扫描」——避免误清后立刻被一次
  // 长任务占住 UI、掩盖问题。
  const clearScanCache = useMutation({
    mutationFn: () => scanApi.clearCache(),
    onSuccess: () => {
      // 丢弃所有摘要页，避免旧媒体根数据在下一次扫描前短暂回显。
      qc.removeQueries({ queryKey: libraryQueryKeys.root });
      pushToast({
        kind: "success",
        message: "已清空媒体库索引 · 建议点击「重新扫描」重建",
      });
    },
    onError: () => pushToast({ kind: "error", message: "清空媒体库索引失败" }),
  });

  const clearHist = useMutation({
    mutationFn: () => historyApi.clear(),
    onSuccess: () => {
      syncHistoryCache(qc, []);
      pushToast({ kind: "success", message: "已清空最近访问" });
    },
    onError: () => pushToast({ kind: "error", message: "清空最近访问失败" }),
  });

  // Settings 页内也能触发扫描：与 Home / Toolbar 走同一套 SSE。
  const startScan = useMutation({
    mutationFn: () => scanApi.start(),
    onSuccess: (r) => {
      sse.startWith(r.scanId);
      pushToast({ kind: "info", message: "扫描已开始" });
    },
    onError: () => pushToast({ kind: "error", message: "启动扫描失败" }),
  });
  const prefsError = prefsQuery.isError && (
    <ErrorBanner onRetry={() => void prefsQuery.refetch()} retrying={prefsQuery.isFetching} className="mb-6">
      设置加载失败。
      {data ? "仍显示上次加载的设置。" : "请重试加载。"}

    </ErrorBanner>
  );
  if (!data) {
    return (
      <div className="page-shell settings-page pb-10">
        <div className="max-w-3xl">
          <PageHeading
            title="设置"
            eyebrow="你的空间，你的习惯"
            contained
            description="调整外观、阅读方式与本地媒体配置。"
          />
          {prefsError || (
            <div role="status" className="text-fg-muted text-body">
              正在加载设置…
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell settings-page pb-10">
      <PageHeading
        title="设置"
        eyebrow="你的空间，你的习惯"
        contained
        description="外观、导航、阅读方式与本地媒体配置。"
      />
      {prefsError}
      <PageTabs
        tabs={SETTINGS_TABS}
        active={tab}
        onChange={onSelectTab}
        label="设置页分区"
        idPrefix="settings"
        meta={SETTINGS_TAB_META[tab]}
      />
      {/* 每个页签独占整幅内容宽度，按自己的内容排布：
          界面是两列卡片，阅读是一张整幅的卡（照片与漫画并排），
          数据是短卡与长卡 1:2 分栏，服务端是三列面板。 */}
      {visited.has("interface") && (
        <PagePanel idPrefix="settings" tab={SETTINGS_TABS[0]} active={tab}>
          <div className="settings-grid mt-6">
            <Section
              id="appearance"
              title="外观"
              icon={<SunIcon size={13} />}
            >
              {/* 这四行摆在一起，卡够宽时排成两列（见 settings.css 的
                  .settings-rows）：标签与控件挨着，不隔着半张卡。 */}
              <div className="settings-rows">
                <Row label="主题">
                  <ThemeSwitcher />
                </Row>
                {/* 侧栏的折叠只属于宽屏：窄屏侧栏是抽屉，宽度不由折叠决定，
                    设置里也就不再摆这一行 —— 让人改一个当前看不见的东西，
                    等于把设置页变成第二本说明。 */}
                <Row label="侧边栏" className="hidden lg:flex">
                  <Segmented
                    label="侧边栏"
                    value={sidebarCollapsed ? "collapsed" : "expanded"}
                    onChange={(value) => {
                      if ((value === "collapsed") !== sidebarCollapsed) {
                        toggleSidebar();
                      }
                    }}
                    options={[
                      { value: "expanded", label: "展开" },
                      { value: "collapsed", label: "折叠" },
                    ]}
                  />
                </Row>
                <Row label="默认视图">
                  <Segmented
                    label="默认视图"
                    value={viewMode}
                    onChange={setViewMode}
                    options={[
                      { value: "grid", label: "网格" },
                      { value: "list", label: "列表" },
                    ]}
                  />
                </Row>
                {/* 工作台：应用当前面向哪一类目录。它决定列表呈现什么、
                    页面用什么措辞；两类目录的属性在「服务端 › 媒体根目录」里设定。 */}
                <Row label="默认工作台">
                  <Segmented
                    label="默认工作台"
                    value={workbenchMode}
                    onChange={setWorkbenchMode}
                    options={[
                      { value: "photo", label: "照片" },
                      { value: "comic", label: "漫画" },
                    ]}
                  />
                </Row>
              </div>
            </Section>

            <Section
              id="nav"
              title="导航"
              icon={<MenuIcon size={13} />}
              description="左侧导航栏显示哪些入口"
            >
              <div className="settings-split">
                <Group title="照片">
                  {PHOTO_NAV.map((entry) => (
                    <NavRow
                      key={entry.key}
                      entry={entry}
                      visible={!hiddenNavItems.has(entry.key)}
                      disabled={patchNavItem.isPending}
                      onChange={(visible) =>
                        patchNavItem.mutate({ key: entry.key, visible })
                      }
                    />
                  ))}
                </Group>
                <Group title="漫画">
                  {COMIC_NAV.map((entry) => (
                    <NavRow
                      key={entry.key}
                      entry={entry}
                      visible={!hiddenNavItems.has(entry.key)}
                      disabled={patchNavItem.isPending}
                      onChange={(visible) =>
                        patchNavItem.mutate({ key: entry.key, visible })
                      }
                    />
                  ))}
                </Group>
              </div>
              <p className="settings-note">
                收起的入口不再出现在左侧导航栏，页面本身仍能从别处进入。
              </p>
            </Section>
          </div>
        </PagePanel>
      )}

      {visited.has("reading") && (
        <PagePanel idPrefix="settings" tab={SETTINGS_TABS[1]} active={tab}>
          <Section
            id="reading"
            title="阅读"
            icon={<ScrollPageIcon size={13} />}
          >
            {/* 整幅宽度下两组并排：最宽的一行（照片墙密度 + 四档分段控件）
                实测约需 294px，半列只有 273px 放不下。 */}
            <div className="settings-split">
            <Group title="照片">
              <Row label="照片墙密度">
                <DensityControl value={density} onChange={setDensity} />
              </Row>
              <Row label="大图预览显示信息">
                <Toggle
                  label="大图预览显示信息"
                  checked={showInfo}
                  onChange={(v) => setShowInfo(v)}
                />
              </Row>
            </Group>
            <Group title="漫画">
              <Row label="默认显示模式">
                <Segmented
                  label="默认显示模式"
                  value={readerMode}
                  onChange={setReaderMode}
                  options={[
                    { value: "single", label: "单页" },
                    { value: "continuous", label: "连续" },
                    { value: "double", label: "双页" },
                  ]}
                />
              </Row>
              {/* 漫画侧的媒体是页：写「图片适配」会与整册的用词冲突。 */}
              <Row label="默认页面适配">
                <Segmented
                  label="默认页面适配"
                  value={fit}
                  onChange={setFit}
                  options={[
                    { value: "fit", label: "适应" },
                    { value: "width", label: "按宽" },
                    { value: "height", label: "按高" },
                    { value: "original", label: "原始" },
                  ]}
                />
              </Row>
              <Row label="双页翻页方向">
                <Segmented
                  label="双页翻页方向"
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { value: "ltr", label: "左→右" },
                    { value: "rtl", label: "右→左" },
                  ]}
                />
              </Row>
              <Row label="阅读到末尾自动切换下一卷">
                <Toggle
                  label="阅读到末尾自动切换下一卷"
                  checked={data.autoSwitchAlbum}
                  disabled={patchPrefs.isPending}
                  onChange={(v) => patchPrefs.mutate({ autoSwitchAlbum: v })}
                />
              </Row>
              <Row label="切换时显示通知">
                <Toggle
                  label="切换时显示通知"
                  checked={data.showSwitchNotif}
                  disabled={patchPrefs.isPending}
                  onChange={(v) => patchPrefs.mutate({ showSwitchNotif: v })}
                />
              </Row>
            </Group>
            </div>
            <p className="settings-note">
              显示模式、适配与方向只保存在本机浏览器；自动切换与通知保存在服务端，所有设备共享。
            </p>
          </Section>
        </PagePanel>
      )}

      {visited.has("data") && (
        <PagePanel idPrefix="settings" tab={SETTINGS_TABS[2]} active={tab}>
          <div className="settings-grid settings-grid--aside mt-6">
            <Section id="data" title="数据" icon={<LibraryIcon size={13} />}>
              {/* 索引这一项内容多：统计与三个动作挤在一行会读不清，
                  改成标签在上、内容在下的一整块。统计本身也另起一行 ——
                  这一列窄，「103 本相册 · 0 个标签 · 时间戳」与标题并排
                  会从中间断开。 */}
              <div className="settings-block">
                <div>
                  <span className="text-body text-fg">媒体库索引</span>
                  <span className="block mt-0.5 text-meta text-fg-muted">
                    {manifest
                      ? `${manifest.statistics.albumCount} 本相册 · ${manifest.statistics.tagCount} 个标签${
                          manifest.scannedAt
                            ? ` · ${new Date(manifest.scannedAt).toLocaleString("zh-CN", { hour12: false })}`
                            : " · 尚未扫描"
                        }`
                      : "尚未加载"}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <button
                    onClick={() =>
                      void qc.invalidateQueries({
                        queryKey: libraryQueryKeys.root,
                      })
                    }
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-meta transition-colors"
                  >
                    <RefreshIcon size={11} />
                    <span>刷新</span>
                  </button>
                  <button
                    onClick={() => startScan.mutate()}
                    disabled={startScan.isPending || sse.isRunning}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-border-faint hover:bg-bg-subtle text-meta transition-colors disabled:opacity-50"
                    title="扫描 (Ctrl+S)"
                  >
                    <RefreshIcon size={11} />
                    <span>
                      {sse.isRunning
                        ? "扫描中…"
                        : startScan.isPending
                          ? "启动中…"
                          : "重新扫描"}
                    </span>
                  </button>
                  <button
                    onClick={() => clearScanCache.mutate()}
                    disabled={clearScanCache.isPending}
                    className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md border border-danger/40 text-danger hover:bg-danger/5 text-meta transition-colors disabled:opacity-50"
                    title="清空媒体库索引（不会立即重新扫描）"
                  >
                    <TrashIcon size={11} />
                    <span>
                      {clearScanCache.isPending ? "清空中…" : "清空索引"}
                    </span>
                  </button>
                </div>
                {manifest && (
                  <div className="mt-2">
                    <ScanWarnings
                      warnings={manifest.warnings}
                      total={manifest.statistics.warningCount}
                    />
                  </div>
                )}
              </div>
              <Row label="最近访问保留条数">
                <NumberInput
                  value={data.maxRecent}
                  disabled={patchPrefs.isPending}
                  min={1}
                  max={50}
                  onChange={(v) => patchPrefs.mutate({ maxRecent: v })}
                />
              </Row>
              <Row label="清理失效收藏">
                <button
                  onClick={() => pruneFav.mutate()}
                  disabled={pruneFav.isPending}
                  className="h-8 px-3 rounded-md border border-border-faint hover:bg-bg-subtle text-meta transition-colors disabled:opacity-50"
                >
                  {pruneFav.isPending ? "清理中…" : "清理"}
                </button>
              </Row>
              <Row label="清空最近访问" danger>
                <button
                  onClick={() => clearHist.mutate()}
                  disabled={clearHist.isPending}
                  className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-danger/40 text-danger hover:bg-danger/5 text-meta transition-colors disabled:opacity-50"
                >
                  <TrashIcon size={11} />
                  <span>{clearHist.isPending ? "清空中…" : "清空"}</span>
                </button>
              </Row>
            </Section>

            <Section
              id="backup"
              title="备份与恢复"
              icon={<LibraryIcon size={13} />}
            >
              <StateBackupPanel />
            </Section>

            <AutoSyncPanel />
          </div>
        </PagePanel>
      )}

      {visited.has("server") && (
        <PagePanel idPrefix="settings" tab={SETTINGS_TABS[3]} active={tab}>
          {/* 服务端这一段不是一张卡：它由七张自带顶栏的面板组成，再套一层
              白卡就是白卡套白卡。标题与其它分区用同一套说法（图标 + 名字 +
              说明），末尾一条细线收住这一段。 */}
          <section id="server" aria-labelledby="server-heading">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="text-fg-muted shrink-0">
                <ServerIcon size={13} />
              </span>
              <h2 id="server-heading" className="settings-card__title">
                服务端
              </h2>
              <span className="text-meta text-fg-subtle">
                修改后自动保存，部分设置需重启
              </span>
              <span className="section-rule" />
            </div>
            <ServerConfigPanel />
          </section>
        </PagePanel>
      )}

      {/* 关于：页脚一行，不再占一张卡。标题留着（只给读屏与分区跳转用），
          看得见的还是版本与提示。 */}
      <section
        id="about"
        className="settings-footer"
        aria-labelledby="about-heading"
      >
        <h2 id="about-heading" className="sr-only">
          关于
        </h2>
        <span className="font-display text-fg">Local Gallery · 本地画廊</span>
        <span>Web 版 · v{__APP_VERSION__}</span>
        <span className="flex items-center gap-1.5">
          <KeyboardIcon size={12} />
          <span>按</span>
          <kbd className="font-mono px-1.5 py-0.5 rounded border border-border-faint bg-bg-subtle text-fg-muted">
            ?
          </kbd>
          <span>查看所有快捷键</span>
        </span>
        <span>媒体保存在本地，收藏与阅读记录由服务端保存</span>
      </section>
    </div>
  );
}

/**
 * 卡里的一组设置（照片 / 漫画）。
 *
 * 组标题只写一行字，不带底线：卡里已经有分组之间的细线，再加一条
 * 就是两套边界叠在一起。
 */
function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-group">
      <div className="settings-group__label">{title}</div>
      <div className="settings-rows">{children}</div>
    </div>
  );
}

/**
 * 导航项一行：一个入口名 + 一个开关。
 *
 * 工作台首页固定显示，不给开关 —— 收起它，那一侧的侧栏就空了。固定项
 * 写「固定显示」而不是摆一个置灰的开关：置灰的开关读起来像「暂时不能
 * 改」，而这里本来就不该改。这行字紧跟在名字后面，窄屏下设置项会折成
 * 上下两行，它跟着名字走才不会变成一行没有来由的孤字。
 */
function NavRow({
  entry,
  visible,
  disabled,
  onChange,
}: {
  entry: NavEntry;
  visible: boolean;
  disabled: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <div className="settings-row settings-row--inline flex items-center justify-between gap-3 px-4 py-2.5 text-body">
      <span className="flex min-w-0 items-center gap-2.5">
        <entry.Icon size={15} className="shrink-0 text-fg-muted" />
        <span className="truncate">{entry.label}</span>
        {entry.locked && (
          <span className="shrink-0 text-meta text-fg-subtle">固定显示</span>
        )}
      </span>
      {!entry.locked && (
        <Toggle
          label={`在导航栏显示${entry.label}`}
          checked={visible}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </div>
  );
}

function NumberInput({
  value,
  disabled,
  min,
  max,
  onChange,
}: {
  value: number;
  disabled: boolean;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex items-center border border-border-faint rounded-md overflow-hidden">
      <button
        aria-label="减少最近访问保留条数"
        disabled={disabled}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-8 h-8 text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors disabled:opacity-50"
      >
        −
      </button>
      <span className="px-3 h-8 inline-flex items-center text-body tabular-nums min-w-[40px] justify-center">
        {value}
      </span>
      <button
        aria-label="增加最近访问保留条数"
        disabled={disabled}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-8 h-8 text-fg-muted hover:bg-bg-subtle hover:text-fg transition-colors disabled:opacity-50"
      >
        +
      </button>
    </div>
  );
}
