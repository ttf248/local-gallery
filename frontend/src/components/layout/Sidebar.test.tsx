import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import Sidebar from "./Sidebar";
import { useUIStore } from "../../store/uiStore";
import { historyApi, prefsApi } from "../../api/prefs";

vi.mock("../../hooks/useLibrary", () => ({
  useLibraryActivitySummary: () => ({
    data: { summary: { unreadCount: 69 } },
  }),
}));

vi.mock("../../api/prefs", () => ({
  historyApi: { list: vi.fn().mockResolvedValue({ history: [] }) },
  prefsApi: { get: vi.fn() },
}));

// 侧栏入口的可见性来自服务端偏好。默认清单之外全显示，
// 单个用例可以改写它来验证「收起的入口不出现在侧栏」。
let hiddenNavItems: string[] = [];

const prefsFixture = () => ({
  favorites: [],
  history: [],
  maxRecent: 10,
  autoSwitchAlbum: true,
  showSwitchNotif: true,
  theme: "system" as const,
  sidebarCollapsed: false,
  appMode: "photo" as const,
  hiddenNavItems,
});

vi.mocked(prefsApi.get).mockImplementation(async () => prefsFixture());

// 工作台模式：默认覆盖漫画工作台（侧栏分组与措辞），
// 单个用例可以改写 mode 切到照片工作台。
const appMode = { mode: "comic" as "comic" | "photo", setMode: vi.fn() };
vi.mock("../../hooks/useAppMode", () => ({
  useAppMode: () => ({
    mode: appMode.mode,
    ready: true,
    setMode: appMode.setMode,
  }),
}));

vi.mock("../../api/library", () => ({
  libraryApi: {
    randomAlbums: vi.fn().mockResolvedValue({ albums: [{ id: "x" }] }),
  },
}));

