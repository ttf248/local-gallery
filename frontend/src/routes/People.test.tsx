import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import People from "./People";

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  people: vi.fn(),
  searchPeople: vi.fn(),
  clearPeople: vi.fn(),
  personMedia: vi.fn(),
  mergePeople: vi.fn(),
}));

vi.mock("../api/aiJobs", () => ({
  aiJobsApi: {
    list: mocks.list,
    people: mocks.people,
    searchPeople: mocks.searchPeople,
    clearPeople: mocks.clearPeople,
    personMedia: mocks.personMedia,
    updatePerson: vi.fn(),
    mergePeople: mocks.mergePeople,
    splitPerson: vi.fn(),
  },
}));

function renderPeople() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/photo/people"]}>
        <Routes>
          <Route path="/photo/people/:personId?" element={<People />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("人物相册", () => {
  beforeEach(() => {
    Object.assign(HTMLDialogElement.prototype, {
      showModal(this: HTMLDialogElement) {
        this.open = true;
      },
      close(this: HTMLDialogElement) {
        this.open = false;
      },
    });
    vi.clearAllMocks();
    mocks.list.mockResolvedValue({
      ok: true,
      snapshot: { settings: { peopleEnabled: false } },
    });
    mocks.people.mockResolvedValue({
      ok: true,
      people: [],
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 1,
    });
    mocks.searchPeople.mockResolvedValue({
      ok: true,
      people: [],
      totalGroups: 0,
      limit: 20,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 1,
    });
    mocks.clearPeople.mockResolvedValue({ ok: true, cleared: true });
    mocks.mergePeople.mockResolvedValue({ ok: true });
  });

  it("未启用时说明人物分析默认关闭并引导到任务中心", async () => {
    renderPeople();
    expect(await screen.findByText("人物分析默认关闭")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "打开任务中心" })).toHaveAttribute(
      "href",
      "/tasks/plan",
    );
  });

  it("展示候选组照片数与脸部数", async () => {
    mocks.people.mockResolvedValue({
      ok: true,
      people: [
        {
          id: "p_123456",
          name: "旅行同伴",
          faceCount: 6,
          photoCount: 6,
          folderCount: 2,
          hidden: false,
        },
      ],
      totalGroups: 1,
      filteredGroups: 1,
      minimumFolderCount: 2,
      minimumFolderPhotos: 3,
      minimumFolderPhotoSharePercent: 10,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 2,
    });
    renderPeople();

    expect(await screen.findByText("旅行同伴")).toBeInTheDocument();
    expect(screen.getByText(/6\s*张脸/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "跨文件夹人物 1 组 · 已隐藏目录分布不足 1 组 · 按照片数排序",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/2 个一级目录 · 6 张脸/)).toBeInTheDocument();
    expect(
      screen.getByText(
        "只展示在至少 2 个一级来源目录中都有稳定分布的人物组（每个目录至少 3 张，且占组内照片至少 10%）；卡片标出达标目录数。",
      ),
    ).toBeInTheDocument();
    expect(mocks.people).toHaveBeenCalledWith(false, "photos");
    expect(screen.queryByText(/组中心|代表脸|边界脸/)).not.toBeInTheDocument();
    expect(
      screen.getByText(
        (_content, element) =>
          element?.tagName === "SPAN" &&
          element.textContent?.replace(/\s+/g, "") === "6张照片",
      ),
    ).toBeInTheDocument();
  });

  it("所有候选的目录分布都不足时说明已隐藏且不引导重复分析", async () => {
    mocks.list.mockResolvedValue({
      ok: true,
      snapshot: { settings: { peopleEnabled: true } },
    });
    mocks.people.mockResolvedValue({
      ok: true,
      people: [],
      totalGroups: 0,
      filteredGroups: 17,
      minimumFolderCount: 2,
      minimumFolderPhotos: 3,
      minimumFolderPhotoSharePercent: 10,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 2,
    });
    renderPeople();

    expect(
      await screen.findByText("暂不展示目录分布不足的人物组"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/有 17 组人物未达到跨目录展示条件，已暂时隐藏/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "打开任务中心" }),
    ).not.toBeInTheDocument();
  });

  it("切换审查优先并展示组内低分位复核线索", async () => {
    mocks.people.mockImplementation(
      (_includeHidden: boolean, sort: "photos" | "review") =>
        Promise.resolve({
          ok: true,
          people: [
            {
              id: "p_review",
              name: "待复核人物",
              faceCount: 4,
              photoCount: 3,
              hidden: false,
              quality:
                sort === "review"
                  ? {
                      anchorP10: 0.731,
                      centroidP10: 0.812,
                      detectionP10: 0.754,
                    }
                  : undefined,
            },
          ],
          totalGroups: 1,
          limit: 50,
          centroidThreshold: 0.52,
          anchorThreshold: 0.72,
          sort,
          revision: 5,
        }),
    );
    renderPeople();

    fireEvent.click(await screen.findByRole("radio", { name: "审查优先" }));

    expect(await screen.findByText("锚点 P10 0.731")).toBeInTheDocument();
    expect(screen.getByText("中心 P10 0.812")).toBeInTheDocument();
    expect(screen.getByText("检测 P10 0.754")).toBeInTheDocument();
    expect(
      screen.getByText(/只用于安排人工复核，不代表身份置信度/),
    ).toBeInTheDocument();
    expect(mocks.people).toHaveBeenLastCalledWith(false, "review");
  });

  it("说明列表仅展示照片数最多的前50组", async () => {
    mocks.people.mockResolvedValue({
      ok: true,
      people: Array.from({ length: 50 }, (_, index) => ({
        id: `p_${String(index).padStart(6, "0")}`,
        name: `人物 ${index}`,
        faceCount: index + 1,
        photoCount: 100 - index,
        hidden: false,
      })),
      totalGroups: 83,
      filteredGroups: 20,
      limit: 50,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 3,
    });
    renderPeople();

    expect(
      await screen.findByText(
        /照片数最多的跨文件夹人物 50 \/ 共 83 组 · 已隐藏目录分布不足 20 组 · 按照片数排序/,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("人物 0")).toBeInTheDocument();
    expect(screen.getByText("人物 49")).toBeInTheDocument();
  });

  it("人物相册的拆分列表分批显示已加载人脸", async () => {
    mocks.personMedia.mockResolvedValue({
      ok: true,
      page: {
        revision: 3,
        person: {
          id: "p_123456",
          name: "大组",
          faceCount: 205,
          photoCount: 0,
          hidden: false,
        },
        items: [],
        faces: Array.from({ length: 205 }, (_, index) => ({
          key: `r${index}#0`,
          resourceId: `r${index}`,
          faceIndex: 0,
          personId: "p_123456",
          box: [0, 0, 1, 1],
          score: 0.9,
        })),
        total: 0,
      },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/photo/people/p_123456"]}>
          <Routes>
            <Route path="/photo/people/:personId?" element={<People />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    fireEvent.click(
      await screen.findByText("拆分选中的人脸（当前已加载照片）"),
    );
    expect(screen.getAllByRole("checkbox")).toHaveLength(200);
    fireEvent.click(screen.getByRole("button", { name: /继续显示 5 张脸/ }));
    expect(screen.getAllByRole("checkbox")).toHaveLength(205);
  });

  it("详情页不请求全量人物表，打开合并弹窗后才按需搜索", async () => {
    mocks.personMedia.mockResolvedValue({
      ok: true,
      page: {
        revision: 4,
        person: {
          id: "p_123456",
          name: "当前人物",
          faceCount: 2,
          photoCount: 2,
          hidden: false,
        },
        items: [],
        faces: [],
        total: 0,
      },
    });
    mocks.searchPeople.mockResolvedValue({
      ok: true,
      people: [
        {
          id: "p_abcdef",
          name: "合并目标",
          faceCount: 3,
          photoCount: 2,
          hidden: false,
        },
      ],
      totalGroups: 1,
      limit: 20,
      centroidThreshold: 0.52,
      anchorThreshold: 0.72,
      revision: 4,
    });
    render(
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          })
        }
      >
        <MemoryRouter initialEntries={["/photo/people/p_123456"]}>
          <Routes>
            <Route path="/photo/people/:personId?" element={<People />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(await screen.findByText("当前人物")).toBeInTheDocument();
    expect(
      screen.getByText(/照片框线标出属于「当前人物」分组的人脸/),
    ).toBeInTheDocument();
    expect(mocks.people).not.toHaveBeenCalled();
    expect(mocks.searchPeople).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "合并人物" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    await waitFor(() => expect(mocks.searchPeople).toHaveBeenCalledWith(""));
    expect(await screen.findByText("合并目标")).toBeInTheDocument();
  });
});
