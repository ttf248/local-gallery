// 字节数人性化（1024 进制）。
export function formatSize(n: number): string {
  if (n < 0 || !Number.isFinite(n)) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`
}

// 视频时长（秒）→ "MM:SS" / "H:MM:SS"。
//  - 缺省 / 非有限数：返回 "—"
//  - < 1h：MM:SS
//  - ≥ 1h：H:MM:SS
export function formatDuration(seconds: number | undefined | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const total = Math.floor(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => n.toString().padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}