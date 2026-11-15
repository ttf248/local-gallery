import { useState } from "react";
import type {
  SmartAlbumDimension,
  SmartAlbumOverride,
  SmartAlbumSummary,
} from "../../api/albums";
import RenditionImage from "../common/RenditionImage";

interface Props {
  summary?: SmartAlbumSummary;
  loading: boolean;
  error: boolean;
  dimension: SmartAlbumDimension;
  analyzing: boolean;
  rebuilding: boolean;
  onDimensionChange: (dimension: SmartAlbumDimension) => void;
  onAnalyze: () => void;
  onRebuild: () => void;
  onSaveOverride: (
    groupId: string,
    override: SmartAlbumOverride,
  ) => Promise<boolean>;
  onOpenGroup: (groupId: string) => void;
}

const DIMENSIONS: readonly [SmartAlbumDimension, string][] = [
  ["time", "时间"],
  ["place", "地点"],
  ["people", "人物"],
  ["scene", "场景"],
];

export default function SmartAlbumBrowser({
  summary,
  loading,
  error,
  dimension,
  analyzing,
  rebuilding,
  onDimensionChange,
  onAnalyze,
  onRebuild,
  onSaveOverride,
  onOpenGroup,
}: Props) {
  const [showHiddenGroups, setShowHiddenGroups] = useState(false);
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");

  const visibleGroups =
    summary?.groups.filter((group) => showHiddenGroups || !group.hidden) ?? [];

  return (
    <section className="min-h-0 flex-1 overflow-auto px-[clamp(20px,3vw,48px)] py-6">
      <div className="mx-auto max-w-[1600px]">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-title font-semibold text-fg">按线索浏览</h2>
            <p className="mt-1 text-meta text-fg-muted">
              只在这本相册内分组；原始照片与文件保持不变。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary && summary.hiddenGroupCount > 0 && (
              <button
                type="button"
                onClick={() => setShowHiddenGroups((value) => !value)}
                className="btn btn-sm btn-ghost"
                aria-pressed={showHiddenGroups}
              >
                {showHiddenGroups
                  ? "隐藏已隐藏分组"
                  : `显示已隐藏 · ${summary.hiddenGroupCount}`}
              </button>
            )}
            <button
              type="button"
              onClick={onRebuild}
              disabled={rebuilding || loading}
              className="btn btn-sm btn-secondary"
            >
              {rebuilding ? "正在重建…" : "重建分组"}
            </button>
            <button
              type="button"
              onClick={onAnalyze}
              disabled={analyzing}
              className="btn btn-sm btn-primary"
            >
              {analyzing ? "正在分析…" : "分析当前相册"}
            </button>
          </div>
        </div>

        <div
          className="mb-5 flex flex-wrap gap-2"
          role="tablist"
          aria-label="智能分组维度"
        >
          {DIMENSIONS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={dimension === key}
              onClick={() => onDimensionChange(key)}
              className={`rounded-full border px-4 py-2 text-body transition-colors ${
                dimension === key
                  ? "border-brand/40 bg-brand/10 text-brand-ink"
                  : "border-border bg-bg-elevated text-fg-muted hover:text-fg"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {error ? (
          <div
            role="alert"
            className="rounded-xl border border-border bg-bg-elevated p-6 text-body text-fg-muted"
          >
            智能分组读取失败，请重试。
          </div>
        ) : loading || !summary ? (
          <div className="rounded-xl border border-border bg-bg-elevated p-6 text-body text-fg-muted">
            正在读取这本相册的分析线索…
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-bg-elevated px-4 py-3 text-meta text-fg-muted">
              <span>
                分析覆盖 {summary.coverage.analyzed}/{summary.coverage.total}
              </span>
              <span>有效线索 {summary.coverage.withEvidence} 张</span>
              <span>未分组 {summary.ungroupedPhotos} 张</span>
              {!summary.coverage.available && summary.coverage.reason && (
                <span className="text-warning">该分析模块暂不可用</span>
              )}
            </div>

            {visibleGroups.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border bg-bg-elevated/60 px-6 py-14 text-center">
                <h3 className="text-body font-medium text-fg">
                  还没有可展示的分组
                </h3>
                <p className="mt-2 text-meta text-fg-muted">
                  {summary.hiddenGroupCount > 0 && !showHiddenGroups
                    ? "当前分组已隐藏，可选择显示已隐藏分组。"
                    : summary.coverage.missing > 0
                      ? "先分析当前相册，再根据可信线索建立分组。"
                      : "当前相册没有达到最低照片数的分组。"}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {visibleGroups.map((group) => (
                  <article
                    key={group.id}
                    className={`overflow-hidden rounded-xl border border-border bg-bg-elevated shadow-sm ${group.hidden ? "opacity-65" : ""}`}
                  >
                    <button
                      type="button"
                      onClick={() => onOpenGroup(group.id)}
                      className="group relative block aspect-[4/3] w-full overflow-hidden bg-bg-subtle text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                      aria-label={`打开分组 ${group.name}，${group.photoCount} 张`}
                    >
                      {group.coverResourceId ? (
                        <RenditionImage
                          fileId={group.coverResourceId}
                          version={group.coverVersion}
                          alt=""
                          displayWidth={320}
                          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-fg-subtle">
                          暂无封面
                        </div>
                      )}
                      {group.hidden && (
                        <span className="absolute left-3 top-3 rounded-full bg-bg/90 px-2 py-1 text-xs text-fg-muted">
                          已隐藏
                        </span>
                      )}
                    </button>
                    <div className="p-3">
                      {editingGroupId === group.id ? (
                        <form
                          onSubmit={(event) => {
                            event.preventDefault();
                            void onSaveOverride(group.id, {
                              name: nameDraft,
                            }).then((saved) => {
                              if (saved) setEditingGroupId(null);
                            });
                          }}
                          className="flex gap-2"
                        >
                          <input
                            autoFocus
                            value={nameDraft}
                            onChange={(event) =>
                              setNameDraft(event.target.value)
                            }
                            maxLength={60}
                            aria-label="分组名称"
                            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1 text-meta text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          />
                          <button
                            type="submit"
                            className="text-meta text-brand hover:underline"
                          >
                            保存
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingGroupId(null)}
                            className="text-meta text-fg-muted hover:text-fg"
                          >
                            取消
                          </button>
                        </form>
                      ) : (
                        <div className="flex min-w-0 items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3
                              className="truncate text-body font-medium text-fg"
                              title={group.name}
                            >
                              {group.name}
                            </h3>
                            <p className="mt-1 text-meta text-fg-muted">
                              {group.photoCount} 张照片
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setEditingGroupId(group.id);
                              setNameDraft(
                                group.customName
                                  ? group.name
                                  : group.suggestedName,
                              );
                            }}
                            className="shrink-0 rounded px-1.5 py-1 text-meta text-fg-muted hover:bg-bg-subtle hover:text-fg"
                            aria-label={`重命名 ${group.name}`}
                          >
                            重命名
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void onSaveOverride(group.id, {
                            hidden: !group.hidden,
                          })
                        }
                        className="mt-2 text-meta text-fg-muted hover:text-fg"
                      >
                        {group.hidden ? "取消隐藏" : "隐藏分组"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
