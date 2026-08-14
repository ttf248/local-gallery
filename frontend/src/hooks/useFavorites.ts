import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { favoritesApi } from '../api/prefs'

// 收藏集合的全局 hook：list + toggle
export function useFavorites() {
  const qc = useQueryClient()

  const { data } = useQuery({
    queryKey: ['favorites'],
    queryFn: () => favoritesApi.list(),
    staleTime: 30 * 1000,
  })

  const add = useMutation({
    mutationFn: (path: string) => favoritesApi.add(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  })

  const remove = useMutation({
    mutationFn: (path: string) => favoritesApi.remove(path),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['favorites'] }),
  })

  const list = data?.favorites ?? []

  async function toggle(path: string) {
    if (list.includes(path)) {
      await remove.mutateAsync(path)
    } else {
      await add.mutateAsync(path)
    }
  }

  return {
    favorites: list,
    add: (path: string) => add.mutateAsync(path),
    remove: (path: string) => remove.mutateAsync(path),
    toggle,
  }
}
