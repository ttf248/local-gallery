import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  favoritesApi,
  historyApi,
  prefsApi,
  type HistoryEntry,
  type Prefs,
} from "../api/prefs";
import { useUIStore } from "../store/uiStore";
import { SettingsView } from "./Settings";

vi.mock("../api/prefs", () => ({
  prefsApi: { get: vi.fn(), patch: vi.fn() },
  favoritesApi: { prune: vi.fn() },
  historyApi: { clear: vi.fn() },
}));
vi.mock("../hooks/useScanSSE", () => ({
  useScanSSE: () => ({ isRunning: false, startWith: vi.fn() }),
}));
vi.mock("../hooks/useLibrary", () => ({
  useLibraryManifest: () => ({ data: undefined }),
}));
vi.mock("../components/settings/ServerConfigPanel", () => ({
  default: () => <div>服务端设置</div>,
}));

const basePrefs: Prefs = {
  maxRecent: 10,
  autoSwitchAlbum: false,
  showSwitchNotif: true,
  theme: "system",
  sidebarCollapsed: false,
  appMode: "photo",
  // 新导航默认全部显示。
  hiddenNavItems: [],
};
const clientForTest = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

/**
 * 渲染设置页的内容。
 *
 * 页签切换由外层接住，内容自己不依赖路由 —— 测试直接给页签 id。
 * 面板按页签条件渲染，所以每个用例都要指明自己在哪一屏：
 * 不指明就会看到「这一屏没有这个控件」的假失败，或者更糟 —— 断言在
 * 另一屏的控件上假通过。
 */
function renderSettings(tab = "interface", client = clientForTest()) {
  const view = render(
    <QueryClientProvider client={client}>
      <SettingsView tab={tab} onSelectTab={vi.fn()} />
    </QueryClientProvider>,
  );
  return {
    ...view,
    rerenderWithTab: (next: string) =>
      view.rerender(
        <QueryClientProvider client={client}>
          <SettingsView tab={next} onSelectTab={vi.fn()} />
        </QueryClientProvider>,
      ),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("__APP_VERSION__", "test");
  useUIStore.setState({ toasts: [] });
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  vi.mocked(prefsApi.patch).mockImplementation(async (patch) => ({
    ...basePrefs,
    ...patch,
  }));
  vi.mocked(favoritesApi.prune).mockResolvedValue({ removed: [] });
  vi.mocked(historyApi.clear).mockResolvedValue({ ok: true });
});
afterEach(() => vi.unstubAllGlobals());

const savedHistory: HistoryEntry[] = ["a_first", "a_second"].map(
  (albumId) => ({
    albumId,
    name: albumId,
    imageCount: 3,
    openedAt: "2026-10-31T10:00:00Z",
  }),
);

it("清理失效收藏成功后收藏列表立即更新", async () => {
  const client = clientForTest();
  const favorites = ["a_valid", "a_missing"];
  client.setQueryData(["favorites"], { favorites });
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  vi.mocked(favoritesApi.prune).mockResolvedValue({ removed: ["a_missing"] });
  renderSettings("data", client);
  fireEvent.click(await screen.findByRole("button", { name: "清理" }));
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "已清理 1 项失效收藏" }),
    ),
  );
  expect(client.getQueryData(["favorites"])).toEqual({
    favorites: ["a_valid"],
  });
});

it("清理时尚未读取收藏列表，不凭删除项伪造空列表", async () => {
  const client = clientForTest();
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  vi.mocked(favoritesApi.prune).mockResolvedValue({ removed: ["a_missing"] });
  renderSettings("data", client);
  fireEvent.click(await screen.findByRole("button", { name: "清理" }));
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "已清理 1 项失效收藏" }),
    ),
  );
  expect(client.getQueryData(["favorites"])).toBeUndefined();
});