// 侧栏的形态跟视口宽度有关：折叠态（72px 窄栏）只属于宽屏，窄屏侧栏
// 是抽屉。组件用 matchMedia 判断当前宽度，所以单测要给出这个信号。
let wideViewport = true;
beforeAll(() => {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("1024") ? wideViewport : !wideViewport,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

function renderSidebar(collapsed = false, path = "/") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // 偏好先入缓存：侧栏的入口清单随偏好变化，首帧就该是最终状态，
  // 不必等一次请求回来。
  qc.setQueryData(["prefs"], prefsFixture());
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Sidebar
          collapsed={collapsed}
          onToggle={() => {}}
          onCloseMobile={() => {}}
          onShuffle={() => {}}
          onRefresh={() => {}}
          shufflePending={false}
          warningCount={0}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Sidebar", () => {
  beforeEach(() => {
    appMode.mode = "comic";
    appMode.setMode.mockClear();
    hiddenNavItems = [];
    vi.mocked(historyApi.list).mockResolvedValue({ history: [] });
  });

  // 侧栏分三段：内容组（这一侧的主导航）、整理组（写操作，次级）、
  // 本机组（任务中心与设置，属于机器不属于内容）。
  it("漫画工作台列出首页、书架、我的与未读", () => {
    renderSidebar();
    expect(screen.getByText("首页")).toBeInTheDocument();
    expect(screen.getByText("书架")).toBeInTheDocument();
    expect(screen.getByText("我的")).toBeInTheDocument();
    expect(screen.getByText("未读")).toBeInTheDocument();
    // 照片那边的入口不出现在漫画工作台。
    expect(screen.queryByText("探索")).not.toBeInTheDocument();
    expect(screen.queryByText("整理")).not.toBeInTheDocument();
  });

  it("相册详情下高亮当前侧的结构入口", () => {
    const { unmount } = renderSidebar(false, "/comic/albums/c_1");
    expect(screen.getByRole("link", { name: "书架" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    unmount();
    appMode.mode = "photo";
    renderSidebar(false, "/photo/albums/a_1");
    expect(screen.getByRole("link", { name: "相册" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("照片工作台列出照片、相册、发现、珍藏与整理", () => {
    appMode.mode = "photo";
    renderSidebar();
    expect(screen.getByRole("link", { name: "照片" })).toBeInTheDocument();
    expect(screen.getByText("相册")).toBeInTheDocument();
    expect(screen.getByText("发现")).toBeInTheDocument();
    expect(screen.getByText("珍藏")).toBeInTheDocument();
    expect(screen.getByText("相似照片")).toBeInTheDocument();
    // 漫画那边的一切都不出现，包括未读入口。
    expect(screen.queryByText("书架")).not.toBeInTheDocument();
    expect(screen.queryByText("未读")).not.toBeInTheDocument();
  });

  it("分组标题说清每一段是什么", () => {
    appMode.mode = "photo";
    renderSidebar();
    expect(screen.getByText("浏览")).toBeInTheDocument();
    expect(screen.getByText("整理")).toBeInTheDocument();
    expect(screen.getByText("相似照片")).toBeInTheDocument();
    // 本机组：任务中心与设置排在内容入口之后。
    expect(screen.getByText("本机")).toBeInTheDocument();
    expect(screen.getByText("任务中心")).toBeInTheDocument();
    expect(screen.getByText("设置")).toBeInTheDocument();
  });

  // 页面级分区搬进了页面内的页签条：侧栏不再展开二级菜单，
  // 只在激活的那一格里挂一枚当前页签 —— 侧栏仍然能回答「我在这一页的哪一段」。
  it("分区页不再展开二级菜单，只在条目上标出当前页签", () => {
    const { unmount } = renderSidebar(false, "/settings/data");
    const entry = screen.getByRole("link", { name: /设置/ });
    expect(entry).toHaveAttribute("href", "/settings/data");
    // 页签名是这一页的状态，不是入口的名字：链接的可访问名仍是「设置」。
    expect(entry).toHaveAccessibleName("设置");
    expect(screen.getByTestId("nav-tab-label")).toHaveTextContent("数据");
    // 旧的分区入口没有了。
    expect(
      screen.queryByRole("button", { name: /外观/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /关于/ }),
    ).not.toBeInTheDocument();
    // 别的页面上不挂页签名。
    unmount();
    renderSidebar(false, "/");
    expect(screen.queryByTestId("nav-tab-label")).not.toBeInTheDocument();
  });

  // 窄屏时侧栏是抽屉：抽屉宽度不由「折叠」决定，抽屉里再摆一枚
  // 「折叠侧边栏」既点不动，也会让人以为点完菜单会消失。
  it("窄屏抽屉不显示折叠按钮，并保留品牌名", () => {
    wideViewport = false;
    try {
      renderSidebar(true);
      expect(
        screen.queryByRole("button", { name: /折叠侧边栏|展开侧边栏/ }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("Local Gallery")).toBeInTheDocument();
    } finally {
      wideViewport = true;
    }
  });

  // 侧栏入口可按需收起（设置页的「导航」分区）。收起的只是入口，
  // 页面本身照样能通过别的链接到达。
  it("被收起的入口不出现在侧栏里", () => {
    appMode.mode = "photo";
    hiddenNavItems = ["photo.explore"];
    renderSidebar();
    expect(screen.queryByText("发现")).not.toBeInTheDocument();
    // 没收起的照旧在列，工作台首页永远在。
    expect(screen.getByText("相册")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "照片" })).toBeInTheDocument();
  });

  it("未读入口带未读数量", () => {
    renderSidebar();
    const entry = screen.getByRole("link", { name: /未读/ });
    expect(entry).toHaveAttribute(
      "title",
      expect.stringContaining("还有 69 卷"),
    );
    expect(entry).toHaveTextContent("69");
  });

  it("不再提供「随机未读」：该动作在未读页与首页已有入口", () => {
    renderSidebar();
    expect(screen.queryByText("随机未读")).not.toBeInTheDocument();
    // 「随机一本」保留
    expect(screen.getByText("随机一卷")).toBeInTheDocument();
  });

  it("随机翻翻在照片侧说照片，在漫画侧说漫画", () => {
    appMode.mode = "photo";
    renderSidebar();
    expect(screen.getByText("随机翻翻")).toBeInTheDocument();
  });

  // 侧栏不再挂「接着看 / 继续阅读」迷你卡：那是首页的专区，
  // 两处都摆就是同一份内容两个入口。
  it("侧栏不再摆「接着看 / 继续阅读」迷你卡", () => {
    renderSidebar();
    expect(screen.queryByText("接着看")).not.toBeInTheDocument();
    expect(screen.queryByText("继续阅读")).not.toBeInTheDocument();
  });

  it("随机翻阅按钮可点", () => {
    renderSidebar();
    const button = screen.getByTitle("随机一卷 (R)");
    fireEvent.click(button);
    expect(button).toBeInTheDocument();
  });
});

it("侧栏提供模式切换、搜索、主题、帮助与刷新", () => {
  renderSidebar();
  expect(screen.getByRole("group", { name: "工作台模式" })).toBeInTheDocument();
  for (const name of ["打开命令面板", "快捷键帮助", "刷新缓存"]) {
    expect(screen.getByRole("button", { name })).toBeInTheDocument();
  }
});

it("人物详情提供持久化的人脸框开关", () => {
  useUIStore.getState().setShowPersonFaceBoxes(false);
  renderSidebar(false, "/photo/people/p_123456");
  const option = screen.getByRole("button", { name: "显示当前人物的人脸框" });
  expect(option).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(option);
  expect(option).toHaveAttribute("aria-pressed", "true");
  expect(
    JSON.parse(localStorage.getItem("local-gallery-ui") ?? "{}").state
      .showPersonFaceBoxes,
  ).toBe(true);
});
