import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { prefsApi, type Prefs } from "../../api/prefs";
import {
  prefsPatchKey,
  prefsQueryOptions,
  usePatchPrefs,
} from "../../hooks/usePrefs";
import { useAppMode } from "../../hooks/useAppMode";
import { useUIStore } from "../../store/uiStore";
import { usePhotoStore } from "../../store/photoStore";
import { useGalleryStore } from "../../store/galleryStore";
import { SettingsGroup, SettingsRow } from "../../ui/SettingsList";
import { Switch } from "../../ui/Switch";
import Segmented from "../../ui/Segmented";
import { DensityControl } from "../wall";
import { ErrorBanner } from "../common";
import {
  SunIcon,
  MoonIcon,
  MonitorIcon,
  KeyboardIcon,
  MenuIcon,
} from "../../ui/icons";
import {
  COMIC_NAV,
  PHOTO_NAV,
  DEFAULT_HIDDEN_NAV_ITEMS,
  type NavEntry,
} from "../../utils/navEntries";

export default function GeneralReadingTab({ active }: { active: boolean }) {
  const { patchPrefs, busy } = usePatchPrefs();
  const theme = useUIStore((state) => state.theme);
  const setTheme = useUIStore((state) => state.setTheme);
  const prefsQuery = useQuery({ ...prefsQueryOptions, enabled: active });
  const { data } = prefsQuery;
  const hiddenNavItems = useMemo(
    () => new Set(data?.hiddenNavItems ?? DEFAULT_HIDDEN_NAV_ITEMS),
    [data?.hiddenNavItems],
  );
  const qc = useQueryClient();
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const sidebarCollapsed = useUIStore((s) => s.sidebar === "collapsed");
  const viewMode = useUIStore((s) => s.viewMode);
  const setViewMode = useUIStore((s) => s.setViewMode);
  const pushToast = useUIStore((s) => s.pushToast);
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

  const patchNavItem = useMutation({
    mutationKey: prefsPatchKey,
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

  const prefsError = prefsQuery.isError && (
    <ErrorBanner
      onRetry={() => void prefsQuery.refetch()}
      retrying={prefsQuery.isFetching}
      className="mb-6"
    >
      设置加载失败。
      {data ? "仍显示上次加载的设置。" : "请重试加载。"}
    </ErrorBanner>
  );

  const readOnly = !data || prefsQuery.isError || busy;
  return (
    <div className="space-y-5">
      {prefsError}
      {!data && !prefsError && <p role="status">正在加载设置…</p>}
      <div className="grid items-start gap-5 lg:grid-cols-2 lg:grid-rows-[auto_1fr]">
        <SettingsGroup
          id="appearance"
          title="外观"
          icon={<SunIcon size={13} />}
        >
          {/* 这几行摆在一起，单列读下来最稳：标签与控件挨着，
                  不隔着半张卡。 */}
          <div className="settings-rows flex flex-col">
            <SettingsRow label="主题">
              <Segmented
                label="主题"
                value={theme}
                onChange={setTheme}
                options={[
                  {
                    value: "light",
                    label: (
                      <>
                        <SunIcon size={14} />
                        浅色
                      </>
                    ),
                  },
                  {
                    value: "dark",
                    label: (
                      <>
                        <MoonIcon size={14} />
                        深色
                      </>
                    ),
                  },
                  {
                    value: "system",
                    label: (
                      <>
                        <MonitorIcon size={14} />
                        跟随系统
                      </>
                    ),
                  },
                ]}
              />
            </SettingsRow>
            {/* 侧栏的折叠只属于宽屏：窄屏侧栏是抽屉，宽度不由折叠决定，
                    设置里也就不再摆这一行 —— 让人改一个当前看不见的东西，
                    等于把设置页变成第二本说明。 */}
            <SettingsRow label="侧边栏" className="hidden lg:grid">
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
            </SettingsRow>
            <SettingsRow label="默认视图">
              <Segmented
                label="默认视图"
                value={viewMode}
                onChange={setViewMode}
                options={[
                  { value: "grid", label: "网格" },
                  { value: "list", label: "列表" },
                ]}
              />
            </SettingsRow>
            {/* 工作台：应用当前面向哪一类目录。它决定列表呈现什么、
                    页面用什么措辞；两类目录的属性在「服务端 › 媒体根目录」里设定。 */}
            <SettingsRow label="默认工作台">
              {data ? (
                <Segmented
                  label="默认工作台"
                  disabled={readOnly}
                  value={workbenchMode}
                  onChange={setWorkbenchMode}
                  options={[
                    { value: "photo", label: "照片" },
                    { value: "comic", label: "漫画" },
                  ]}
                />
              ) : (
                <p className="py-2 text-caption text-ink-2">等待服务端偏好</p>
              )}
            </SettingsRow>
          </div>
        </SettingsGroup>
        <div
          className="min-w-0 space-y-5 scroll-mt-6 lg:col-start-2 lg:row-start-1 lg:row-span-2"
          id="reading"
        >
          <SettingsGroup id="reading-photo" title="照片浏览" actions="本浏览器">
            <SettingsRow label="照片墙密度">
              <DensityControl value={density} onChange={setDensity} />
            </SettingsRow>
            <SettingsRow label="大图预览显示信息">
              <Switch
                label="大图预览显示信息"
                checked={showInfo}
                onChange={(v) => setShowInfo(v)}
              />
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup id="reading-comic" title="漫画阅读">
            <Group title="漫画 · 本浏览器">
              <SettingsRow label="默认显示模式">
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
              </SettingsRow>
              {/* 漫画侧的媒体是页：写「图片适配」会与整册的用词冲突。 */}
              <SettingsRow label="默认页面适配">
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
              </SettingsRow>
              <SettingsRow label="双页翻页方向">
                <Segmented
                  label="双页翻页方向"
                  value={direction}
                  onChange={setDirection}
                  options={[
                    { value: "ltr", label: "左→右" },
                    { value: "rtl", label: "右→左" },
                  ]}
                />
              </SettingsRow>
            </Group>
            {data ? (
              <Group title="漫画 · 所有设备">
                <SettingsRow label="阅读到末尾自动切换下一卷">
                  <Switch
                    label="阅读到末尾自动切换下一卷"
                    checked={data?.autoSwitchAlbum ?? false}
                    disabled={readOnly}
                    onChange={(v) => patchPrefs.mutate({ autoSwitchAlbum: v })}
                  />
                </SettingsRow>
                <SettingsRow label="切换时显示通知">
                  <Switch
                    label="切换时显示通知"
                    checked={data?.showSwitchNotif ?? false}
                    disabled={readOnly}
                    onChange={(v) => patchPrefs.mutate({ showSwitchNotif: v })}
                  />
                </SettingsRow>
              </Group>
            ) : (
              <p className="py-2 text-caption text-ink-2">等待服务端偏好</p>
            )}
          </SettingsGroup>
        </div>
        <SettingsGroup
          id="nav"
          className="lg:col-start-1 lg:row-start-2"
          title="导航"
          icon={<MenuIcon size={13} />}
          description="收起的入口不再出现在左侧导航栏，页面本身仍能从别处进入"
        >
          {data ? (
            <div className="settings-split grid grid-cols-1 sm:grid-cols-2 sm:gap-x-3 sm:divide-x sm:divide-line-subtle">
              <Group title="照片侧">
                {PHOTO_NAV.map((entry) => (
                  <NavRow
                    key={entry.key}
                    entry={entry}
                    scope="照片"
                    visible={!hiddenNavItems.has(entry.key)}
                    disabled={readOnly}
                    onChange={(visible) =>
                      patchNavItem.mutate({ key: entry.key, visible })
                    }
                  />
                ))}
              </Group>
              <Group title="漫画侧">
                {COMIC_NAV.map((entry) => (
                  <NavRow
                    key={entry.key}
                    entry={entry}
                    scope="漫画"
                    visible={!hiddenNavItems.has(entry.key)}
                    disabled={readOnly}
                    onChange={(visible) =>
                      patchNavItem.mutate({ key: entry.key, visible })
                    }
                  />
                ))}
              </Group>
            </div>
          ) : (
            <p className="py-2 text-caption text-ink-2">等待服务端偏好</p>
          )}
        </SettingsGroup>
      </div>
      <footer
        id="about"
        className="rounded-lg border border-line bg-raised px-4 flex flex-wrap items-center justify-between gap-3 py-3 text-caption text-ink-2"
      >
        <span className="font-display text-ink">Local Gallery · 本地画廊</span>
        <span>Web 版 · v{__APP_VERSION__}</span>
        <span className="flex items-center gap-1.5">
          <KeyboardIcon size={12} />
          <span>按</span>
          <kbd className="font-mono px-1.5 py-0.5 rounded border border-line bg-sunken text-ink-2">
            ?
          </kbd>
          <span>查看所有快捷键</span>
        </span>
        <span>媒体保存在本地，收藏与阅读记录由服务端保存</span>
      </footer>
    </div>
  );
}

function Group({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-group sm:[.settings-split>&:nth-child(2)]:pl-3">
      <div className="settings-group__label [padding:12px_0_2px] text-caption font-medium text-ink-2">
        {title}
      </div>
      <div className="settings-rows flex flex-col">{children}</div>
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
  scope,
  visible,
  disabled,
  onChange,
}: {
  entry: NavEntry;
  /** 所属工作台：两侧都有「我的」这样的同名入口，名字里要能分清。 */
  scope: string;
  visible: boolean;
  disabled: boolean;
  onChange: (visible: boolean) => void;
}) {
  return (
    <SettingsRow
      label={
        <span className="flex min-w-0 items-center gap-2.5">
          <span className="truncate">{entry.label}</span>
          {entry.locked && (
            <span className="shrink-0 text-caption text-ink-3">固定显示</span>
          )}
        </span>
      }
    >
      {!entry.locked && (
        <Switch
          label={`在${scope}导航栏显示${entry.label}`}
          checked={visible}
          disabled={disabled}
          onChange={onChange}
        />
      )}
    </SettingsRow>
  );
}
