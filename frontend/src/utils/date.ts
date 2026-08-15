// 日期相关的轻量工具，避免引入 dayjs / date-fns。

// 距离今天多少天的友好描述。
//   - < 1 天 → "刚刚"
//   - 1 天 → "昨天"
//   - < 30 天 → "N 天前"
//   - < 365 天 → "N 个月前"
//   - 其他 → "N 年前"
//
// isoStr 为可解析的时间字符串；解析失败返回 '—'。
export function timeAgo(isoStr: string | undefined | null): string {
  if (!isoStr) return '—'
  const t = new Date(isoStr)
  if (Number.isNaN(+t)) return '—'
  const ms = Date.now() - +t
  if (ms < 0) return '刚刚'
  const day = 24 * 60 * 60 * 1000
  const days = Math.floor(ms / day)
  if (days < 1) return '刚刚'
  if (days === 1) return '昨天'
  if (days < 30) return `${days} 天前`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months} 个月前`
  const years = Math.floor(days / 365)
  return `${years} 年前`
}