it("清理失败不移除缓存收藏", async () => {
  const client = clientForTest();
  const favorites = ["a_valid", "a_missing"];
  client.setQueryData(["favorites"], { favorites });
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  vi.mocked(favoritesApi.prune).mockRejectedValue(new Error("offline"));
  renderSettings("data", client);
  fireEvent.click(await screen.findByRole("button", { name: "清理" }));
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "清理失效收藏失败" }),
    ),
  );
  expect(client.getQueryData(["favorites"])).toEqual({ favorites });
});

it("清空成功立即清空共享历史", async () => {
  const client = clientForTest();
  client.setQueryData(["history"], { history: savedHistory });
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  renderSettings("data", client);
  fireEvent.click(await screen.findByRole("button", { name: "清空" }));
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "已清空最近访问" }),
    ),
  );
  expect(client.getQueryData(["history"])).toEqual({ history: [] });
});

it("清空失败不丢弃原有共享历史", async () => {
  const client = clientForTest();
  client.setQueryData(["history"], { history: savedHistory });
  vi.mocked(prefsApi.get).mockResolvedValue(basePrefs);
  vi.mocked(historyApi.clear).mockRejectedValue(new Error("offline"));
  renderSettings("data", client);
  fireEvent.click(await screen.findByRole("button", { name: "清空" }));
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ message: "清空最近访问失败" }),
    ),
  );
  expect(client.getQueryData(["history"])).toEqual({ history: savedHistory });
});

it("修改保留条数后最近访问重新读取，由服务端按新上限裁剪", async () => {
  const client = clientForTest();
  client.setQueryData(["history"], { history: savedHistory });
  vi.mocked(prefsApi.get).mockResolvedValue({ ...basePrefs, maxRecent: 2 });
  vi.mocked(prefsApi.patch).mockResolvedValue({ ...basePrefs, maxRecent: 1 });
  renderSettings("data", client);
  const decrease = await screen.findByRole("button", {
    name: "减少最近访问保留条数",
  });
  fireEvent.click(decrease);
  await waitFor(() =>
    expect(prefsApi.patch).toHaveBeenCalledWith({ maxRecent: 1 }),
  );
  // 服务端会按新上限裁剪：本地这份标记为失效，下次读到的是裁剪后的列表。
  await waitFor(() =>
    expect(client.getQueryState(["history"])?.isInvalidated).toBe(true),
  );
});

it("修改其他阅读偏好不覆盖更晚加载的历史快照", async () => {
  const client = clientForTest();
  client.setQueryData(["history"], { history: savedHistory });
  renderSettings("reading", client);
  fireEvent.click(
    await screen.findByRole("switch", { name: "阅读到末尾自动切换下一卷" }),
  );
  await waitFor(() => expect(prefsApi.patch).toHaveBeenCalledTimes(1));
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "阅读到末尾自动切换下一卷" }),
    ).toBeEnabled(),
  );
  expect(client.getQueryData(["history"])).toEqual({ history: savedHistory });
});

