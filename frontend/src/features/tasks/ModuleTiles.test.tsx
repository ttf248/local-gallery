import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import ModuleTiles from "./ModuleTiles";

it("选中模块展示勾选状态，未安装的模块仍可查看详情", () => {
  const toggle = vi.fn();
  render(
    <ModuleTiles
      selected={["metadata"]}
      onToggle={toggle}
      modules={[
        { type: "metadata", name: "元数据", installed: true, version: "v1" },
        {
          type: "ocr",
          name: "文字识别",
          installed: false,
          reason: "missing_model",
        },
      ]}
    />,
  );
  expect(
    screen.getByRole("button", { name: "元数据", pressed: true }),
  ).toBeEnabled();
  const missing = screen.getByRole("button", { name: "文字识别" });
  expect(missing).toBeDisabled();
  fireEvent.click(missing);
  expect(toggle).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "元数据详情" }));
  expect(screen.getByRole("menu")).toHaveTextContent("元数据");
  expect(screen.getByRole("menu")).not.toHaveTextContent("v1");
});
