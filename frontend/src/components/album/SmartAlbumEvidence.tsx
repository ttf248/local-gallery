import type { SmartAlbumDimension } from "../../api/albums";
import { SMART_ALBUM_DIMENSION_LABELS } from "../../utils/smartAlbum";

interface Props {
  /** 支撑这条推荐的证据维度，顺序由调用方给定。 */
  dimensions: readonly SmartAlbumDimension[];
}

/**
 * 一条推荐的证据线索。
 *
 * 推荐之所以成立，是因为几类互不相干的线索指向同一批照片 ——
 * 时间、地点、人物、场景各说各的，却说到同一件事上，这就是推荐。
 * 所以这一行只摆「哪几类线索对上了」，不摆分数：分数是排序用的，
 * 不是给人看的依据。
 *
 * 汉字标签走 `--text-meta`（12.5px），不占 11.5px 那一档 ——
 * 那一档只给拉丁字母与数字，中文在那个尺寸上读不清。
 */
export default function SmartAlbumEvidence({ dimensions }: Props) {
  if (dimensions.length === 0) return null;
  return (
    <span
      className="flex flex-nowrap items-center gap-1 overflow-hidden"
      data-testid="smart-album-evidence"
      title={dimensions
        .map((dimension) => SMART_ALBUM_DIMENSION_LABELS[dimension])
        .join(" · ")}
    >
      {dimensions.map((dimension) => (
        <span
          key={dimension}
          className="shrink-0 rounded-full border border-border bg-bg-subtle px-1.5 text-meta leading-4 text-fg-muted"
        >
          {SMART_ALBUM_DIMENSION_LABELS[dimension]}
        </span>
      ))}
    </span>
  );
}