// 导航分区：逐项开关侧栏入口，存的是生效的隐藏清单。
it("导航分区按当前偏好显示每一项的开关状态", async () => {
  renderSettings("interface");
  // 新导航默认全部显示：每个一级入口回答一个不同的问题，
  // 收起任何一个都会让那一类内容少一条路。
  expect(
    await screen.findByRole("switch", { name: "在照片导航栏显示图库" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.getByRole("switch", { name: "在照片导航栏显示探索" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.getByRole("switch", { name: "在照片导航栏显示我的" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.getByRole("switch", { name: "在照片导航栏显示相似照片" }),
  ).toHaveAttribute("aria-checked", "true");
  // 漫画侧独立：它的入口各是各的。
  expect(
    screen.getByRole("switch", { name: "在漫画导航栏显示书架" }),
  ).toHaveAttribute("aria-checked", "true");
  expect(
    screen.getByRole("switch", { name: "在漫画导航栏显示未读" }),
  ).toHaveAttribute("aria-checked", "true");
});

it("工作台首页固定显示，不提供开关", async () => {
  renderSettings("interface");
  await screen.findByRole("switch", { name: "在漫画导航栏显示未读" });
  expect(
    screen.queryByRole("switch", { name: "在照片导航栏显示首页" }),
  ).not.toBeInTheDocument();
  expect(screen.getAllByText("固定显示")).toHaveLength(2);
});

it("关掉导航项后把生效的隐藏清单写回服务端", async () => {
  const client = clientForTest();
  vi.mocked(prefsApi.patch).mockImplementation(async (patch) => ({
    ...basePrefs,
    ...patch,
  }));
  renderSettings("interface", client);
  fireEvent.click(
    await screen.findByRole("switch", { name: "在照片导航栏显示探索" }),
  );
  await waitFor(() =>
    expect(prefsApi.patch).toHaveBeenCalledWith({
      hiddenNavItems: ["photo.explore"],
    }),
  );
  // 写回后开关立刻变成关着的，不需要刷新页面。
  await waitFor(() =>
    expect(
      screen.getByRole("switch", { name: "在照片导航栏显示探索" }),
    ).toHaveAttribute("aria-checked", "false"),
  );
});

it("保存导航设置失败保留原值并提示", async () => {
  vi.mocked(prefsApi.patch).mockRejectedValueOnce(new Error("offline"));
  renderSettings("interface");
  fireEvent.click(
    await screen.findByRole("switch", { name: "在照片导航栏显示探索" }),
  );
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ kind: "error", message: "保存导航设置失败" }),
    ),
  );
  expect(
    screen.getByRole("switch", { name: "在照片导航栏显示探索" }),
  ).toHaveAttribute("aria-checked", "true");
});

it("读取设置期间显示加载状态", () => {
  vi.mocked(prefsApi.get).mockReturnValue(new Promise(() => {}));
  renderSettings("interface");
  expect(screen.getByRole("status")).toHaveTextContent("正在加载设置");
});

it("读取设置失败提供重试，恢复后可操作", async () => {
  vi.mocked(prefsApi.get).mockRejectedValueOnce(new Error("offline"));
  renderSettings("reading");
  expect(await screen.findByRole("alert")).toHaveTextContent("设置加载失败");
  expect(
    screen.queryByText("加载中…", { exact: true }),
  ).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试加载" }));
  expect(
    await screen.findByRole("switch", { name: "阅读到末尾自动切换下一卷" }),
  ).toBeEnabled();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

// 页签条：四个页签，只有当前这一个是选中的；面板的可访问名就是页签名。
it("页签条有四个页签，只有当前这一个被选中", async () => {
  renderSettings("data");
  const tablist = await screen.findByRole("tablist", { name: "设置页分区" });
  const tabs = within(tablist).getAllByRole("tab");
  expect(tabs.map((tab) => tab.textContent)).toEqual([
    "界面",
    "阅读",
    "数据",
    "服务端",
  ]);
  expect(
    tabs.filter((tab) => tab.getAttribute("aria-selected") === "true"),
  ).toHaveLength(1);
  expect(
    within(tablist).getByRole("tab", { name: "数据" }),
  ).toHaveAttribute("aria-selected", "true");
});

it("当前页签的面板以页签名为可访问名，其余页签的面板不在 DOM 里", async () => {
  renderSettings("data");
  const panel = await screen.findByRole("tabpanel", { name: "数据" });
  expect(panel).toBeInTheDocument();
  expect(screen.queryByRole("tabpanel", { name: "界面" })).not.toBeInTheDocument();
  expect(screen.queryByRole("tabpanel", { name: "阅读" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("tabpanel", { name: "服务端" }),
  ).not.toBeInTheDocument();
});

it("每个页签各自承载对应的一组设置", async () => {
  // 界面：外观与导航。
  const ui = renderSettings("interface");
  expect(
    await screen.findByRole("region", { name: "外观" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("region", { name: "导航" })).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "阅读" })).not.toBeInTheDocument();

  // 阅读：一张整幅的卡。
  ui.rerenderWithTab("reading");
  expect(
    await screen.findByRole("region", { name: "阅读" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("region", { name: "外观" })).not.toBeInTheDocument();

  // 数据：数据卡与备份卡。
  ui.rerenderWithTab("data");
  expect(
    await screen.findByRole("region", { name: "数据" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("region", { name: "备份与恢复" }),
  ).toBeInTheDocument();

  // 服务端：七组面板，不套卡。
  ui.rerenderWithTab("server");
  expect(
    await screen.findByRole("region", { name: "服务端" }),
  ).toBeInTheDocument();
});

// 关于是页脚一行，四个页签之外常驻。
it("关于页脚在每个页签下都在", async () => {
  renderSettings("interface");
  expect(
    await screen.findByRole("region", { name: "关于" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "关于" })).toBeInTheDocument();
});

// 导航分区按工作台分两组列出：两组各是一块，照片那一组在左。
it("导航分区按工作台分成照片与漫画两组", async () => {
  renderSettings("interface");
  await screen.findByRole("switch", { name: "在漫画导航栏显示未读" });
  const nav = screen.getByRole("region", { name: "导航" });
  expect(within(nav).getByText("照片")).toBeInTheDocument();
  expect(within(nav).getByText("漫画")).toBeInTheDocument();
  // 照片组的入口在漫画组之前：读下来先是照片那一套。
  const labels = [...nav.querySelectorAll(".settings-group")].map(
    (group) => group.querySelector(".settings-group__label")?.textContent,
  );
  expect(labels).toEqual(["照片", "漫画"]);
});

// 一组设置行装在同一个行组里：卡够宽时这组行排成两列，标签与控件
// 仍然挨着（分列由 styles/settings.css 的容器查询决定，跟卡宽走，
// 不跟视口走）。分组丢了，两列的排法就没有落脚点。
it("一组设置行装在同一个行组里", async () => {
  renderSettings("interface");
  const appearance = await screen.findByRole("region", { name: "外观" });
  const appearanceRows = appearance.querySelector(".settings-rows");
  expect(appearanceRows).not.toBeNull();
  expect(appearanceRows?.querySelectorAll(".settings-row").length).toBe(4);

  await screen.findByRole("switch", { name: "在漫画导航栏显示未读" });
  const nav = screen.getByRole("region", { name: "导航" });
  for (const group of nav.querySelectorAll(".settings-group")) {
    const rows = group.querySelector(".settings-rows");
    expect(rows).not.toBeNull();
    expect(rows?.querySelectorAll(".settings-row").length).toBeGreaterThan(0);
  }
});

it("后台读取失败保留上次设置", async () => {
  const client = clientForTest();
  client.setQueryData(["prefs"], basePrefs);
  vi.mocked(prefsApi.get).mockRejectedValue(new Error("offline"));
  renderSettings("reading", client);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "仍显示上次加载的设置",
  );
  expect(
    screen.getByRole("switch", { name: "切换时显示通知" }),
  ).toHaveAttribute("aria-checked", "true");
});

it("保存阅读设置失败保留原值并提示，随后可以再次保存", async () => {
  vi.mocked(prefsApi.patch).mockRejectedValueOnce(new Error("offline"));
  renderSettings("reading");
  const toggle = await screen.findByRole("switch", {
    name: "阅读到末尾自动切换下一卷",
  });
  fireEvent.click(toggle);
  await waitFor(() =>
    expect(useUIStore.getState().toasts).toContainEqual(
      expect.objectContaining({ kind: "error", message: "保存阅读设置失败" }),
    ),
  );
  expect(toggle).toHaveAttribute("aria-checked", "false");
  expect(toggle).toBeEnabled();
  vi.mocked(prefsApi.get).mockResolvedValue({
    ...basePrefs,
    autoSwitchAlbum: true,
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toHaveAttribute("aria-checked", "true"));
  expect(prefsApi.patch).toHaveBeenCalledTimes(2);
});

it("保存成功后刷新失败仍展示服务端已确认的新设置", async () => {
  renderSettings("reading");
  const toggle = await screen.findByRole("switch", {
    name: "阅读到末尾自动切换下一卷",
  });
  vi.mocked(prefsApi.get).mockRejectedValue(new Error("offline"));
  fireEvent.click(toggle);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "仍显示上次加载的设置",
  );
  expect(toggle).toHaveAttribute("aria-checked", "true");
  expect(useUIStore.getState().toasts).not.toContainEqual(
    expect.objectContaining({ kind: "error", message: "保存阅读设置失败" }),
  );
});

it("阅读设置保存期间禁止重复请求和交错修改", async () => {
  let finish: (value: Prefs) => void = () => {};
  vi.mocked(prefsApi.patch).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const view = renderSettings("reading");
  const toggle = await screen.findByRole("switch", {
    name: "阅读到末尾自动切换下一卷",
  });
  fireEvent.click(toggle);
  await waitFor(() => expect(toggle).toBeDisabled());
  expect(screen.getByRole("switch", { name: "切换时显示通知" })).toBeDisabled();
  // 切到数据页签后，保存仍在进行中：那里的控件同样不该能改。
  view.rerenderWithTab("data");
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "增加最近访问保留条数" }),
    ).toBeDisabled(),
  );
  expect(
    screen.getByRole("button", { name: "减少最近访问保留条数" }),
  ).toBeDisabled();
  fireEvent.click(toggle);
  expect(prefsApi.patch).toHaveBeenCalledTimes(1);
  vi.mocked(prefsApi.get).mockResolvedValue({
    ...basePrefs,
    autoSwitchAlbum: true,
  });
  await act(async () => {
    finish({ ...basePrefs, autoSwitchAlbum: true });
  });
  await waitFor(() => expect(toggle).toBeEnabled());
});

for (const kind of ["prune", "history"] as const) {
  const buttonName = kind === "prune" ? "清理" : "清空";
  const message = kind === "prune" ? "清理失效收藏失败" : "清空最近访问失败";
  it(`${buttonName}失败明确提示且可以重新操作`, async () => {
    const operation = kind === "prune" ? favoritesApi.prune : historyApi.clear;
    vi.mocked(operation).mockRejectedValueOnce(new Error("offline"));
    renderSettings("data");
    const button = await screen.findByRole("button", {
      name: buttonName,
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({ kind: "error", message }),
      ),
    );
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() =>
      expect(useUIStore.getState().toasts).toContainEqual(
        expect.objectContaining({ kind: "success" }),
      ),
    );
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it(`${buttonName}执行中禁止重复请求`, async () => {
    const operation = kind === "prune" ? favoritesApi.prune : historyApi.clear;
    vi.mocked(operation).mockReturnValue(new Promise<never>(() => {}));
    renderSettings("data");
    const button = await screen.findByRole("button", {
      name: buttonName,
    });
    fireEvent.click(button);
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);
    expect(operation).toHaveBeenCalledTimes(1);
  });
}

// 存储信息搬到任务中心之后，设置页就不该再摆这些。
//
// 两页各叫「缓存」会让用户分不清说的是哪一个：设置页留下的是媒体库
// 索引与派生缓存的清理入口，模型权重与分析产物在任务中心。
it("设置页不再展示模型、路径与派生缓存占用", async () => {
  renderSettings("data");
  await screen.findByText("媒体库索引");

  expect(screen.queryByText("缓存占用")).not.toBeInTheDocument();
  expect(screen.queryByText("本机 AI 与存储")).not.toBeInTheDocument();
  expect(screen.queryByText("模型与缓存路径")).not.toBeInTheDocument();
  expect(screen.queryByText("一键全清")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /清空 .* 缓存/ })).toBeNull();

  // 设置页仍然保留它自己的东西。
  expect(screen.getByText("媒体库索引")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "关于" })).toBeInTheDocument();
});
