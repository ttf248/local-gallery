import type { ReactNode } from "react";
import Toggle from "../common/Toggle";
import { RestartIcon } from "../common/Icon";
import PathField from "./PathField";
import { openConfiguredDirectory } from "./openConfiguredDirectory";
import StatusBadge from "./StatusBadge";
import { useConfigComposition } from "../../hooks/useConfigComposition";
import type { FieldStatus } from "../../hooks/useServerConfigSave";
import type { ServerConfigPatch } from "../../api/config";

/** 字段定义:标签、说明、是否重启字段、UI 类型。 */
export type FieldDef =
  | {
      key: Exclude<keyof ServerConfigPatch, "mediaRoots">;
      label: string;
      hint?: string;
      kind: "text";
    }
  | {
      key: Exclude<keyof ServerConfigPatch, "mediaRoots">;
      label: string;
      hint?: string;
      kind: "number";
      min?: number;
      max?: number;
    }
  | {
      key: Exclude<keyof ServerConfigPatch, "mediaRoots">;
      label: string;
      hint?: string;
      kind: "boolean";
    };

/**
 * 服务端配置里的一组设置。
 *
 * 之前分组标题是一行浮在画布上的灰字，下面的内容又是白卡 —— 白卡套
 * 白卡，标题和内容各说各的，整段看不出哪里到哪里。改成分组自带一张
 * 面板：标题做成顶栏（压一层浅色底），正文在下面，一组一块。
 */
export function ConfigGroup({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    // 组内的字段行固定上下堆：这一段是三栏排布，每组只有三百多像素，
    // 标签与输入框并排会把标签挤成一列竖字。
    <section className="mb-4 break-inside-avoid overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-xs">
      <h3 className="border-b border-border-faint bg-bg-subtle px-4 py-2.5 text-meta font-medium text-fg-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

/** 单个字段行。 */
export function ConfigRow({
  def,
  value,
  status,
  requiresRestart,
  isPath,
  allowOsOpen,
  onChange,
  onCommit,
  onCancel,
  onConfirm,
  onCompositionChange,
}: {
  def: FieldDef;
  value: string | number | boolean;
  status: FieldStatus;
  requiresRestart: boolean;
  isPath: boolean;
  allowOsOpen: boolean;
  onChange: (v: string | number | boolean) => void;
  onCommit?: () => void;
  onCancel: () => void;
  onConfirm: () => void;
  onCompositionChange: (active: boolean) => void;
}) {
  const composition = useConfigComposition((value) => {
    if (def.kind === "number") {
      const number = Number(value);
      if (Number.isFinite(number)) onChange(number);
    } else if (def.kind === "text") {
      onChange(value);
    }
  }, onCompositionChange);
  return (
    // 字段行上下堆叠：标签与控件并排时，路径输入框会把标签挤成一列竖排文字。
    <div className="flex flex-col items-stretch justify-between gap-2 px-4 py-3 text-body">
      <div className="flex flex-col min-w-0">
        <span className="text-fg flex items-center gap-2">
          {def.label}
          {requiresRestart && (
            <span className="inline-flex items-center gap-1 text-meta text-fg-subtle border border-border-faint px-1.5 py-0.5 rounded">
              <RestartIcon size={10} />
              需重启
            </span>
          )}
        </span>
        {def.hint && (
          <span className="text-meta text-fg-subtle mt-0.5">
            {def.hint}
          </span>
        )}
      </div>
      <div className="flex items-center gap-2 min-w-0">
        {def.kind === "text" && isPath ? (
          <PathField
            value={String(value)}
            placeholder={def.hint ?? "路径"}
            onChange={(v) => onChange(v)}
            onCommit={onCommit}
            onCancel={onCancel}
            onConfirm={onConfirm}
            onCompositionChange={onCompositionChange}
            onOpenInExplorer={
              value && String(value).length > 0 && allowOsOpen
                ? () => openConfiguredDirectory(String(value))
                : undefined
            }
            onPick={(picked) => onChange(picked)}
            compact
            withStatus
            status={status}
            label={def.label}
          />
        ) : def.kind === "text" ? (
          <input
            type="text"
            value={String(value)}
            aria-label={def.label}
            onChange={(e) => onChange(e.target.value)}
            onCompositionStart={composition.start}
            onCompositionEnd={(e) => composition.finish(e.currentTarget.value)}
            onBlur={(e) => composition.finish(e.currentTarget.value)}
            className="bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-body font-mono w-full max-w-[40vw] focus:outline-none focus:border-accent"
          />
        ) : def.kind === "number" ? (
          <input
            type="number"
            value={Number(value)}
            aria-label={def.label}
            min={def.min}
            max={def.max}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) onChange(n);
            }}
            onCompositionStart={composition.start}
            onCompositionEnd={(e) => composition.finish(e.currentTarget.value)}
            onBlur={(e) => composition.finish(e.currentTarget.value)}
            className="bg-bg-subtle border border-border-faint rounded-md h-8 px-2.5 text-body font-mono w-24 text-right tabular-nums focus:outline-none focus:border-accent"
          />
        ) : (
          <Toggle
            checked={Boolean(value)}
            onChange={onChange}
            label={def.label}
          />
        )}
        {/* 状态指示:只在非路径/非紧凑模式单独显示(紧凑模式由 PathField 内部带) */}
        {!(def.kind === "text" && isPath) && <StatusBadge status={status} />}
      </div>
    </div>
  );
}
