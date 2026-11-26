import { useRef, useState } from "react";
import DirectoryPicker from "./DirectoryPicker";
import { SaveBadge } from "../../ui/Badge";
import { FolderOpenIcon, FolderSearchIcon, TrashIcon } from "../../ui/icons";
import { useConfigComposition } from "../../hooks/useConfigComposition";
import type { FieldStatus } from "../../hooks/useServerConfigSave";

export interface PathFieldProps {
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onCommit?: () => void;
  onConfirm: () => void;
  /** 撤销当前配置字段未提交的草稿；媒体根以整组数组为单位 */
  onCancel: () => void;
  onCompositionChange: (active: boolean) => void;
  /** 点击「在文件管理器中打开」时调用(undefined 时按钮隐藏) */
  onOpenInExplorer?: () => void;
  /** 用户确认服务端返回的完整目录路径后回调 */
  onPick: (picked: string) => void;
  /** 紧凑模式(用于 ServerConfigField 内):按钮图标更小 */
  compact?: boolean;
  /** 状态指示(紧凑模式用) */
  withStatus?: boolean;
  status?: FieldStatus;
  removable?: boolean;
  onRemove?: () => void;
  /** 输入框的可访问名称：可见标签是普通文本，这里补一个等价的名称。 */
  label?: string;
}

/**
 * 路径输入。
 *
 * Enter 或移开焦点提交，Esc 撤销未提交的草稿。旁边三个按钮分别是
 * 选目录、在文件管理器里打开、删除这一条。
 */
export default function PathField({
  value,
  placeholder,
  onChange,
  onCommit,
  onConfirm,
  onCancel,
  onCompositionChange,
  onOpenInExplorer,
  onPick,
  compact,
  withStatus,
  status = "idle",
  removable,
  onRemove,
  label,
}: PathFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [picking, setPicking] = useState(false);
  const composition = useConfigComposition(onChange, onCompositionChange);

  // 提交:Enter / Blur
  const commit = () => onCommit?.();

  const btnSize = compact ? "h-7 w-7" : "h-8 w-8";
  const iconSize = compact ? 12 : 14;

  return (
    <div className="flex items-center gap-2 w-full">
      <input
        ref={inputRef}
        type="text"
        value={value}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onCompositionStart={composition.start}
        onCompositionEnd={(e) => composition.finish(e.currentTarget.value)}
        onBlur={(e) => {
          composition.finish(e.currentTarget.value);
          commit();
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing || composition.active.current) return;
          if (e.key === "Enter") {
            e.preventDefault();
            onConfirm();
            (e.currentTarget as HTMLInputElement).blur();
          } else if (e.key === "Escape") {
            e.preventDefault();
            e.stopPropagation();
            // 清掉草稿后再失焦，onBlur 将没有待提交的内容。
            onCancel();
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        title={
          onCommit
            ? "Enter 或移开焦点保存；Esc 撤销编辑草稿"
            : "停止输入后自动保存；Esc 撤销整组编辑草稿"
        }
        aria-keyshortcuts="Enter Escape"
        className="flex-1 min-w-0 bg-bg-subtle border border-line rounded-md h-8 px-2.5 text-body font-mono focus:outline-none focus:border-accent"
      />
      {/* 「选择目录」 */}
      <button
        type="button"
        onClick={() => setPicking(true)}
        title="选择本地目录"
        aria-label="选择本地目录"
        className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-line text-fg-muted hover:text-fg hover:border-line-strong transition-colors disabled:opacity-40`}
      >
        <FolderSearchIcon size={iconSize} />
      </button>
      {/* 「在文件管理器中打开」 */}
      {onOpenInExplorer && (
        <button
          type="button"
          onClick={onOpenInExplorer}
          title="在系统文件管理器中打开此目录"
          aria-label="在系统文件管理器中打开此目录"
          className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-line text-fg-muted hover:text-fg hover:border-line-strong transition-colors`}
        >
          <FolderOpenIcon size={iconSize} />
        </button>
      )}
      {/* 「移除」(多根列表用) */}
      {removable && onRemove && (
        <button
          type="button"
          onClick={() => {
            composition.clear();
            onRemove();
          }}
          title="删除此根目录"
          className={`inline-flex items-center justify-center ${btnSize} rounded-md border border-line text-fg-subtle hover:text-danger hover:border-danger/40 transition-colors`}
        >
          <TrashIcon size={iconSize} />
        </button>
      )}
      {/* 状态指示 */}
      {withStatus && <SaveBadge status={status} />}
      {picking && (
        <DirectoryPicker
          initialDirectory={value}
          onClose={() => setPicking(false)}
          onPick={(directory) => {
            onPick(directory);
            onCommit?.();
            setPicking(false);
          }}
        />
      )}
    </div>
  );
}
