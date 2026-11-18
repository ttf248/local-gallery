import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import PeopleAnnotate from "./PeopleAnnotate";

const mocks = vi.hoisted(() => ({
  samples: vi.fn(),
  photo: vi.fn(),
  identities: vi.fn(),
  createIdentity: vi.fn(),
  save: vi.fn(),
  progress: vi.fn(),
}));

vi.mock("../api/peopleAnnotations", () => ({
  peopleAnnotationsApi: {
    samples: mocks.samples,
    photo: mocks.photo,
    identities: mocks.identities,
    createIdentity: mocks.createIdentity,
    save: mocks.save,
    progress: mocks.progress,
    datasetUrl: () => "/api/admin/people/annotations/dataset",
  },
}));

const DETECTED = [
  {
    key: "f_demo#0",
    resourceId: "f_demo",
    faceIndex: 0,
    personId: "p_demo",
    box: [10, 20, 60, 80] as [number, number, number, number],
    score: 0.9,
  },
];

function renderAnnotate() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/photo/people/annotate"]}>
        <PeopleAnnotate />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("人物标注工作台", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.samples.mockResolvedValue({
      ok: true,
      items: [
        {
          resourceId: "f_demo",
          reason: "pendingMatch",
          faceCount: 1,
          reviewed: false,
          personName: "人物 1",
        },
      ],
      progress: {
        sampleCount: 1,
        reviewedCount: 0,
        annotatedPhotoCount: 0,
        faceCount: 0,
        identityCount: 1,
      },
      scenarioTags: ["groupPhoto", "crossAge"],
    });
    mocks.identities.mockResolvedValue({
      ok: true,
      items: [{ id: "id-001", label: "妈妈" }],
    });
    mocks.photo.mockResolvedValue({
      ok: true,
      photo: {
        resourceId: "f_demo",
        width: 800,
        height: 600,
        detected: DETECTED,
        annotation: undefined,
      },
    });
    mocks.save.mockResolvedValue({
      ok: true,
      progress: {
        sampleCount: 1,
        reviewedCount: 1,
        annotatedPhotoCount: 1,
        faceCount: 1,
        identityCount: 1,
      },
    });
  });

  it("列出待标注样本并显示检出人脸", async () => {
    renderAnnotate();
    expect(await screen.findByText("待确认匹配")).toBeTruthy();
    expect(
      (await screen.findByText("待确认匹配")).closest("li")?.textContent,
    ).toContain("人物 1");
    expect((await screen.findByTestId("people-annotate-summary")).textContent).toContain(
      "检出 1 张脸",
    );
    await waitFor(() => expect(mocks.photo).toHaveBeenCalledWith("f_demo"));
  });

  it("给检出人脸指派匿名身份后保存", async () => {
    renderAnnotate();
    await screen.findByTestId("people-annotate-summary");
    const picker = await screen.findByLabelText("匿名身份");
    fireEvent.change(picker, { target: { value: "id-001" } });
    fireEvent.click(screen.getByText("保存标注"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    const body = mocks.save.mock.calls[0][0];
    expect(body.resourceId).toBe("f_demo");
    expect(body.faces).toHaveLength(1);
    expect(body.faces[0].identity).toBe("id-001");
    expect(body.faces[0].box).toEqual([10, 20, 60, 80]);
  });

  it("场景标签可以多选并写进保存内容", async () => {
    renderAnnotate();
    await screen.findByTestId("people-annotate-summary");
    fireEvent.click(screen.getByRole("button", { name: "大合照" }));
    fireEvent.click(screen.getByRole("button", { name: "跨年龄" }));
    fireEvent.click(screen.getByText("保存标注"));
    await waitFor(() => expect(mocks.save).toHaveBeenCalled());
    expect(mocks.save.mock.calls[0][0].tags).toEqual(["groupPhoto", "crossAge"]);
  });
});
