import Toggle from "../common/Toggle";
import StatusBadge from "./StatusBadge";
import type { FieldStatus } from "../../hooks/useServerConfigSave";

/**
 * 扫描时跳过什么（独立组件）。
 *
 * 一个「扫描」section 同时管三个相关设置:
 *   - excludePatterns: glob 模式列表(每行一条,按 basename 匹配)
 *   - systemFiles: 额外的系统噪声文件(每行一条,内置 Thumbs.db 不可关闭)
 *   - skipHidden: 是否跳过 . 开头的隐藏目录
 *
 * 之所以做成一个组件:三者在概念上紧密相关(都是「扫描时跳过什么」),
 * 拆三个组件反而让用户困惑「这俩啥关系」。
 */
export default function ExcludeRulesField({
  patterns,
  systemFiles,
  skipHidden,
  patternsStatus,
  systemFilesStatus,
  skipHiddenStatus,
  onPatternsChange,
  onSystemFilesChange,
  onSkipHiddenChange,
  onPatternsCommit,
  onSystemFilesCommit,
}: {
  patterns: string[];
  systemFiles: string[];
  skipHidden: boolean;
  patternsStatus: FieldStatus;
  systemFilesStatus: FieldStatus;
  skipHiddenStatus: FieldStatus;
  onPatternsChange: (next: string[]) => void;
  onSystemFilesChange: (next: string[]) => void;
  onSkipHiddenChange: (v: boolean) => void;
  onPatternsCommit: () => void;
  onSystemFilesCommit: () => void;
}) {
  // 多行文本 → string[]:split 时 trim + 去空行(用户经常多打空行)
  function linesToList(s: string): string[] {
    return s
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l !== "");
  }
  // 反向:string[] → 多行文本(末尾不加多余空行,让光标自然停在最后一行)
  function listToLines(arr: string[]): string {
    return arr.join("\n");
  }
  return (
    <div className="px-4 py-3 text-body space-y-4">
      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-fg">排除模式</span>
            <span className="text-meta text-fg-subtle mt-0.5">
              一行一条,glob 匹配单个目录/文件名(任意深度)。例如
              <code className="font-mono mx-1 text-fg-muted">node_modules</code>
              <code className="font-mono mx-1 text-fg-muted">temp*</code>
              <code className="font-mono mx-1 text-fg-muted">~*</code>
            </span>
          </div>
          <StatusBadge status={patternsStatus} />
        </div>
        <textarea
          value={listToLines(patterns)}
          aria-label="排除模式"
          spellCheck={false}
          rows={Math.max(3, Math.min(8, patterns.length + 1))}
          placeholder="node_modules&#10;temp*&#10;~$*"
          onChange={(e) => onPatternsChange(linesToList(e.target.value))}
          onBlur={onPatternsCommit}
          className="mt-2 w-full bg-bg-subtle border border-border-faint rounded-md px-2.5 py-2 text-body font-mono focus:outline-none focus:border-accent resize-y min-h-[80px]"
        />
      </div>

      <div className="flex items-center justify-between">
        <div className="flex flex-col">
          <span className="text-fg">跳过隐藏目录</span>
          <span className="text-meta text-fg-subtle mt-0.5">
            任何以 <code className="font-mono text-fg-muted">.</code>{" "}
            开头的子目录(. <code className="font-mono text-fg-muted">.git</code>{" "}
            / <code className="font-mono text-fg-muted">.cache</code> 等)
            整体不进库
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Toggle
            checked={skipHidden}
            onChange={onSkipHiddenChange}
            label="跳过隐藏目录"
          />
          <StatusBadge status={skipHiddenStatus} />
        </div>
      </div>

      <div>
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col">
            <span className="text-fg">额外的系统白名单</span>
            <span className="text-meta text-fg-subtle mt-0.5">
              在内置 <code className="font-mono text-fg-muted">Thumbs.db</code>{" "}
              / <code className="font-mono text-fg-muted">desktop.ini</code> /{" "}
              <code className="font-mono text-fg-muted">.DS_Store</code>{" "}
              之上追加
            </span>
          </div>
          <StatusBadge status={systemFilesStatus} />
        </div>
        <textarea
          value={listToLines(systemFiles)}
          aria-label="额外的系统白名单"
          spellCheck={false}
          rows={Math.max(2, Math.min(4, systemFiles.length + 1))}
          placeholder=".Spotlight-V100&#10;~$*"
          onChange={(e) => onSystemFilesChange(linesToList(e.target.value))}
          onBlur={onSystemFilesCommit}
          className="mt-2 w-full bg-bg-subtle border border-border-faint rounded-md px-2.5 py-2 text-body font-mono focus:outline-none focus:border-accent resize-y min-h-[60px]"
        />
      </div>
    </div>
  );
}
