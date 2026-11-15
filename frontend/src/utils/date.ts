// 日期相关的轻量工具，避免引入 dayjs / date-fns。

// 照片库里的时间不可能早于 1970 年：早于它的多半是「没有时间」。
const EARLIEST_PLAUSIBLE = Date.UTC(1970, 0, 1);

/**
 * 把「没有时间」的几种写法归一成 undefined。
 *
 * Go 的零值时间序列化成 "0001-01-01T00:00:00Z"，Date.parse 会把它
 * 当成公元 1 年的合法日期 —— 按时间排序时它永远垫底，看起来像
 * 「最旧的那本」，而不是「没有时间」。这里的集合摘要早先就是这样：
 * 它们不带任何时间戳，于是被排到了最后一位。
 */
export function usableDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const parsed = Date.parse(iso);
  if (!Number.isFinite(parsed) || parsed < EARLIEST_PLAUSIBLE) return undefined;
  return iso;
}

// 时间倒序；缺失或无效时间排在有效时间之后，供调用方继续按名称兜底。
export function compareDatesDesc(first?: string, second?: string): number {
  const firstTime = Date.parse(first ?? "");
  const secondTime = Date.parse(second ?? "");
  if (!Number.isFinite(firstTime)) return Number.isFinite(secondTime) ? 1 : 0;
  if (!Number.isFinite(secondTime)) return -1;
  return secondTime - firstTime;
}


// 绝对时间（本地化）：用于属性 / 信息面板这类需要精确到分钟的展示。
// 空值、无法解析或零值时间返回 "—"
export function formatDateTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(+date)) return "—";
  if (date.getFullYear() <= 1) return "—";
  return date.toLocaleString("zh-CN", { hour12: false });
}

// 距离今天多少天的友好描述（粗颗粒度：天/月/年）。
//   - < 1 天 → "刚刚"
//   - 1 天 → "昨天"
//   - < 30 天 → "N 天前"
//   - < 365 天 → "N 个月前"
//   - 其他 → "N 年前"
//
// isoStr 为可解析的时间字符串；解析失败返回 '—'。
export function timeAgo(isoStr: string | undefined | null): string {
  if (!isoStr) return "—";
  const t = new Date(isoStr);
  if (Number.isNaN(+t)) return "—";
  const ms = Date.now() - +t;
  if (ms < 0) return "刚刚";
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(ms / day);
  if (days < 1) return "刚刚";
  if (days === 1) return "昨天";
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;
  const years = Math.floor(days / 365);
  return `${years} 年前`;
}

/**
 * 时刻徽章上的短时刻：今天给到分钟，昨天给「昨天 HH:MM」，更早给月日。
 *
 * 固定格式而不是「N 分钟前」：相对时间越排越短，读起来像一列长度
 * 不一的字符串。跨年的条目补上年份 —— 「11/11」分不清是去年还是
 * 今年。
 */
export function stampLabel(iso?: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "";
  const now = new Date();
  const time = d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  if (d.toDateString() === now.toDateString()) return time;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
  if (d.getFullYear() !== now.getFullYear()) {
    return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  }
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
