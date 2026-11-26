import { SettingsRow } from "../../ui/SettingsList";
import { Switch } from "../../ui/Switch";
import { RestartIcon } from "../../ui/icons";
import PathField from "./PathField";
import { openConfiguredDirectory } from "./openConfiguredDirectory";
import { SaveBadge } from "../../ui/Badge";
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

/** 单个字段行。 */
export function ServerConfigField({
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
    <SettingsRow
      label={
        <span className="inline-flex flex-wrap items-center gap-2">
          {def.label}
          {requiresRestart && (
            <span className="inline-flex items-center gap-1 text-caption text-fg-muted">
              <RestartIcon size={10} />
              需重启
            </span>
          )}
        </span>
      }
      description={def.hint}
    >
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
            className="bg-bg-subtle border border-line rounded-md h-8 px-2.5 text-body font-mono w-full max-w-[40vw] focus:outline-none focus:border-accent"
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
            className="bg-bg-subtle border border-line rounded-md h-8 px-2.5 text-body font-mono w-24 text-right tabular-nums focus:outline-none focus:border-accent"
          />
        ) : (
          <Switch
            checked={Boolean(value)}
            onChange={onChange}
            label={def.label}
          />
        )}
        {/* 状态指示:只在非路径/非紧凑模式单独显示(紧凑模式由 PathField 内部带) */}
        {!(def.kind === "text" && isPath) && <SaveBadge status={status} />}
      </div>
    </SettingsRow>
  );
}
