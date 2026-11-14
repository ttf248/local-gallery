import { stampLabel } from "../../utils/date";

interface Props {
  /** 上次打开这本相册的时刻（ISO）。 */
  at?: string | null;
}

/**
 * 时刻徽章：压在封面左上角。
 *
 * 「最近浏览」要回答的是「我刚才在翻什么」，时刻是这句话的一半。
 * 时刻贴在封面上而不是压在标题下面的小字里：网格一屏摆十几张卡，
 * 角标是唯一还能扫读的位置 —— 小字要逐张凑近才看得见。
 *
 * 底板用深色蒙版：封面可能是纯白也可能是纯黑，只有蒙版才保证
 * 任何封面上都读得清。
 */
export default function VisitStamp({ at }: Props) {
  const label = stampLabel(at);
  if (!label) return null;
  return (
    <span
      data-testid="visit-stamp"
      className="pointer-events-none inline-flex h-5 items-center rounded-md bg-black/65 px-1.5 text-badge font-medium tabular-nums text-white backdrop-blur-sm ring-1 ring-white/20"
      title={fullLabel(at)}
    >
      {label}
    </span>
  );
}

/** 完整时刻：悬停提示里说清楚。 */
function fullLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  return d.toLocaleString("zh-CN", { hour12: false });
}
