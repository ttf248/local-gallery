import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import PageTabs, { PagePanel } from "./PageTabs";

const tabs = [
  { id: "interface", label: "界面" },
  { id: "reading", label: "阅读" },
  { id: "data", label: "数据" },
];

describe("PageTabs", () => {
  it("是页签列表，只有当前这一个被选中", () => {
    render(
      <PageTabs
        tabs={tabs}
        active="reading"
        onChange={() => {}}
        label="设置页分区"
        idPrefix="settings"
      />,
    );
    const list = screen.getByRole("tablist", { name: "设置页分区" });
    const items = within(list).getAllByRole("tab");
    expect(items.map((tab) => tab.textContent)).toEqual(["界面", "阅读", "数据"]);
    expect(
      within(list).getByRole("tab", { name: "阅读" }),
    ).toHaveAttribute("aria-selected", "true");
    expect(
      within(list).getByRole("tab", { name: "界面" }),
    ).toHaveAttribute("aria-selected", "false");
  });

  it("点一下就切到那个页签", () => {
    const onChange = vi.fn();
    render(
      <PageTabs
        tabs={tabs}
        active="interface"
        onChange={onChange}
        label="设置页分区"
        idPrefix="settings"
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "数据" }));
    expect(onChange).toHaveBeenCalledWith("data");
  });

  // 方向键在页签条内切换（照分段控件的规矩），但不注册成全局快捷键。
  it("方向键在页签条内切换，并跟着焦点走", () => {
    const onChange = vi.fn();
    render(
      <PageTabs
        tabs={tabs}
        active="interface"
        onChange={onChange}
        label="设置页分区"
        idPrefix="settings"
      />,
    );
    const first = screen.getByRole("tab", { name: "界面" });
    first.focus();
    fireEvent.keyDown(first, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalledWith("reading");
    fireEvent.keyDown(first, { key: "End" });
    expect(onChange).toHaveBeenCalledWith("data");
    fireEvent.keyDown(first, { key: "Home" });
    expect(onChange).toHaveBeenCalledWith("interface");
  });

  // 漫游 tabindex：只有当前页签在 Tab 序列里。
  it("只有当前页签在 Tab 序列里", () => {
    render(
      <PageTabs
        tabs={tabs}
        active="data"
        onChange={() => {}}
        label="设置页分区"
        idPrefix="settings"
      />,
    );
    expect(screen.getByRole("tab", { name: "数据" })).toHaveAttribute(
      "tabindex",
      "0",
    );
    expect(screen.getByRole("tab", { name: "界面" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
  });

  it("右侧的补充说明贴在页签条里", () => {
    render(
      <PageTabs
        tabs={tabs}
        active="data"
        onChange={() => {}}
        label="设置页分区"
        idPrefix="settings"
        meta="本机数据与备份恢复"
      />,
    );
    expect(screen.getByText("本机数据与备份恢复")).toBeInTheDocument();
  });
});

describe("PagePanel", () => {
  // 面板的可访问名来自页签按钮（aria-labelledby），所以两样要一起渲染。
  it("非当前的面板藏起来，但留在 DOM 里（草稿与筛选不丢）", () => {
    render(
      <>
        <PageTabs
          tabs={tabs}
          active="data"
          onChange={() => {}}
          label="设置页分区"
          idPrefix="settings"
        />
        <PagePanel idPrefix="settings" tab={tabs[0]} active="data">
          <p>界面内容</p>
        </PagePanel>
      </>,
    );
    // 藏起来的面板不在无障碍树里，按 id 找。
    const panel = document.getElementById("settings-panel-interface");
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute("hidden");
    expect(panel).toHaveTextContent("界面内容");
  });

  it("当前的面板可见", () => {
    render(
      <>
        <PageTabs
          tabs={tabs}
          active="data"
          onChange={() => {}}
          label="设置页分区"
          idPrefix="settings"
        />
        <PagePanel idPrefix="settings" tab={tabs[2]} active="data">
          <p>数据内容</p>
        </PagePanel>
      </>,
    );
    const panel = screen.getByRole("tabpanel", { name: "数据" });
    expect(panel).not.toHaveAttribute("hidden");
  });
});
