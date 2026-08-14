import { useQuery } from '@tanstack/react-query'
import { historyApi } from '../api/prefs'
import EmptyState from '../components/common/EmptyState'

export default function Recents() {
  const { data, isLoading } = useQuery({
    queryKey: ['history'],
    queryFn: () => historyApi.list(),
  })

  if (isLoading) return <div className="p-6 text-fg-muted">加载中…</div>
  const items = data?.history ?? []

  if (items.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="暂无最近访问"
          description="打开任意一本漫画后会自动出现在这里。"
        />
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">最近访问</h1>
      <ul className="space-y-2">
        {items.map((h) => (
          <li
            key={h.path}
            className="p-3 bg-bg-elevated rounded border border-border flex items-center justify-between"
          >
            <div>
              <div className="font-medium">{h.name}</div>
              <div className="text-xs text-fg-subtle">{h.path}</div>
            </div>
            <div className="text-sm text-fg-muted">
              {h.imageCount} 张 · {new Date(h.openedAt).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
