import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '../api/prefs'
import EmptyState from '../components/common/EmptyState'

export default function Favorites() {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => favoritesApi.list(),
  })

  const remove = useMutation({
    mutationFn: (path: string) => favoritesApi.remove(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  })

  if (isLoading) return <div className="p-6 text-fg-muted">加载中…</div>
  const items = data?.favorites ?? []

  if (items.length === 0) {
    return (
      <div className="p-6">
        <EmptyState
          title="暂无收藏"
          description="在漫画卡片上点击右键可以添加收藏。"
        />
      </div>
    )
  }

  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold mb-4">我的收藏</h1>
      <ul className="space-y-2">
        {items.map((path) => (
          <li
            key={path}
            className="p-3 bg-bg-elevated rounded border border-border flex items-center justify-between"
          >
            <span className="truncate">{path.split(/[/\\]/).pop()}</span>
            <button
              onClick={() => remove.mutate(path)}
              className="text-danger text-sm hover:underline"
            >
              移除
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
