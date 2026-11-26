import Segmented from "../../ui/Segmented";
import PathField from "./PathField";
import { SaveBadge } from "../../ui/Badge";
import { PlusIcon } from "../../ui/icons";
import type { FieldStatus } from "../../hooks/useServerConfigSave";
import type { MediaRootConfig } from "../../api/config";
import type { ContentKind } from "../../api/library";

/**
 * 媒体根目录（多根，独立组件）。
 *
 * 每个目录选定一种内容属性：照片目录用照片墙浏览，漫画目录用阅读器。
 * 路径输入与「选择目录」在 PathField 里，这里只管这一组根的增删改。
 */
export default function MediaRootsField({
  roots,
  status,
  allowOsOpen,
  onChange,
  onOpenInExplorer,
  onCancel,
  onConfirm,
  onCompositionChange,
}: {
  roots: MediaRootConfig[];
  status: FieldStatus;
  allowOsOpen: boolean;
  onChange: (next: MediaRootConfig[]) => void;
  onOpenInExplorer: (path: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onCompositionChange: (active: boolean) => void;
}) {
  // 始终渲染一个空槽位(即使当前为空),方便用户添加第一个根
  const list: MediaRootConfig[] =
    roots.length === 0 ? [{ path: "", kind: "photo" }] : roots;
  const updatePathAt = (i: number, path: string) => {
    const next = [...roots];
    if (i < next.length) {
      next[i] = { ...next[i], path };
    } else {
      // 空槽位:替换为新值
      next[0] = { path, kind: "photo" };
    }
    onChange(next);
  };
  const updateKindAt = (i: number, kind: ContentKind) => {
    if (i >= roots.length) return;
    const next = [...roots];
    next[i] = { ...next[i], kind };
    onChange(next);
  };
  const removeAt = (i: number) => {
    if (i >= roots.length) {
      // 当前是空槽位:直接清空
      onChange([]);
      return;
    }
    const next = [...roots];
    next.splice(i, 1);
    onChange(next);
  };
  const addEmpty = () => {
    onChange([...roots, { path: "", kind: "photo" }]);
  };
  return (
    <div className="px-4 py-3 text-body space-y-2">
      <div className="flex items-start justify-between gap-4">
        <div className="flex flex-col">
          <span className="text-fg">媒体根目录</span>
          <span className="text-caption text-fg-subtle mt-0.5">
            多个目录都会扫描，相册按来源分组，徽标显示所属目录。每个目录
            选定一种内容属性：照片目录用照片墙浏览，漫画目录用阅读器。 按 Esc
            撤销整组编辑草稿。
          </span>
        </div>
        <SaveBadge status={status} />
      </div>
      <div className="space-y-2">
        {list.map((root, i) => (
          <div key={i} className="space-y-1.5">
            <PathField
              value={root.path}
              placeholder="E:\照片 或 /home/user/pics"
              label={`媒体根目录 ${i + 1}`}
              // 只在已存在的根上提供"打开文件管理器"(空槽位不算)
              onOpenInExplorer={
                i < roots.length && root.path && allowOsOpen
                  ? () => onOpenInExplorer(root.path)
                  : undefined
              }
              onPick={(picked) => updatePathAt(i, picked)}
              onChange={(nv) => updatePathAt(i, nv)}
              onCancel={onCancel}
              onConfirm={onConfirm}
              onCompositionChange={onCompositionChange}
              removable={roots.length > 1}
              onRemove={() => removeAt(i)}
            />
            <div className="flex items-center gap-2">
              <span className="text-caption text-fg-subtle shrink-0">
                内容属性
              </span>
              <KindRadio
                value={root.kind}
                onChange={(kind) => updateKindAt(i, kind)}
                label={`媒体根目录 ${i + 1} 的内容属性`}
              />
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={addEmpty}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-line text-fg-muted hover:text-fg hover:border-line-strong text-caption transition-colors"
      >
        <PlusIcon size={12} />
        添加根目录
      </button>
    </div>
  );
}

// 内容属性单选：照片与漫画互斥，只能选一个。
function KindRadio({
  value,
  onChange,
  label,
}: {
  value: ContentKind;
  onChange: (kind: ContentKind) => void;
  label: string;
}) {
  return (
    <Segmented
      label={label}
      value={value}
      onChange={onChange}
      options={[
        { value: "photo", label: "照片" },
        { value: "comic", label: "漫画" },
      ]}
    />
  );
}
