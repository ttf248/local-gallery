import { execFileSync } from "node:child_process";

const stable = /^v2\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const [increment = "patch", explicit] = process.argv.slice(2);
if (increment !== "patch" && increment !== "minor") {
  throw new Error("版本更新类型必须为 patch 或 minor。");
}

const tags = execFileSync("git", ["tag", "--list", "v2.*", "--sort=-version:refname"], {
  encoding: "utf8",
}).trim().split(/\r?\n/);
const current = tags.map((tag) => stable.exec(tag)).find(Boolean);
let next = "v2.0.0";
if (current) {
  const [, minor, patch] = current;
  next = increment === "minor"
    ? `v2.${BigInt(minor) + 1n}.0`
    : `v2.${minor}.${BigInt(patch) + 1n}`;
}
if (explicit && !stable.test(explicit)) {
  throw new Error("正式版本必须使用 v2.x.y 格式，例如 v2.0.0。");
}
const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const headTags = execFileSync("git", ["tag", "--points-at", head], { encoding: "utf8" }).trim().split(/\r?\n/);
const sameCommit = headTags.find((tag) => stable.test(tag));
if (sameCommit && explicit !== sameCommit) throw new Error(`当前提交已有 ${sameCommit} 标签，重试时请填写该版本。`);
if (explicit && explicit !== next) {
  const existing = tags.includes(explicit) && execFileSync("git", ["rev-parse", `${explicit}^{commit}`], { encoding: "utf8" }).trim();
  if (existing !== head) throw new Error(`当前应发布 ${next}。显式版本只能用于重试当前提交的已有标签。`);
}
console.log(explicit || next);
