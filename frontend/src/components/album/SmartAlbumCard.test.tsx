import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import type {
  SmartAlbumDirectoryItem,
  SmartAlbumGroup,
} from "../../api/albums";
import SmartAlbumCard from "./SmartAlbumCard";

function recommendation(
  overrides: Partial<SmartAlbumGroup> = {},
): SmartAlbumDirectoryItem {
  return {
    albumId: "a_1",
    albumName: "2023年测试相册",
    parentName: "家庭照片",
    group: {
      id: "sg_0123456789abcdef0123",
      dimension: "recommended",
      name: "2024年春游",
      suggestedName: "2024年春游",
      customName: false,
      photoCount: 3,
      evidenceDimensions: ["time", "place", "scene"],
      recommendationReasons: ["连续拍摄时间", "同一地点", "相近场景"],
      coverResourceId: "f_1",
      hidden: false,
      ...overrides,
    },
  };
}

function renderCard(item: SmartAlbumDirectoryItem) {
  return render(
    <MemoryRouter>
      <SmartAlbumCard item={item} coverHeight={200} />
    </MemoryRouter>,
  );
}

describe("智能相册卡片的证据线索", () => {
  it("推荐的第三行是证据维度芯片，不是平铺的理由", () => {
    renderCard(recommendation());

    const evidence = screen.getByTestId("smart-album-evidence");
    expect(evidence).toHaveTextContent("时间");
    expect(evidence).toHaveTextContent("地点");
    expect(evidence).toHaveTextContent("场景");
    expect(screen.queryByText("连续拍摄时间")).toBeNull();
  });

  it("芯片按时间、地点、人物、场景的固定顺序摆", () => {
    renderCard(
      recommendation({ evidenceDimensions: ["scene", "people", "time"] }),
    );

    const labels = within(screen.getByTestId("smart-album-evidence"))
      .getAllByText(/时间|地点|人物|场景/)
      .map((node) => node.textContent);
    expect(labels).toEqual(["时间", "人物", "场景"]);
  });

  it("没有证据维度时退回理由文字，也不崩", () => {
    renderCard(recommendation({ evidenceDimensions: undefined }));

    expect(screen.queryByTestId("smart-album-evidence")).toBeNull();
    expect(screen.getByText("连续拍摄时间 · 同一地点 · 相近场景")).toBeTruthy();
  });

  it("详细分类没有第三行", () => {
    renderCard(
      recommendation({
        dimension: "scene",
        evidenceDimensions: undefined,
      }),
    );

    expect(screen.queryByTestId("smart-album-evidence")).toBeNull();
  });
});
