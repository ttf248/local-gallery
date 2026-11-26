import ts from "typescript";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

const forbidden =
  /#[\da-f]{3,8}\b|(?<![\w-])(?:btn(?:-[\w-]+)?|chip|ui-chip|page-shell|segments|ui-segmented|toolbar-icon|field-frame|hover-reveal)(?![\w-])|text-\[\d+px\]|(?:bg-bg(?:-[\w-]+)?|text-fg(?:-[\w-]+)?|[\w-]+-signal(?:-[\w-]+)?)\b|window\.confirm\s*\(/i;
const arbitraryToken = /\[var\(--/;
const root = path.resolve(__dirname, "..");
function violations(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return violations(file);
    if (!entry.name.endsWith(".tsx") || entry.name.endsWith(".test.tsx"))
      return [];
    const name = path.relative(root, file).split(path.sep).join("/");
    const source = readFileSync(file, "utf8");
    const syntax = ts.createSourceFile(
      name,
      source,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    // 在字符串、模板片段与 JSX 属性中查样式，避免把 segments 等业务标识符当成 CSS 类。
    let invalid = false;
    function inspect(node: ts.Node) {
      if (invalid) return;
      if (
        ts.isStringLiteralLike(node) ||
        ts.isTemplateMiddle(node) ||
        ts.isTemplateTail(node)
      ) {
        invalid =
          forbidden.test(node.text) ||
          (/^(features|routes)\//.test(name) && arbitraryToken.test(node.text));
      } else if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression)
      ) {
        invalid =
          node.expression.expression.getText(syntax) === "window" &&
          node.expression.name.text === "confirm";
      }
      ts.forEachChild(node, inspect);
    }
    inspect(syntax);
    return invalid ? [name] : [];
  });
}

// 已登记的旧页面随对应阶段迁移。新文件或已迁移文件重新使用旧样式会使断言失败。
const remaining: string[] = [];
it("组件中禁止遗留样式与浏览器确认框", () => {
  expect(remaining).toHaveLength(0);
  expect(violations(root).sort()).toEqual(remaining);
});
