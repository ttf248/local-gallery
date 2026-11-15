import { beforeEach, expect, it } from "vitest";
import { useSortPreference } from "./sortPreference";

beforeEach(() => {
  useSortPreference.setState({ sortBy: "name", sortTouched: false });
});

it("默认按名称排，且不算用户亲手选过", () => {
  expect(useSortPreference.getState().sortBy).toBe("name");
  expect(useSortPreference.getState().sortTouched).toBe(false);
});

it("选过排序后记住它，并标记为亲手选的", () => {
  useSortPreference.getState().setSortBy("viewed");
  expect(useSortPreference.getState().sortBy).toBe("viewed");
  expect(useSortPreference.getState().sortTouched).toBe(true);
});
