import { useState, type ReactNode } from "react";
import { RenditionImage } from "../common";
import { useAppMode } from "../../hooks/useAppMode";
import { useEdgeFade } from "../../ui/useEdgeFade";
import { FolderIcon } from "../../ui/icons";

export interface TimelineEntry {
  /** 稳定键。 */
  key: string;
  /** 展示名：年份、系列名。 */
  label: string;
  /** 副标题计数。 */
  count: string;
  /** 封面（可为空）。 */
  coverPath?: string;
  /** 封面内容版本号。 */
  coverVersion?: string;
  /** 点击主区域时的行为。 */
  onActivate: () => void;
  /** 右上角的次级操作；没有就不渲染那一枚按钮。 */
  action?: ReactNode;
  /** 主区域是否处于选中态（正在被筛选的那一年）。 */
  active?: boolean;
  /** 标签是数字（年份）：用等宽数字对齐，避免各年卡宽度跳来跳去。 */
  numeric?: boolean;
}

/**
 * 横向索引条。
 *
 * 年份索引与漫画的系列索引共用这一套视觉骨架：横向滚动的一排大卡，
 * 每张卡带封面、主标题与计数。它们只是分组维度不同，不该长成两样东西。
 */
export default function Timeline({
  entries,
  testId,
}: {
  entries: TimelineEntry[];
  testId: string;
}) {
  // 一排作品常常放不下，右边那张卡被硬切一刀像布局坏了；
  // 两端渐隐明确地说「这边还有」。
  const { ref, maskImage } = useEdgeFade<HTMLDivElement>();
  if (entries.length === 0) return null;
  return (
    <div
      ref={ref}
      className="year-index flex gap-3 overflow-x-auto [padding:2px_2px_12px] [scroll-snap-type:x_proximity]"
      style={{ maskImage }}
      data-testid={testId}
    >
      {entries.map((entry) => (
        <TimelineCard key={entry.key} entry={entry} />
      ))}
    </div>
  );
}

function TimelineCard({ entry }: { entry: TimelineEntry }) {
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const cover = entry.coverPath;
  // 漫画侧的索引卡也是一本书：封面带装订边，与网格里的书封同一套语言。
  const { mode } = useAppMode();
  const isComic = mode === "comic";
  return (
    <div
      className="year-index__item relative [flex:0_0_var(--year-index-item)] [scroll-snap-align:start] group"
      data-active={entry.active ? "true" : undefined}
    >
      <button
        type="button"
        onClick={entry.onActivate}
        className="year-index__open flex items-center gap-3 w-full p-2 rounded-tile text-left transition duration-base [.year-index\_\_item[data-active=true]_&]:bg-selected [.year-index\_\_item[data-active=true]_&]:text-primary hover:bg-sunken [.year-index\_\_item[data-active=true]_&:hover]:bg-selected touch:active:bg-sunken touch:[.year-index\_\_item[data-active=true]_&:active]:bg-selected"
      >
        <span
          className={`block shrink-0 overflow-hidden bg-sunken ${
            isComic ? "timeline-cover--book after:content-[''] after:absolute after:inset-0 after:z-[1] after:pointer-events-none after:[background:linear-gradient(to_right,rgb(0_0_0_/_0.48)_0,rgb(0_0_0_/_0.14)_5px,rgb(0_0_0_/_0)_13px)] relative rounded-[5px_8px_8px_5px] [box-shadow:0_6px_14px_-10px_rgb(0_0_0_/_0.5)] w-12 h-14" : "rounded-md w-12 h-12"
          }`}
        >
          {cover && cover !== failedSource ? (
            <RenditionImage
              fileId={cover}
              version={entry.coverVersion}
              alt=""
              displayWidth={48}
              loading="lazy"
              onError={() => setFailedSource(cover)}
              className="w-full h-full object-cover"
            />
          ) : (
            <span className="flex items-center justify-center w-full h-full text-ink-3">
              <FolderIcon size={18} />
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span
            className={`block font-display text-heading font-semibold leading-tight text-ink truncate ${
              entry.numeric ? "tabular-nums" : ""
            }`}
          >
            {entry.label}
          </span>
          <span className="block text-caption text-ink-2 mt-1 tabular-nums">
            {entry.count}
          </span>
        </span>
      </button>
      {entry.action}
    </div>
  );
}
