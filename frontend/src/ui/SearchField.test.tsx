import { vi, it, expect } from "vitest";
import { screen, render, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { SearchField } from "./SearchField";
it("Esc 先清空后失焦，输入法组字时 Enter 不提交", () => {
  const submit = vi.fn();
  function Field() {
    const [value, setValue] = useState("照片");
    return (
      <SearchField value={value} onValueChange={setValue} onSubmit={submit} />
    );
  }
  render(<Field />);
  const input = screen.getByRole("searchbox");
  input.focus();
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(submit).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: "Enter" });
  expect(submit).toHaveBeenCalledWith(
    "照片",
    expect.objectContaining({ key: "Enter" }),
  );
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).toHaveValue("");
  expect(input).toHaveFocus();
  fireEvent.keyDown(input, { key: "Escape" });
  expect(input).not.toHaveFocus();
});
